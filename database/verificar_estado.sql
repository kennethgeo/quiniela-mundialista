-- =============================================================================
-- verificar_estado.sql  ·  ¿La base coincide con el repo?  (SOLO LECTURA)
-- =============================================================================
-- Las migraciones se corren a mano, así que schema.sql dejó de describir la
-- base hace rato. Eso ya mordió dos veces:
--   · predictions_update_admin y predictions_insert_admin existen en producción
--     y NO están en ningún archivo de database/ — se crearon en el dashboard;
--   · la migración 61 revoca EXECUTE en bloque, así que una RPC nueva que no
--     esté en su inventario se queda muda en la siguiente corrida.
--
-- Este archivo NO CAMBIA NADA. Solo consulta y compara. Correlo cuando dudes,
-- después de aplicar migraciones, o antes de abrir al público.
--
-- Generado desde el repo el 2026-08-26
-- (57 funciones, 33 con permiso esperado).
-- =============================================================================

\echo '=== 1. Funciones que el repo define y NO existen en la base ==='
SELECT x AS falta
FROM unnest(ARRAY[
    '_apply_rule_proposal',
  '_resolve_expired_proposals',
  '_tally_rule_proposal',
  'accept_group_rules',
  'avisar_pago',
  'cancel_rule_proposal',
  'cast_rule_vote',
  'check_powerup_limit',
  'check_single_powerup_per_matchday',
  'confirmar_pago',
  'congelar_campos_sensibles_users',
  'consume_powerup_credit',
  'create_group',
  'delete_group',
  'es_admin_liga',
  'es_backend',
  'expulsar_miembro',
  'group_standings',
  'group_tournament_started',
  'handle_new_user',
  'is_league_member',
  'join_group_by_code',
  'league_jornadas',
  'league_medals',
  'league_miembros',
  'league_points',
  'league_pozo',
  'league_proposals',
  'league_rank',
  'league_table',
  'log_prediction_changes',
  'match_audit_log',
  'mi_resumen_global',
  'my_groups',
  'my_medals',
  'my_powerup_credits',
  'perfil_en_quiniela',
  'propose_rule_change',
  'ranking_global',
  'recompute_league_badges',
  'recompute_user_total',
  'registrar_correccion_partido',
  'reject_banned_signup',
  'resolve_pending_powerup_credits',
  'seed_default_predictions',
  'set_group_extras',
  'set_group_rules',
  'set_group_scoring',
  'set_league_admin',
  'set_league_pozo',
  'totales_desalineados',
  'tournament_predictions_open',
  'trg_recompute_user_total',
  'trg_seed_default_predictions',
  'update_updated_at',
  'user_total_calculado',
  'void_cancelled_match'
]::text[]) x
WHERE NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = x);

\echo '=== 2. Funciones en la base que el repo NO define (deriva) ==='
SELECT p.proname AS sobra, p.prosecdef AS es_security_definer
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname <> ALL (ARRAY[
    '_apply_rule_proposal',
  '_resolve_expired_proposals',
  '_tally_rule_proposal',
  'accept_group_rules',
  'avisar_pago',
  'cancel_rule_proposal',
  'cast_rule_vote',
  'check_powerup_limit',
  'check_single_powerup_per_matchday',
  'confirmar_pago',
  'congelar_campos_sensibles_users',
  'consume_powerup_credit',
  'create_group',
  'delete_group',
  'es_admin_liga',
  'es_backend',
  'expulsar_miembro',
  'group_standings',
  'group_tournament_started',
  'handle_new_user',
  'is_league_member',
  'join_group_by_code',
  'league_jornadas',
  'league_medals',
  'league_miembros',
  'league_points',
  'league_pozo',
  'league_proposals',
  'league_rank',
  'league_table',
  'log_prediction_changes',
  'match_audit_log',
  'mi_resumen_global',
  'my_groups',
  'my_medals',
  'my_powerup_credits',
  'perfil_en_quiniela',
  'propose_rule_change',
  'ranking_global',
  'recompute_league_badges',
  'recompute_user_total',
  'registrar_correccion_partido',
  'reject_banned_signup',
  'resolve_pending_powerup_credits',
  'seed_default_predictions',
  'set_group_extras',
  'set_group_rules',
  'set_group_scoring',
  'set_league_admin',
  'set_league_pozo',
  'totales_desalineados',
  'tournament_predictions_open',
  'trg_recompute_user_total',
  'trg_seed_default_predictions',
  'update_updated_at',
  'user_total_calculado',
  'void_cancelled_match'
]::text[])
ORDER BY p.proname;

\echo '=== 3. RPC que el frontend llama y NO puede ejecutar (pantalla muerta) ==='
SELECT x AS sin_permiso
FROM unnest(ARRAY[
    'accept_group_rules',
  'avisar_pago',
  'cancel_rule_proposal',
  'cast_rule_vote',
  'confirmar_pago',
  'create_group',
  'delete_group',
  'es_admin_liga',
  'es_backend',
  'expulsar_miembro',
  'group_standings',
  'is_league_member',
  'join_group_by_code',
  'league_jornadas',
  'league_medals',
  'league_miembros',
  'league_pozo',
  'league_proposals',
  'match_audit_log',
  'mi_resumen_global',
  'my_groups',
  'my_medals',
  'my_powerup_credits',
  'perfil_en_quiniela',
  'propose_rule_change',
  'ranking_global',
  'recompute_league_badges',
  'set_group_extras',
  'set_group_rules',
  'set_group_scoring',
  'set_league_admin',
  'set_league_pozo',
  'tournament_predictions_open'
]::text[]) x
WHERE EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = x)
  AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = x
                    AND has_function_privilege('authenticated', p.oid, 'EXECUTE'));

\echo '=== 4. SECURITY DEFINER alcanzables por anon (debe salir vacío) ==='
SELECT p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef
  AND has_function_privilege('anon', p.oid, 'EXECUTE')
ORDER BY p.proname;

\echo '=== 5. Funciones usadas en políticas RLS sin EXECUTE (rompe lecturas) ==='
SELECT DISTINCT m[1] AS funcion
FROM pg_policies pol,
     LATERAL regexp_matches(COALESCE(pol.qual,'') || ' ' || COALESCE(pol.with_check,''),
                            '(?:public\.)?([a-z_][a-z0-9_]*)\s*\(', 'g') AS m
WHERE pol.schemaname = 'public'
  AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = m[1])
  AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = m[1]
                    AND has_function_privilege('authenticated', p.oid, 'EXECUTE'));

\echo '=== 6. Tablas sin RLS que anon puede escribir (así estaba powerup_limits) ==='
SELECT c.relname AS tabla, c.relrowsecurity AS tiene_rls,
       has_table_privilege('anon', c.oid, 'INSERT') AS anon_insert,
       has_table_privilege('anon', c.oid, 'UPDATE') AS anon_update,
       has_table_privilege('anon', c.oid, 'DELETE') AS anon_delete
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND (has_table_privilege('anon', c.oid, 'INSERT')
    OR has_table_privilege('anon', c.oid, 'UPDATE')
    OR has_table_privilege('anon', c.oid, 'DELETE'))
ORDER BY c.relname;

\echo '=== 7. Vistas alcanzables por anon (saltan la RLS) ==='
SELECT c.relname AS vista
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'v'
  AND has_table_privilege('anon', c.oid, 'SELECT')
ORDER BY c.relname;

\echo '=== 8. Políticas de predictions (una sola de SELECT, con filtro por liga) ==='
SELECT policyname, cmd,
       qual LIKE '%is_league_member%' AS filtra_por_liga,
       with_check LIKE '%kickoff_at%' AS candado_de_15_min
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'predictions'
ORDER BY cmd, policyname;

\echo '=== 9. Columnas sensibles de users que el cliente puede tocar ==='
SELECT grantee, privilege_type, column_name
FROM information_schema.column_privileges
WHERE table_schema = 'public' AND table_name = 'users'
  AND grantee IN ('anon', 'authenticated')
  AND column_name IN ('is_admin', 'total_points', 'points_adjustment', 'email')
ORDER BY grantee, privilege_type, column_name;

\echo '=== 10. Totales globales descuadrados (debe salir vacío) ==='
SELECT u.display_name, u.total_points AS guardado,
       public.user_total_calculado(u.id) AS calculado
FROM public.users u
WHERE u.total_points IS DISTINCT FROM public.user_total_calculado(u.id);
