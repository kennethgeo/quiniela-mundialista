-- =============================================================================
-- 87 · El upsert del cliente tiene que pasar (la 85 rompió el guardado)
-- =============================================================================
-- LA 85 ROMPIÓ LAS PREDICCIONES EN PRODUCCIÓN. La encontró una auditoría
-- externa (Astra, 22 sep 2026) y se confirmó reproduciendo en producción,
-- como `authenticated`, el upsert EXACTO que arma PostgREST:
--
--     upsert estilo PostgREST = FALLA 42501: permission denied for table predictions
--
-- PostgREST mete en el `DO UPDATE SET` TODAS las columnas que manda el cliente,
-- aunque su valor no cambie. `GroupPage`, `PredecirJornada` y
-- `TournamentGlobalCard` mandan `user_id` y `league_id` (y las globales,
-- `tournament_id`), y la 85 les había quitado el UPDATE a esas columnas. El
-- INSERT simple pasaba; el upsert —que es lo único que usa la app— no.
--
-- POR QUÉ NO LO VI: la comprobación de «el guardado sigue funcionando» de la 85
-- escribía un `DO UPDATE SET` a mano con solo los marcadores. Era un doble MÁS
-- PERMISIVO que el cliente real — la regla que este repo ya tenía anotada para
-- Google («un doble que acepta lo que el servidor real rechaza no prueba
-- nada»), repetida en SQL. La comprobación de abajo reproduce el SET completo.
--
-- EL ARREGLO devuelve el UPDATE de esas columnas y deja que la POLÍTICA las
-- ate, que es donde tiene que vivir la regla: `user_id` al que llama, `league_id`
-- a una quiniela de la que es miembro. Reescribirlas al mismo valor es inocuo;
-- cambiarlas a otro lo rechaza el WITH CHECK. `points_earned` y los puntos de
-- las globales siguen SIN privilegio: eso era el agujero y no se reabre.
--
-- Y SE CIERRA EL #2 DE LA MISMA AUDITORÍA en las mismas políticas: se podía
-- guardar una predicción de un partido de OTRO torneo en tu quiniela, y
-- `league_points` la sumaba. Las claves foráneas comprueban cada id por
-- separado; nadie comprobaba que el partido fuera del torneo de la quiniela.
-- Medido hoy: 0 filas cruzadas. Lo mismo para `tournament_predictions`, cuyo
-- `tournament_id` lo manda el cliente.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- predictions
-- -----------------------------------------------------------------------------
GRANT UPDATE (user_id, league_id) ON public.predictions TO authenticated;

DROP POLICY IF EXISTS predictions_insert_own_unlocked ON public.predictions;
CREATE POLICY predictions_insert_own_unlocked ON public.predictions
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND public.is_league_member(league_id)
    -- el partido tiene que ser del torneo de ESA quiniela
    AND EXISTS (SELECT 1 FROM public.matches m
                  JOIN public.leagues l ON l.tournament_id = m.tournament_id
                 WHERE m.id = predictions.match_id AND l.id = predictions.league_id)
    AND (SELECT ((m.kickoff_at - interval '15 minutes') > now())
                OR (COALESCE(m.predictions_force_open, false)
                    AND m.status <> ALL (ARRAY['finished','cancelled','postponed']))
           FROM public.matches m WHERE m.id = predictions.match_id)
  );

DROP POLICY IF EXISTS predictions_update_own_unlocked ON public.predictions;
CREATE POLICY predictions_update_own_unlocked ON public.predictions
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND public.is_league_member(league_id)
    AND EXISTS (SELECT 1 FROM public.matches m
                  JOIN public.leagues l ON l.tournament_id = m.tournament_id
                 WHERE m.id = predictions.match_id AND l.id = predictions.league_id)
    AND (SELECT ((m.kickoff_at - interval '15 minutes') > now())
                OR (COALESCE(m.predictions_force_open, false)
                    AND m.status <> ALL (ARRAY['finished','cancelled','postponed']))
           FROM public.matches m WHERE m.id = predictions.match_id)
  );

-- -----------------------------------------------------------------------------
-- tournament_predictions
-- -----------------------------------------------------------------------------
GRANT UPDATE (user_id, tournament_id, league_id) ON public.tournament_predictions TO authenticated;

DROP POLICY IF EXISTS tournament_predictions_insert_own ON public.tournament_predictions;
CREATE POLICY tournament_predictions_insert_own ON public.tournament_predictions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id
              AND public.is_league_member(league_id)
              AND EXISTS (SELECT 1 FROM public.leagues l
                           WHERE l.id = tournament_predictions.league_id
                             AND l.tournament_id = tournament_predictions.tournament_id)
              AND public.tournament_predictions_open(tournament_id));

DROP POLICY IF EXISTS tournament_predictions_update_own ON public.tournament_predictions;
CREATE POLICY tournament_predictions_update_own ON public.tournament_predictions
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id
              AND public.is_league_member(league_id)
              AND EXISTS (SELECT 1 FROM public.leagues l
                           WHERE l.id = tournament_predictions.league_id
                             AND l.tournament_id = tournament_predictions.tournament_id)
              AND public.tournament_predictions_open(tournament_id));

-- -----------------------------------------------------------------------------
-- Comprobaciones: el upsert REAL tiene que tener privilegio sobre cada columna
-- que manda el cliente, en INSERT y en UPDATE. Esta es la lista de columnas
-- que PostgREST mete en el SET; si el frontend empieza a mandar otra, hay que
-- agregarla acá o el guardado vuelve a romperse.
-- -----------------------------------------------------------------------------
DO $$
DECLARE c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['match_id','prediction_type','home_goals_pred','away_goals_pred',
                           'penalties_winner_pred','use_powerup_x2','user_id','league_id'] LOOP
    IF NOT has_column_privilege('authenticated','public.predictions',c,'INSERT')
    OR NOT has_column_privilege('authenticated','public.predictions',c,'UPDATE') THEN
      RAISE EXCEPTION 'el upsert de predictions no puede escribir %', c;
    END IF;
  END LOOP;
  FOREACH c IN ARRAY ARRAY['user_id','tournament_id','league_id',
                           'champion_team','top_scorer_name','top_assist_name'] LOOP
    IF NOT has_column_privilege('authenticated','public.tournament_predictions',c,'INSERT')
    OR NOT has_column_privilege('authenticated','public.tournament_predictions',c,'UPDATE') THEN
      RAISE EXCEPTION 'el upsert de tournament_predictions no puede escribir %', c;
    END IF;
  END LOOP;
  -- …y lo que la 85 cerró sigue cerrado.
  IF has_column_privilege('authenticated','public.predictions','points_earned','UPDATE')
  OR has_column_privilege('authenticated','public.predictions','points_earned','INSERT')
  OR has_column_privilege('authenticated','public.tournament_predictions','champion_points','UPDATE')
  OR has_table_privilege('authenticated','public.league_members','INSERT') THEN
    RAISE EXCEPTION 'se reabrió lo que cerró la 85';
  END IF;
  RAISE NOTICE '87 OK';
END $$;

COMMIT;
