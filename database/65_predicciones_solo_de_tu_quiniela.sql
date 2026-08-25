-- =============================================================================
-- 65_predicciones_solo_de_tu_quiniela.sql
-- =============================================================================
-- La política que destapa las predicciones dice, hoy:
--
--     auth.uid() = user_id
--     OR (SELECT kickoff_at - interval '15 minutes' <= now()
--         FROM matches WHERE id = match_id)
--
-- No filtra por quiniela. Con 17 amigos en dos ligas eso da igual — destapar es
-- justo lo que se quiere. Pero al abrir al público significa que CUALQUIERA que
-- se registre puede leer las predicciones de TODAS las personas en TODAS las
-- quinielas, de cualquier partido ya jugado. Solo hace falta la anon key, que es
-- pública, y una cuenta.
--
-- No es una regresión: está así desde patch_rls_security.sql. No lo encontró
-- ninguna de las dos auditorías porque las dos evaluaron el modelo "17 amigos",
-- donde ver las predicciones ajenas es la gracia del juego.
--
-- AHORA: se destapa igual que antes (15 min antes del saque), pero solo entre
-- quienes comparten la quiniela.
--
-- POR QUÉ NO ROMPE NADA (revisado pantalla por pantalla):
--   · HistorialTab y CaraACara ya filtran por league_id y quien mira es miembro.
--   · MatchDetailPage NO filtra por liga: pasa a mostrar solo a quienes comparten
--     quiniela con vos. Eso es la corrección, no un efecto colateral — ver la
--     predicción de un desconocido de otra quiniela nunca tuvo sentido.
--   · PowerupUsage, Leaderboard y PlayerStatsModal leen predicciones ajenas sin
--     filtrar, pero viven en pantallas que ya no tienen ruta.
--   · league_table, league_jornadas, perfil_en_quiniela y demás son
--     SECURITY DEFINER: no pasan por RLS y no se ven afectadas.
--
-- Se aprovecha para consolidar: predictions_select_own quedó viva desde el
-- schema original y las políticas permisivas se COMBINAN CON OR, así que tener
-- dos es a la vez ruido de rendimiento y una forma fácil de que un endurecimiento
-- futuro no sirva de nada sin que nadie lo note.
-- Idempotente.
-- =============================================================================

-- ── 1) Consolidar las políticas de SELECT sobre predictions ──────────────────
DO $pol$
DECLARE
  r record;
  v_borradas text[] := '{}';
  v_amplias  text[] := '{}';
BEGIN
  FOR r IN
    SELECT policyname, cmd FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'predictions'
      AND cmd IN ('SELECT', 'ALL')
  LOOP
    IF r.cmd = 'SELECT' THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.predictions', r.policyname);
      v_borradas := v_borradas || r.policyname;
    ELSE
      -- Una política FOR ALL también concede SELECT y se combinaría con OR,
      -- anulando este endurecimiento. No se toca (cubre escrituras), pero se
      -- avisa para revisarla a mano.
      v_amplias := v_amplias || r.policyname;
    END IF;
  END LOOP;

  RAISE NOTICE 'Políticas de SELECT reemplazadas: %', v_borradas;
  IF v_amplias <> '{}' THEN
    RAISE WARNING 'REVISAR: hay políticas FOR ALL sobre predictions que también conceden SELECT y podrían dejar sin efecto este cambio: %', v_amplias;
  END IF;
END $pol$;

CREATE POLICY "predictions_select_propia_o_de_mi_quiniela"
  ON public.predictions FOR SELECT
  TO authenticated
  USING (
    -- La propia, siempre y desde el primer momento.
    auth.uid() = user_id
    OR (
      -- La ajena: destapada por tiempo Y en una quiniela que compartimos.
      -- is_league_member es SECURITY DEFINER y tiene EXECUTE para authenticated
      -- justamente porque se usa acá dentro (ver migración 61).
      public.is_league_member(league_id)
      AND (SELECT m.kickoff_at - interval '15 minutes' <= now()
           FROM public.matches m WHERE m.id = match_id)
    )
  );

COMMENT ON POLICY "predictions_select_propia_o_de_mi_quiniela" ON public.predictions IS
  'Modo incógnito: las predicciones ajenas se destapan 15 min antes del saque y SOLO para quienes comparten la quiniela. Reemplaza a predictions_select_own + predictions_select_others_strict, que se combinaban con OR.';

-- ── 2) user_stats_view deja de saltarse la RLS ───────────────────────────────
-- La vista corre con los privilegios de quien la creó. Comprobado que el
-- resultado no cambia (solo agrega partidos 'finished', que la política de
-- arriba ya destapa), así que esto es defensa en profundidad: si algún día se
-- endurece esa política, la vista la respeta sola en vez de esquivarla.
DO $vista$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'user_stats_view') THEN
    EXECUTE 'ALTER VIEW public.user_stats_view SET (security_invoker = true)';
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- security_invoker existe desde PostgreSQL 15. Si la base fuera anterior, se
  -- avisa en vez de abortar la migración entera.
  RAISE WARNING 'No se pudo poner security_invoker en user_stats_view: %', SQLERRM;
END $vista$;

-- ── Verificación ─────────────────────────────────────────────────────────────
DO $red$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'predictions' AND cmd IN ('SELECT', 'ALL');

  IF v_n = 1 THEN
    RAISE NOTICE 'Correcto: una sola política de lectura sobre predictions, acotada a tu quiniela.';
  ELSE
    RAISE WARNING 'REVISAR: quedaron % políticas que conceden SELECT sobre predictions; al combinarse con OR pueden anular el filtro por quiniela.', v_n;
  END IF;
END $red$;

NOTIFY pgrst, 'reload schema';
