-- =============================================================================
-- 98 · Un partido cancelado, pospuesto o terminado no se predice
-- =============================================================================
-- Duodécima auditoría (Claude, 25 sep 2026; Astra sin uso).
--
-- Las políticas de escritura del dueño abrían por HORA: «faltan más de 15
-- minutos para el saque». No miraban el estado. Un partido pospuesto o
-- cancelado con el saque todavía en el futuro seguía aceptando predicciones y
-- ×2, aunque la pantalla ya lo muestra cerrado (`matchStatus`: cancelled,
-- postponed y finished dan canPredict = false) y aunque todo lo que se escriba
-- ahí lo anula `void_cancelled_match`.
--
-- No era solo trabajo tirado (lo dejó abierto la décima auditoría). REPRODUCIDO
-- CON DOS CONEXIONES en un Postgres local: una persona guarda en un lote el
-- marcador del partido pospuesto y un ×2 en otro partido de la misma jornada
-- mientras el backend anula el pospuesto → «deadlock detected». La anulación
-- toma el candado de cupo y después las filas; el lote toma la fila del
-- pospuesto y después el candado. Postgres aborta una de las dos; la
-- recuperación reintenta, pero es un fallo que no tiene por qué existir. Con
-- la escritura cerrada, nadie toca las filas de un partido que se anula.
--
-- La reapertura del admin (77) no cambia: su rama ya excluía esos estados.
-- Solo se agrega el estado a la rama de la hora; lo demás queda igual.
-- =============================================================================

BEGIN;

ALTER POLICY predictions_insert_own_unlocked ON public.predictions
  WITH CHECK (
    (auth.uid() = user_id) AND is_league_member(league_id)
    AND (EXISTS (SELECT 1 FROM (matches m JOIN leagues l ON (l.tournament_id = m.tournament_id))
                  WHERE m.id = predictions.match_id AND l.id = predictions.league_id))
    AND (SELECT (((m.kickoff_at - '00:15:00'::interval) > now())
                 AND (m.status <> ALL (ARRAY['finished'::text, 'cancelled'::text, 'postponed'::text])))
             OR (COALESCE(m.predictions_force_open, false)
                 AND (m.status <> ALL (ARRAY['finished'::text, 'cancelled'::text, 'postponed'::text])))
           FROM matches m WHERE m.id = predictions.match_id)
  );

ALTER POLICY predictions_update_own_unlocked ON public.predictions
  USING (auth.uid() = user_id)
  WITH CHECK (
    (auth.uid() = user_id) AND is_league_member(league_id)
    AND (EXISTS (SELECT 1 FROM (matches m JOIN leagues l ON (l.tournament_id = m.tournament_id))
                  WHERE m.id = predictions.match_id AND l.id = predictions.league_id))
    AND (SELECT (((m.kickoff_at - '00:15:00'::interval) > now())
                 AND (m.status <> ALL (ARRAY['finished'::text, 'cancelled'::text, 'postponed'::text])))
             OR (COALESCE(m.predictions_force_open, false)
                 AND (m.status <> ALL (ARRAY['finished'::text, 'cancelled'::text, 'postponed'::text])))
           FROM matches m WHERE m.id = predictions.match_id)
  );

DO $$
DECLARE v_ins text; v_upd text;
BEGIN
  SELECT with_check INTO v_ins FROM pg_policies WHERE tablename = 'predictions' AND policyname = 'predictions_insert_own_unlocked';
  SELECT with_check INTO v_upd FROM pg_policies WHERE tablename = 'predictions' AND policyname = 'predictions_update_own_unlocked';
  -- El estado tiene que aparecer DOS veces en cada una: en la rama de la hora
  -- y en la de la reapertura.
  IF (length(v_ins) - length(replace(v_ins, 'postponed', ''))) / length('postponed') < 2
  OR (length(v_upd) - length(replace(v_upd, 'postponed', ''))) / length('postponed') < 2 THEN
    RAISE EXCEPTION 'la rama de la hora sigue sin mirar el estado del partido';
  END IF;
  RAISE NOTICE '98 OK';
END $$;

COMMIT;
