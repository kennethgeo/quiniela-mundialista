-- =============================================================================
-- 105_bitacora_privada_admin_con_rastro_y_push_acotado.sql
-- 28 sep 2026. Auditoría de Claude (Astra sin uso), frentes RLS, deriva y push.
-- Solo permisos, políticas, restricciones y un trigger. No modifica ni borra
-- ninguna fila existente. Idempotente.
-- =============================================================================
--
-- 1. [ALTA] EL ADMIN GLOBAL LEÍA LAS PREDICCIONES AJENAS ANTES DEL SAQUE, por
--    `prediction_logs`. La política «Usuarios ven sus propios logs» (creada a
--    mano, solo en `migration_audit_logs.sql`) dejaba ver TODO al admin, y el
--    log guarda `row_to_json(NEW)`: marcador y ×2. Ensayo revertido con el JWT
--    del admin: 259 logs de 11 personas con marcador de partidos SIN destapar,
--    mientras `predictions` le mostraba 0. Es la familia de las políticas
--    `predictions_*_admin` que borró la 99, en otra tabla. La app solo lee los
--    propios (`ProfilePage`, `.eq('user_id', profile.id)`).
--
-- 2. [MEDIA] EL ADMIN GLOBAL PODÍA REABRIR UN PARTIDO EN VIVO Y NO QUEDABA RASTRO.
--    `matches_update_admin` le da UPDATE a todas las columnas, incluida
--    `predictions_force_open`, y la rama «forzado» de las políticas de
--    predicciones solo excluía terminado/cancelado/pospuesto: con el partido
--    `in_progress`, abrir → corregir la predicción propia → cerrar. Y
--    `registrar_correccion_partido` no anotaba ni el forzado ni el saque.
--    Ensayo revertido: «force_open filas=1 | pred editada filas=1 |
--    match_audit nuevas=0». También podía escribir la firma de puntaje
--    (`puntuado_con`) a mano y esconder un partido de la recuperación.
--      a) La rama forzada exige ahora `status = 'pending'`: se reabre un
--         partido que no empezó (el caso real: un saque que se atrasó).
--      b) El cliente conserva UPDATE solo de las columnas que usan
--         MatchResultsAdmin y BracketAdmin. La firma y las marcas de puntaje
--         quedan para el backend. Se quita INSERT y DELETE (nadie los usa).
--      c) Se auditan también el forzado y el cambio de saque.
--
-- 3. [MEDIA] PUSH A CUALQUIER URL. `push_subscriptions` aceptaba cualquier
--    `endpoint` (ensayo: `http://169.254.169.254/...` ACEPTADO) y sin tope de
--    filas: el backend le hace un POST a cada una. Ahora solo https a los
--    proveedores de push reales, y hasta 10 dispositivos por persona. Las 13
--    de hoy son de FCM, Apple y WNS: ninguna se cae.
--
-- 4. [BAJA] EL CHAT ACEPTABA LA FECHA DEL CLIENTE (`created_at` 2099: el
--    mensaje quedaba fijo arriba). El cliente inserta solo `user_id` y
--    `content`, que es lo que manda `GlobalChatDrawer`.
--
-- 5. Limpieza del mismo tipo: `users` conservaba INSERT y DELETE de tabla para
--    `authenticated` (inertes por la RLS, pero a una política de distancia) y
--    una política de UPDATE duplicada `TO public`. `prediction_logs` tenía
--    INSERT/UPDATE/DELETE de tabla y SELECT para `anon`.
-- =============================================================================

BEGIN;

-- 1 ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Usuarios ven sus propios logs" ON public.prediction_logs;
DROP POLICY IF EXISTS prediction_logs_select_own ON public.prediction_logs;
CREATE POLICY prediction_logs_select_own ON public.prediction_logs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
REVOKE ALL ON TABLE public.prediction_logs FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.prediction_logs FROM authenticated;

-- 2a --------------------------------------------------------------------------
ALTER POLICY predictions_insert_own_unlocked ON public.predictions
  WITH CHECK ((auth.uid() = user_id) AND is_league_member(league_id) AND (EXISTS ( SELECT 1
     FROM (matches m
       JOIN leagues l ON ((l.tournament_id = m.tournament_id)))
    WHERE ((m.id = predictions.match_id) AND (l.id = predictions.league_id)))) AND ( SELECT ((((m.kickoff_at - '00:15:00'::interval) > now()) AND (m.status <> ALL (ARRAY['finished'::text, 'cancelled'::text, 'postponed'::text]))) OR (COALESCE(m.predictions_force_open, false) AND m.status = 'pending'))
     FROM matches m
    WHERE (m.id = predictions.match_id)));

ALTER POLICY predictions_update_own_unlocked ON public.predictions
  USING ((auth.uid() = user_id) AND ( SELECT ((((m.kickoff_at - '00:15:00'::interval) > now()) AND (m.status <> ALL (ARRAY['finished'::text, 'cancelled'::text, 'postponed'::text]))) OR (COALESCE(m.predictions_force_open, false) AND m.status = 'pending'))
     FROM matches m
    WHERE (m.id = predictions.match_id)))
  WITH CHECK ((auth.uid() = user_id) AND is_league_member(league_id) AND (EXISTS ( SELECT 1
     FROM (matches m
       JOIN leagues l ON ((l.tournament_id = m.tournament_id)))
    WHERE ((m.id = predictions.match_id) AND (l.id = predictions.league_id)))) AND ( SELECT ((((m.kickoff_at - '00:15:00'::interval) > now()) AND (m.status <> ALL (ARRAY['finished'::text, 'cancelled'::text, 'postponed'::text]))) OR (COALESCE(m.predictions_force_open, false) AND m.status = 'pending'))
     FROM matches m
    WHERE (m.id = predictions.match_id)));

-- 2b --------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON TABLE public.matches FROM authenticated;
REVOKE ALL ON TABLE public.matches FROM anon;
GRANT SELECT ON TABLE public.matches TO anon;  -- lo que ya tenía (inerte sin política para anon)
GRANT UPDATE (status, kickoff_at, home_goals_actual, away_goals_actual,
              goes_to_penalties, penalties_winner_real, score_locked,
              predictions_force_open,
              home_team, away_team, home_team_code, away_team_code)
  ON public.matches TO authenticated;

-- 2c --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_correccion_partido()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_marcador_antes text;
  v_marcador_despues text;
BEGIN
  IF v_actor IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.home_goals_actual IS DISTINCT FROM OLD.home_goals_actual
     OR NEW.away_goals_actual IS DISTINCT FROM OLD.away_goals_actual THEN
    v_marcador_antes   := COALESCE(OLD.home_goals_actual::text, '-') || '-' || COALESCE(OLD.away_goals_actual::text, '-');
    v_marcador_despues := COALESCE(NEW.home_goals_actual::text, '-') || '-' || COALESCE(NEW.away_goals_actual::text, '-');
    INSERT INTO public.match_audit (match_id, changed_by, campo, valor_antes, valor_despues)
    VALUES (NEW.id, v_actor, 'marcador', v_marcador_antes, v_marcador_despues);
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.match_audit (match_id, changed_by, campo, valor_antes, valor_despues)
    VALUES (NEW.id, v_actor, 'estado', OLD.status, NEW.status);
  END IF;

  IF NEW.goes_to_penalties IS DISTINCT FROM OLD.goes_to_penalties
     OR NEW.penalties_winner_real IS DISTINCT FROM OLD.penalties_winner_real THEN
    INSERT INTO public.match_audit (match_id, changed_by, campo, valor_antes, valor_despues)
    VALUES (NEW.id, v_actor, 'penales',
            CASE WHEN OLD.goes_to_penalties THEN COALESCE(OLD.penalties_winner_real, 'si') ELSE 'no' END,
            CASE WHEN NEW.goes_to_penalties THEN COALESCE(NEW.penalties_winner_real, 'si') ELSE 'no' END);
  END IF;

  IF NEW.score_locked IS DISTINCT FROM OLD.score_locked THEN
    INSERT INTO public.match_audit (match_id, changed_by, campo, valor_antes, valor_despues)
    VALUES (NEW.id, v_actor, 'candado',
            CASE WHEN OLD.score_locked THEN 'fijado' ELSE 'libre' END,
            CASE WHEN NEW.score_locked THEN 'fijado' ELSE 'libre' END);
  END IF;

  -- 105: reabrir predicciones y mover el saque también deciden quién puede
  -- predecir y hasta cuándo. Sin rastro, el admin (que también juega) podía
  -- abrir, corregir lo suyo y cerrar sin que nadie lo viera.
  IF NEW.predictions_force_open IS DISTINCT FROM OLD.predictions_force_open THEN
    INSERT INTO public.match_audit (match_id, changed_by, campo, valor_antes, valor_despues)
    VALUES (NEW.id, v_actor, 'predicciones_forzadas',
            CASE WHEN COALESCE(OLD.predictions_force_open, false) THEN 'abiertas' ELSE 'normal' END,
            CASE WHEN COALESCE(NEW.predictions_force_open, false) THEN 'abiertas' ELSE 'normal' END);
  END IF;

  IF NEW.kickoff_at IS DISTINCT FROM OLD.kickoff_at THEN
    INSERT INTO public.match_audit (match_id, changed_by, campo, valor_antes, valor_despues)
    VALUES (NEW.id, v_actor, 'saque', OLD.kickoff_at::text, NEW.kickoff_at::text);
  END IF;

  RETURN NEW;
END; $function$;

-- 3 ---------------------------------------------------------------------------
ALTER TABLE public.push_subscriptions DROP CONSTRAINT IF EXISTS push_endpoint_conocido;
ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_endpoint_conocido CHECK (
  endpoint ~ '^https://((fcm|android)\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/'
);

CREATE OR REPLACE FUNCTION public.tope_de_dispositivos_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF (SELECT count(*) FROM public.push_subscriptions WHERE user_id = NEW.user_id) >= 10 THEN
    RAISE EXCEPTION 'Demasiados dispositivos con avisos (máximo 10): desactivá alguno desde su perfil'
      USING ERRCODE = '54000';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tope_de_dispositivos_push() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS push_tope_de_dispositivos ON public.push_subscriptions;
CREATE TRIGGER push_tope_de_dispositivos BEFORE INSERT ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.tope_de_dispositivos_push();

-- 4 ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE ON TABLE public.global_chat FROM authenticated;
GRANT INSERT (user_id, content) ON public.global_chat TO authenticated;

-- 5 ---------------------------------------------------------------------------
REVOKE INSERT, DELETE ON TABLE public.users FROM authenticated;
DROP POLICY IF EXISTS "Actualizar perfil propio" ON public.users;  -- duplicaba users_update_own, TO public

-- Comprobaciones ---------------------------------------------------------------
DO $comprobar$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'prediction_logs'
             AND cmd IN ('SELECT', 'ALL') AND COALESCE(qual, '') ILIKE '%is_admin%') THEN
    RAISE EXCEPTION '105: prediction_logs sigue abierta al admin';
  END IF;
  IF has_column_privilege('authenticated', 'public.matches', 'puntuado_con', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.matches', 'puntaje_pendiente_desde', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.matches', 'INSERT')
     OR has_table_privilege('authenticated', 'public.matches', 'DELETE') THEN
    RAISE EXCEPTION '105: el cliente sigue pudiendo escribir la firma de puntaje o crear/borrar partidos';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.matches', 'predictions_force_open', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.matches', 'home_team_code', 'UPDATE') THEN
    RAISE EXCEPTION '105: se le quitó al panel del admin una columna que usa';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'predictions'
             AND policyname IN ('predictions_insert_own_unlocked', 'predictions_update_own_unlocked')
             AND COALESCE(with_check, '') NOT ILIKE '%status = ''pending''%') THEN
    RAISE EXCEPTION '105: la rama forzada de predicciones no exige partido sin empezar';
  END IF;
  IF has_column_privilege('authenticated', 'public.global_chat', 'created_at', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'public.global_chat', 'content', 'INSERT') THEN
    RAISE EXCEPTION '105: permisos del chat';
  END IF;
  IF has_table_privilege('authenticated', 'public.users', 'INSERT')
     OR has_table_privilege('authenticated', 'public.users', 'DELETE') THEN
    RAISE EXCEPTION '105: users sigue con INSERT/DELETE para el cliente';
  END IF;
END
$comprobar$;

COMMIT;
