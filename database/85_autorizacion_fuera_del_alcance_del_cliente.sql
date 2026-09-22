-- =============================================================================
-- 85 · La autorización no puede vivir en columnas que el cliente escribe
-- =============================================================================
-- Tres agujeros de la MISMA familia, encontrados por una auditoría externa el
-- 22 sep 2026 y COMPROBADOS uno por uno ejecutándolos de verdad contra
-- producción, con el JWT de usuarios reales, dentro de transacciones revertidas.
-- No son tres descuidos sueltos: son tres sitios donde la pregunta "¿quién sos?"
-- se responde con un dato que la propia persona puede escribir.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- A) Cualquiera se metía en cualquier quiniela, COMO CO-ADMIN
-- ─────────────────────────────────────────────────────────────────────────────
-- `league_members_insert_self` solo comprueba `auth.uid() = user_id` — o sea,
-- "la fila es tuya" — y `authenticated` tenía privilegio de INSERT sobre TODAS
-- las columnas, incluidas `es_admin`, `rules_accepted_at`, `pago_confirmado_at`
-- y `pago_confirmado_por`. Medido con el JWT de alguien que NO era miembro de
-- Bundestica (la quiniela de ₡170.000):
--
--     INSERT_es_admin=OK; filas=1; es_admin_liga=true
--
-- Entró sin código de invitación, como co-admin, con las reglas aceptadas y su
-- propio pago marcado como confirmado. `es_admin_liga` es la fuente única de
-- verdad de permisos por quiniela (migración 59), así que eso es: cambiar las
-- reglas, cambiar el puntaje, cambiar el pozo y la cuota, confirmar pagos
-- ajenos, proponer y cancelar votaciones, y expulsar miembros.
--
-- Y el mismo privilegio abría un segundo agujero que NO estaba en la auditoría:
-- con DELETE directo sobre `league_members` se saltaba entero el candado de
-- pagos de la migración 84, que solo vive dentro de `salir_de_quiniela`. Una
-- protección escrita ayer que se esquivaba con una llamada a otra ruta.
--
-- EL ARREGLO NO ES AFINAR LA POLÍTICA, ES QUITAR LA ESCRITURA. Comprobado:
-- las DIEZ funciones que escriben `league_members` son `SECURITY DEFINER`
-- (`join_group_by_code`, `create_group`, `accept_group_rules`, `avisar_pago`,
-- `confirmar_pago`, `set_league_admin`, `expulsar_miembro`, `salir_de_quiniela`,
-- `set_group_rules`, `_apply_rule_proposal`) y el frontend no escribe la tabla
-- por ninguna otra vía — cero `.insert(`, `.update(` o `.delete(` sobre ella en
-- todo `frontend/src`. El cliente no necesita ni un permiso de escritura acá.
--
-- Se hacen las DOS cosas —revocar el privilegio y borrar las políticas— a
-- propósito. El privilegio es el candado; borrar las políticas es para que
-- nadie lea "insertar a uno mismo" dentro de un año y crea que está bendecido.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- B) Cada quien se escribía sus propios puntos
-- ─────────────────────────────────────────────────────────────────────────────
-- `points_earned` es el resultado del ÚNICO motor de puntaje (`scoring.py`), y
-- `authenticated` podía escribirlo en su propia predicción. Medido, otra vez
-- ejecutándolo con el JWT de un miembro real sobre un partido abierto:
--
--     ANTES    global=43     quiniela=43
--     ESCRIBIO points_earned=OK
--     DESPUES  global=10042  quiniela=10042
--
-- El trigger recalcula el total global solo, y `league_points` —la misma
-- fórmula que alimenta la Tabla— devuelve 10042. Se corrige cuando el partido
-- se puntúa, pero hasta entonces esa persona encabeza una quiniela por plata.
--
-- De paso: ninguna política comprobaba que fueras MIEMBRO de la `league_id` que
-- ponés en la fila. Solo miraban "la fila es tuya" y "el partido está abierto".
--
-- ─────────────────────────────────────────────────────────────────────────────
-- C) Las predicciones globales las leía cualquiera, sin cuenta
-- ─────────────────────────────────────────────────────────────────────────────
-- La política de SELECT de `tournament_predictions` destapaba TODO si
-- `tournament_settings.is_locked` estaba en true. Ese interruptor es un
-- singleton GLOBAL (`WHERE id = 1`), de cuando la app tenía un solo torneo:
-- no mira la quiniela, no mira la membresía, y hoy está en `true`.
--
-- La política además era `TO public`, y `anon` tenía SELECT sobre la tabla.
-- Medido ejecutando como `anon`:
--
--     anon ve 21 globales, 2 ligas, 17 personas; ejemplo=Paris Saint-Germain/Kylian Mbappé
--
-- O sea: no era un problema "entre quinielas" como se reportó. Cualquiera con
-- la clave publicable, SIN CUENTA, leía el campeón, el goleador y el asistidor
-- de las 17 personas. Y de paso es el eslabón que hacía práctico el agujero (A):
-- `leagues` sí exige membresía para listarse, pero estas filas traen el
-- `league_id` servido en bandeja.
--
-- El criterio nuevo es el que ya existe para ESCRIBIRLAS: se destapan cuando
-- dejaste de poder cambiarlas (`tournament_predictions_open`), y solo a quien
-- comparte la quiniela. Es la misma regla que la 65 le puso a `predictions`.
--
-- NOTA: `tournament_settings` queda en pie y sin tocar — la usan otras cosas.
-- Lo que se quita es que decida QUIÉN VE QUÉ.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- A) league_members: el cliente lee, no escribe
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Unirse a ligas (insertar a uno mismo)"   ON public.league_members;
DROP POLICY IF EXISTS "league_members_insert_self"              ON public.league_members;
DROP POLICY IF EXISTS "Salir de la liga (eliminar a uno mismo)" ON public.league_members;
DROP POLICY IF EXISTS "league_members_delete_admin_or_self"     ON public.league_members;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.league_members FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.league_members IS
  'Membresías. El cliente solo LEE (RLS: puede_ver_quiniela). Toda alta, baja o '
  'cambio pasa por una función SECURITY DEFINER —join_group_by_code, create_group, '
  'accept_group_rules, avisar_pago, confirmar_pago, set_league_admin, '
  'expulsar_miembro, salir_de_quiniela— porque las columnas de esta tabla '
  '(es_admin, pago_confirmado_at) SON la autorización y el registro del pozo. '
  'No volver a otorgar INSERT/UPDATE/DELETE a authenticated: migración 85.';

-- -----------------------------------------------------------------------------
-- B) predictions: los puntos los pone el motor, no el jugador
-- -----------------------------------------------------------------------------
-- OJO CON POSTGRES: un REVOKE de COLUMNA **no resta** de un GRANT de TABLA.
-- `REVOKE INSERT (points_earned) ... FROM authenticated` no hace nada mientras
-- exista el `GRANT INSERT ON predictions TO authenticated`: `has_column_privilege`
-- sigue diciendo true, porque suma el permiso de tabla. Hay que quitar el de
-- tabla y volver a otorgar la lista EXACTA de columnas. Es el mismo patrón que
-- la 61 le aplicó a `users`; acá se documenta porque cuesta media hora
-- descubrirlo mirando una comprobación que pasa sin haber cambiado nada.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.predictions FROM PUBLIC, anon, authenticated;
GRANT INSERT (user_id, match_id, prediction_type, home_goals_pred, away_goals_pred,
              penalties_winner_pred, use_powerup_x2, league_id)
   ON public.predictions TO authenticated;
GRANT UPDATE (match_id, prediction_type, home_goals_pred, away_goals_pred,
              penalties_winner_pred, use_powerup_x2)
   ON public.predictions TO authenticated;
-- `user_id` y `league_id` se pueden INSERTAR (la política los ata a auth.uid() y
-- a tu membresía) pero NO ACTUALIZAR: mover una predicción ya guardada a otra
-- persona o a otra quiniela no es un caso de uso, es una forma de colarse.
-- `updated_at` lo pone el trigger, que no pasa por privilegios de columna.

-- Y de paso: predecir en una quiniela exige ser de esa quiniela.
DROP POLICY IF EXISTS predictions_insert_own_unlocked ON public.predictions;
CREATE POLICY predictions_insert_own_unlocked ON public.predictions
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND public.is_league_member(league_id)
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
    AND (SELECT ((m.kickoff_at - interval '15 minutes') > now())
                OR (COALESCE(m.predictions_force_open, false)
                    AND m.status <> ALL (ARRAY['finished','cancelled','postponed']))
           FROM public.matches m WHERE m.id = predictions.match_id)
  );

-- -----------------------------------------------------------------------------
-- C) tournament_predictions: se destapan por quiniela, no por un interruptor global
-- -----------------------------------------------------------------------------
REVOKE ALL ON public.tournament_predictions FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.tournament_predictions FROM authenticated;
GRANT INSERT (user_id, tournament_id, league_id,
              champion_team, top_scorer_name, top_assist_name)
   ON public.tournament_predictions TO authenticated;
GRANT UPDATE (champion_team, top_scorer_name, top_assist_name)
   ON public.tournament_predictions TO authenticated;
-- Los puntos de campeón/goleador/asistidor (12 + 12 + 12) los reparte el admin
-- con `calc-tournament-globals`. Que la persona pudiera escribirlos era el mismo
-- agujero que `points_earned`, con 36 puntos por cabeza en juego.

DROP POLICY IF EXISTS predictions_select ON public.tournament_predictions;
CREATE POLICY tournament_predictions_select_propia_o_de_mi_quiniela
  ON public.tournament_predictions
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR (public.puede_ver_quiniela(league_id)
        AND NOT public.tournament_predictions_open(tournament_id))
  );

DROP POLICY IF EXISTS predictions_insert ON public.tournament_predictions;
CREATE POLICY tournament_predictions_insert_own ON public.tournament_predictions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id
              AND public.is_league_member(league_id)
              AND public.tournament_predictions_open(tournament_id));

DROP POLICY IF EXISTS predictions_update ON public.tournament_predictions;
CREATE POLICY tournament_predictions_update_own ON public.tournament_predictions
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id
              AND public.is_league_member(league_id)
              AND public.tournament_predictions_open(tournament_id));

-- -----------------------------------------------------------------------------
-- Comprobaciones. RAISE EXCEPTION, no WARNING: una base a medio endurecer es
-- peor que una sin endurecer, porque parece segura. Todas miden el ESTADO
-- FINAL, así que una segunda corrida pasa igual.
-- -----------------------------------------------------------------------------
DO $$
DECLARE n int;
BEGIN
  -- A) nadie se auto-nombra co-admin ni se auto-confirma el pago
  IF has_column_privilege('authenticated','public.league_members','es_admin','INSERT')
  OR has_column_privilege('authenticated','public.league_members','pago_confirmado_at','INSERT')
  OR has_table_privilege('authenticated','public.league_members','INSERT')
  OR has_table_privilege('authenticated','public.league_members','UPDATE')
  OR has_table_privilege('authenticated','public.league_members','DELETE') THEN
    RAISE EXCEPTION 'league_members sigue siendo escribible por authenticated';
  END IF;
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='league_members' AND cmd <> 'SELECT';
  IF n > 0 THEN
    RAISE EXCEPTION 'league_members conserva % política(s) de escritura', n;
  END IF;
  -- …pero se sigue pudiendo LEER, o la app se queda sin lista de miembros.
  IF NOT has_table_privilege('authenticated','public.league_members','SELECT') THEN
    RAISE EXCEPTION 'league_members dejó de ser legible: eso rompe la pantalla';
  END IF;

  -- B) los puntos los pone el motor…
  IF has_column_privilege('authenticated','public.predictions','points_earned','INSERT')
  OR has_column_privilege('authenticated','public.predictions','points_earned','UPDATE') THEN
    RAISE EXCEPTION 'points_earned sigue siendo escribible por el jugador';
  END IF;
  -- …y el marcador lo sigue poniendo la persona, o nadie puede predecir.
  IF NOT has_column_privilege('authenticated','public.predictions','home_goals_pred','INSERT')
  OR NOT has_column_privilege('authenticated','public.predictions','away_goals_pred','UPDATE')
  OR NOT has_column_privilege('authenticated','public.predictions','use_powerup_x2','INSERT') THEN
    RAISE EXCEPTION 'se revocó de más: el guardado de predicciones quedó roto';
  END IF;
  IF NOT has_column_privilege('service_role','public.predictions','points_earned','UPDATE') THEN
    RAISE EXCEPTION 'el backend perdió la escritura de points_earned';
  END IF;
  -- Y las globales se siguen pudiendo elegir, pero no puntuar.
  IF has_column_privilege('authenticated','public.tournament_predictions','champion_points','INSERT')
  OR has_column_privilege('authenticated','public.tournament_predictions','top_assist_points','UPDATE') THEN
    RAISE EXCEPTION 'los puntos de las globales siguen siendo escribibles por el jugador';
  END IF;
  IF NOT has_column_privilege('authenticated','public.tournament_predictions','champion_team','INSERT')
  OR NOT has_column_privilege('authenticated','public.tournament_predictions','top_assist_name','UPDATE') THEN
    RAISE EXCEPTION 'se revocó de más: ya no se pueden elegir las globales';
  END IF;

  -- C) las globales ya no dependen de un interruptor global…
  IF has_table_privilege('anon','public.tournament_predictions','SELECT') THEN
    RAISE EXCEPTION 'anon sigue leyendo las predicciones globales';
  END IF;
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='tournament_predictions' AND cmd='SELECT'
     AND qual LIKE '%tournament_settings%';
  IF n > 0 THEN
    RAISE EXCEPTION 'la política de SELECT todavía decide con tournament_settings';
  END IF;
  -- …y sí miran la quiniela. Con DOS políticas de SELECT apiladas mandaría la
  -- más laxa (se combinan con OR): tiene que haber exactamente una.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='tournament_predictions' AND cmd='SELECT';
  IF n <> 1 THEN
    RAISE EXCEPTION 'tournament_predictions tiene % políticas de SELECT, no 1', n;
  END IF;
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='tournament_predictions' AND cmd='SELECT'
     AND qual LIKE '%puede_ver_quiniela%' AND qual LIKE '%tournament_predictions_open%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'la política de SELECT no acota por quiniela y por cierre';
  END IF;

  RAISE NOTICE '85 OK: la autorización salió del alcance del cliente.';
END $$;

COMMIT;
