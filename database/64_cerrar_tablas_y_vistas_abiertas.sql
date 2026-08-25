-- =============================================================================
-- 64_cerrar_tablas_y_vistas_abiertas.sql
-- =============================================================================
-- La migración 61 cerró las FUNCIONES, pero quedaron abiertas una tabla y tres
-- vistas. Lo encontró una auditoría de seguimiento, comprobado contra la base
-- viva. Los dos son anteriores a este trabajo, no regresiones.
--
-- 1) powerup_limits: se creó sin RLS y sin políticas (migration_gamification),
--    así que con los GRANT amplios que Supabase da por defecto CUALQUIERA con
--    la anon key podía leerla, escribirla y borrarla. Está en producción hoy.
--
--    El puntaje NO depende de esta tabla desde la migración 48: el trigger
--    check_powerup_limit lee leagues.powerup_limit, que es por quiniela. Pero
--    varias pantallas todavía la leen para MOSTRAR el cupo, así que un tercero
--    podía hacer que la app le mintiera al grupo sobre cuántos comodines le
--    quedan. Molesto y confuso, aunque no cambia puntos.
--
-- 2) user_badges_view, user_stats_view y user_tournament_points: las vistas
--    corren con los privilegios de quien las creó, así que saltan la RLS de las
--    tablas de abajo. Con SELECT para anon, cualquiera sin iniciar sesión podía
--    enumerar el padrón: ids, nombres, avatares, puntos y estadísticas. Eso
--    además dejaba sin sentido el tope del ranking global de la migración 63.
--
-- Con la app abierta al público, "authenticated" es cualquiera que se registre,
-- así que no alcanza con cerrarle a anon. Se revisó consumidor por consumidor:
--   · user_badges_view y user_tournament_points solo las usan pantallas que ya
--     NO tienen ruta (Leaderboard, TopRanking) y un endpoint del backend que
--     corre con service_role. Se les revoca a anon Y a authenticated.
--   · user_stats_view la usa ProfilePage, que sí está viva, y solo consulta la
--     fila propia. Se le deja a authenticated.
-- Idempotente.
-- =============================================================================

-- ── 1) powerup_limits ────────────────────────────────────────────────────────
ALTER TABLE public.powerup_limits ENABLE ROW LEVEL SECURITY;

-- Nadie escribe desde el cliente. Los límites que de verdad se aplican viven en
-- leagues.powerup_limit y se editan con set_group_scoring, que ya valida admin.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.powerup_limits FROM anon, authenticated;
REVOKE ALL ON public.powerup_limits FROM anon;
GRANT SELECT ON public.powerup_limits TO authenticated;

DROP POLICY IF EXISTS "powerup_limits_select_authenticated" ON public.powerup_limits;
CREATE POLICY "powerup_limits_select_authenticated" ON public.powerup_limits
  FOR SELECT TO authenticated USING (true);
-- Sin políticas de escritura a propósito: con RLS activa y sin política, todo
-- INSERT/UPDATE/DELETE desde el cliente queda bloqueado aunque alguien vuelva a
-- correr un GRANT amplio.

COMMENT ON TABLE public.powerup_limits IS
  'Límites históricos por fase/jornada. YA NO controla el puntaje: el cupo real es leagues.powerup_limit (por quiniela), que aplica check_powerup_limit. Se conserva solo de lectura para las pantallas que todavía la muestran.';

-- ── 2) Las tres vistas ───────────────────────────────────────────────────────
DO $vistas$
DECLARE v text;
BEGIN
  -- Estas dos solo las consume código muerto (pantallas sin ruta) y el backend
  -- con service_role, que no pasa por estos permisos. Se cierran del todo: si
  -- se dejaran para 'authenticated', cualquiera que se registre podría sacar el
  -- padrón completo y el tope del ranking global no serviría de nada.
  FOREACH v IN ARRAY ARRAY['user_badges_view', 'user_tournament_points']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = v) THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', v);
    END IF;
  END LOOP;

  -- Esta sí está viva (ProfilePage, que consulta solo su propia fila).
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'user_stats_view') THEN
    REVOKE ALL ON public.user_stats_view FROM anon;
    GRANT SELECT ON public.user_stats_view TO authenticated;
  END IF;
END $vistas$;

-- ── Verificación ─────────────────────────────────────────────────────────────
DO $red$
DECLARE v_abiertas text[];
BEGIN
  SELECT array_agg(DISTINCT c.relname ORDER BY c.relname) INTO v_abiertas
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('powerup_limits', 'user_badges_view', 'user_stats_view', 'user_tournament_points')
    AND (has_table_privilege('anon', c.oid, 'SELECT')
      OR has_table_privilege('anon', c.oid, 'INSERT')
      OR has_table_privilege('anon', c.oid, 'UPDATE')
      OR has_table_privilege('anon', c.oid, 'DELETE'));

  IF v_abiertas IS NOT NULL THEN
    RAISE WARNING 'REVISAR: anon todavía alcanza %', v_abiertas;
  ELSE
    RAISE NOTICE 'Correcto: anon ya no alcanza powerup_limits ni las tres vistas.';
  END IF;
END $red$;

NOTIFY pgrst, 'reload schema';
