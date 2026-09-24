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
-- Regenerado desde el repo el 2026-09-21
-- (75 funciones esperadas · 39 con EXECUTE para authenticated, que son las 34
--  que el frontend llama con supabase.rpc() más las 5 que se evalúan dentro de
--  políticas RLS: es_admin_liga, es_backend, is_league_member,
--  puede_ver_quiniela y tournament_predictions_open).
--
-- TRES FUNCIONES QUE EL REPO DEFINE Y QUE A PROPÓSITO NO VAN EN EL INVENTARIO,
-- porque en producción no existen y no deben existir. Listarlas haría que la
-- sección 1 gritara todas las veces, y una comprobación que avisa de lo normal
-- se termina ignorando:
--   · seed_default_predictions / trg_seed_default_predictions
--     (17_default_prediction_0_0.sql) — el default 0-0 se probó y se quitó
--     "a partir de ahora" en junio de 2026;
--   · check_single_powerup_per_matchday (powerup_trigger.sql) — la reemplazó
--     check_powerup_limit, que valida contra el cupo Y los créditos.
--
-- Y UNA AL REVÉS, que existe en la base y ningún archivo de database/ crea:
--   · _recompute_league_badges_inner — misma familia que
--     predictions_update_admin / predictions_insert_admin: nació a mano en el
--     dashboard. Va en el inventario para que la sección 2 no la marque, pero
--     es deriva de verdad y sigue sin estar escrita en ningún lado.
--
-- La 74.ª es `claim_notification_deliveries` (migración 82), que va en
-- `v_backend` de la 61 y NO en `v_frontend`: la llama el backend con
-- service_role. Comprobado contra producción el 21 sep 2026: 74 funciones y 38
-- con EXECUTE para `authenticated`, o sea que la RPC nueva NO se lo ganó.
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
  'set_group_extras',
  'set_group_rules',
  'set_group_scoring',
  'set_league_admin',
  'set_league_pozo',
  'totales_desalineados',
  'tournament_predictions_open',
  'trg_recompute_user_total',
  'update_updated_at',
  'user_total_calculado',
  'void_cancelled_match',
  '_recompute_league_badges_inner',
  'es_admin_global',
  'puede_ver_quiniela',
  'quiniela_por_id',
  -- Migraciones 67, 68, 72 y 73 (cupo de comodines ×2)
  'cupo_powerups',
  'cupos_por_jornada',
  'set_powerup_limits',
  'fases_del_torneo',
  'clave_fase',
  'llave_cupo',
  'fase_ya_empezo',
  'powerup_limits_valido',
  -- Migraciones 79 y 81 (el cron vive en la base, no en GitHub Actions)
  'hay_partidos_en_ventana',
  'llamar_backend',
  'cron_sync_en_vivo',
  'cron_recordatorio_saque',
  'cron_resumen_diario',
  'hay_resultados_sin_escribir',
  'cron_rescate_resultados',
  -- Migración 82 (deduplicación de recordatorios)
  'claim_notification_deliveries',
  -- Migración 83 (salida voluntaria)
  'salir_de_quiniela',
  -- Migraciones 88, 89 y 90. Faltaban acá y la sección 2 las marcaba como
  -- deriva en falso: lo cazó la cuarta auditoría. Ninguna la llama el
  -- navegador, así que NO van en la sección 3.
  'cuota_no_reescribe_pagos',
  'hay_avisos_por_reintentar',
  '_conteo_votacion',
  'identidad_de_prediccion_fija',
  'aplicar_puntaje',
  'hay_puntajes_pendientes',
  'resultado_cambiado_invalida_firma',
  'pago_confirmado_no_se_borra',
  'prediccion_modificada',
  'partidos_pendientes_de_puntaje'
]::text[]) x
WHERE NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = x);

\echo '=== 2. Funciones en la base que el repo NO define (deriva) ==='
SELECT p.proname AS sobra, p.prosecdef AS es_security_definer
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  -- Las funciones que trae una extensión (unaccent, pgcrypto…) no las define el
  -- repo y no son deriva: aparecerían siempre como falso positivo.
  AND NOT EXISTS (SELECT 1 FROM pg_depend d
                  WHERE d.objid = p.oid AND d.deptype = 'e')
  AND p.proname <> ALL (ARRAY[
    '_apply_rule_proposal',
  '_resolve_expired_proposals',
  '_tally_rule_proposal',
  'accept_group_rules',
  'avisar_pago',
  'cancel_rule_proposal',
  'cast_rule_vote',
  'check_powerup_limit',
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
  'set_group_extras',
  'set_group_rules',
  'set_group_scoring',
  'set_league_admin',
  'set_league_pozo',
  'totales_desalineados',
  'tournament_predictions_open',
  'trg_recompute_user_total',
  'update_updated_at',
  'user_total_calculado',
  'void_cancelled_match',
  '_recompute_league_badges_inner',
  'es_admin_global',
  'puede_ver_quiniela',
  'quiniela_por_id',
  -- Migraciones 67, 68, 72 y 73 (cupo de comodines ×2)
  'cupo_powerups',
  'cupos_por_jornada',
  'set_powerup_limits',
  'fases_del_torneo',
  'clave_fase',
  'llave_cupo',
  'fase_ya_empezo',
  'powerup_limits_valido',
  -- Migraciones 79 y 81 (el cron vive en la base, no en GitHub Actions)
  'hay_partidos_en_ventana',
  'llamar_backend',
  'cron_sync_en_vivo',
  'cron_recordatorio_saque',
  'cron_resumen_diario',
  'hay_resultados_sin_escribir',
  'cron_rescate_resultados',
  -- Migración 82 (deduplicación de recordatorios)
  'claim_notification_deliveries',
  -- Migración 83 (salida voluntaria)
  'salir_de_quiniela',
  -- Migraciones 88, 89 y 90. Faltaban acá y la sección 2 las marcaba como
  -- deriva en falso: lo cazó la cuarta auditoría. Ninguna la llama el
  -- navegador, así que NO van en la sección 3.
  'cuota_no_reescribe_pagos',
  'hay_avisos_por_reintentar',
  '_conteo_votacion',
  'identidad_de_prediccion_fija',
  'aplicar_puntaje',
  'hay_puntajes_pendientes',
  'resultado_cambiado_invalida_firma',
  'pago_confirmado_no_se_borra',
  'prediccion_modificada',
  'partidos_pendientes_de_puntaje'
]::text[])
ORDER BY p.proname;

\echo '=== 3. RPC/helpers que authenticated necesita y NO puede ejecutar (pantalla muerta) ==='
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
  'tournament_predictions_open',
  'puede_ver_quiniela',
  'quiniela_por_id',
  -- Migraciones 67 y 68 (cupo de comodines ×2)
  'cupos_por_jornada',
  'set_powerup_limits',
  'fases_del_torneo',
  'salir_de_quiniela'
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

\echo '=== 6. Tablas que anon puede escribir, con o sin RLS (así estaba powerup_limits) ==='
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
       qual LIKE '%puede_ver_quiniela%' AS filtra_por_liga,
       with_check LIKE '%kickoff_at%' AS candado_de_15_min
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'predictions'
ORDER BY cmd, policyname;

\echo '=== 9. Columnas sensibles de users que el cliente puede tocar ==='
-- UN GRANT NO ES UN AGUJERO SI LA RLS NO LO DEJA PASAR, y la versión anterior
-- de esta sección no hacía esa distinción: soltaba once filas entre las que
-- estaba «authenticated INSERT is_admin», que leído así parece que cualquiera
-- puede hacerse administrador. Hicieron falta tres consultas más para concluir
-- que no: `users` tiene la RLS activa y su ÚNICA política de INSERT es
-- `users_insert_via_trigger`, solo para `service_role` (las filas las crea
-- `handle_new_user`). El grant de columna está, pero no hay por dónde usarlo.
--
-- Una comprobación que obliga a investigar a mano cada vez que se corre es una
-- que se termina ignorando — la misma lección de la sección 11. Ahora cada
-- fila dice si es ALCANZABLE de verdad. Lo único que hay que mirar son esas.
--
-- Comprobado a la contra: `display_name` sale ALCANZABLE en UPDATE (política
-- `users_update_own`) e inerte en INSERT, así que la clasificación distingue.
SELECT cp.grantee, cp.privilege_type, cp.column_name,
       CASE
         WHEN cp.privilege_type IN ('SELECT', 'REFERENCES')
           THEN 'no es escritura'
         WHEN EXISTS (SELECT 1 FROM pg_policies pol
                      WHERE pol.schemaname = 'public' AND pol.tablename = 'users'
                        AND pol.cmd IN (cp.privilege_type, 'ALL')
                        AND pol.roles::text[] && ARRAY[cp.grantee::text, 'public'::text])
           THEN 'ALCANZABLE: hay politica RLS que lo admite'
         ELSE 'inerte: el grant existe, ninguna politica RLS lo admite'
       END AS de_verdad
FROM information_schema.column_privileges cp
WHERE cp.table_schema = 'public' AND cp.table_name = 'users'
  AND cp.grantee IN ('anon', 'authenticated')
  AND cp.column_name IN ('is_admin', 'total_points', 'points_adjustment', 'email')
ORDER BY 4 DESC, 1, 2, 3;

\echo '=== 10. Totales globales descuadrados (debe salir vacío) ==='
-- La fórmula va expandida y NO llama a user_total_calculado(): esa función está
-- restringida a service_role, así que un rol de auditoría de solo lectura no
-- podría ejecutarla y esta sección fallaría con "permission denied" en vez de
-- decir si los totales cuadran. Tiene que ser idéntica a la de la migración 62:
-- cada partido cuenta UNA vez (el mejor puntaje entre tus quinielas) y cada
-- torneo una vez para campeón/goleador/asistidor.
SELECT u.display_name,
       COALESCE(u.total_points, 0) AS guardado,
       (
           COALESCE((SELECT SUM(x.mejor) FROM (
             SELECT MAX(COALESCE(p.points_earned, 0)) AS mejor
             FROM public.predictions p WHERE p.user_id = u.id GROUP BY p.match_id) x), 0)
         + COALESCE((SELECT SUM(y.c + y.g + y.a) FROM (
             SELECT MAX(COALESCE(tp.champion_points, 0))   AS c,
                    MAX(COALESCE(tp.top_scorer_points, 0)) AS g,
                    MAX(COALESCE(tp.top_assist_points, 0)) AS a
             FROM public.tournament_predictions tp
             WHERE tp.user_id = u.id GROUP BY tp.tournament_id) y), 0)
         + COALESCE(u.points_adjustment, 0)
       )::integer AS calculado
FROM public.users u
WHERE COALESCE(u.total_points, 0) IS DISTINCT FROM (
           COALESCE((SELECT SUM(x.mejor) FROM (
             SELECT MAX(COALESCE(p.points_earned, 0)) AS mejor
             FROM public.predictions p WHERE p.user_id = u.id GROUP BY p.match_id) x), 0)
         + COALESCE((SELECT SUM(y.c + y.g + y.a) FROM (
             SELECT MAX(COALESCE(tp.champion_points, 0))   AS c,
                    MAX(COALESCE(tp.top_scorer_points, 0)) AS g,
                    MAX(COALESCE(tp.top_assist_points, 0)) AS a
             FROM public.tournament_predictions tp
             WHERE tp.user_id = u.id GROUP BY tp.tournament_id) y), 0)
         + COALESCE(u.points_adjustment, 0)
       )::integer;

\echo '=== 11. RPC del frontend que por dentro llaman a una función de admin (400 mudo) ==='
-- CÓMO SE VE ESTE FALLO: la RPC la puede ejecutar `authenticated`, así que
-- parece abierta, pero adentro llama a una función que hace
-- `RAISE EXCEPTION` si quien llama no es el backend ni el admin GLOBAL.
-- SECURITY DEFINER no cambia `auth.uid()`, así que el portero ve al jugador y
-- lo rechaza; plpgsql lo manda como SQLSTATE P0001 y PostgREST lo traduce a
-- **HTTP 400**. O sea: la consulta entera falla para todo el mundo menos para
-- el admin, y si la pantalla se come el error (un `{}` por defecto) el síntoma
-- no es un cartel rojo sino un número de menos.
--
-- Pasó con `my_powerup_credits`, que arrastraba desde la migración 50 un
-- `PERFORM resolve_pending_powerup_credits(...)` —de cuando esa función no
-- comprobaba nada— y se lo comió la 61 al ponerle portero. Lo arregló la 80.
--
-- Medido al escribir esta sección: con estos filtros salen 2 «porteras» y UN
-- solo hallazgo, el de arriba. Pedir las tres cosas a la vez es lo que la hace
-- callada: con solo `es_backend()` también salía `league_table`, que rechaza a
-- quien no es MIEMBRO —otra cosa distinta y perfectamente normal—, y una
-- comprobación que avisa de lo normal se termina ignorando.
WITH porteras AS (
  SELECT p.oid, p.proname
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosrc ILIKE '%raise exception%'
    AND p.prosrc ILIKE '%es_backend()%'
    AND p.prosrc ILIKE '%is_admin%'
), del_frontend AS (
  SELECT p.oid, p.proname, p.prosrc
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
)
SELECT DISTINCT f.proname AS rpc_que_llama_el_cliente,
                q.proname AS portero_que_la_hace_fallar
FROM del_frontend f
JOIN porteras q ON q.proname <> f.proname AND f.prosrc ILIKE '%' || q.proname || '%'
ORDER BY 1, 2;

\echo '=== 12. Las tareas de pg_cron: ¿están agendadas y corriendo? ==='
-- ESTE ARCHIVO NO MIRABA EL CRON, y desde la migración 79 el cron ES la base:
-- el sync de marcadores, el recordatorio del saque y el resumen de las 6 am los
-- dispara pg_cron, no GitHub Actions. Una tarea apagada o atrasada no da ningún
-- error: simplemente la app deja de enterarse de los partidos.
--
-- EL MARGEN SALE DEL PROPIO `schedule`, no es un número fijo. Con un umbral
-- plano de 2 horas, `resumen-diario` (que corre una vez al día) salía marcada
-- como atrasada SIEMPRE — y una comprobación que avisa de lo normal se termina
-- ignorando, que es la lección ya escrita para la sección 11. Se tolera 3x el
-- intervalo nominal, y 5 minutos para la de cada minuto.
--
-- «nunca corrió» es un HECHO, no una acusación: una tarea recién agendada
-- todavía no tuvo su turno. Quien lee sabe si la acaba de crear.
SELECT j.jobname, j.schedule, j.active,
       u.ultima_corrida AT TIME ZONE 'UTC' AS ultima_corrida_utc,
       u.ultimo_estado,
       CASE
         WHEN NOT j.active                          THEN 'APAGADA'
         WHEN u.ultima_corrida IS NULL              THEN 'nunca corrio (recien agendada?)'
         WHEN u.ultimo_estado <> 'succeeded'        THEN 'ULTIMA CORRIDA FALLO'
         WHEN now() - u.ultima_corrida > tol.margen THEN 'ATRASADA: no corre hace rato'
         ELSE 'ok'
       END AS senal
FROM cron.job j
LEFT JOIN LATERAL (
  SELECT r.start_time AS ultima_corrida, r.status AS ultimo_estado
  FROM cron.job_run_details r
  WHERE r.jobid = j.jobid ORDER BY r.start_time DESC LIMIT 1
) u ON true
CROSS JOIN LATERAL (
  SELECT CASE
    WHEN j.schedule = '* * * * *' THEN interval '5 minutes'
    WHEN j.schedule ~ '^\*/[0-9]+ \* \* \* \*$'
      THEN (substring(j.schedule from '^\*/([0-9]+)')::int * 3) * interval '1 minute'
    ELSE interval '25 hours'
  END AS margen
) tol
ORDER BY j.jobname;

\echo '=== 13. Secretos del cron en Vault (debe salir vacío) ==='
-- EL MODO DE FALLO MÁS CALLADO QUE TIENE HOY LA APP. `llamar_backend` saca de
-- Vault la URL y el CRON_SECRET; si falta cualquiera de los dos, la función
-- registra un WARNING y **devuelve sin llamar a nadie**. La tarea de pg_cron
-- queda marcada `succeeded`, la sección 12 dice «ok», y sin embargo no se está
-- sincronizando nada. Sin esta comprobación, la agenda entera puede verse sana
-- con el teléfono descolgado.
--
-- Solo se mira el NOMBRE. El valor no se selecciona nunca: este archivo se
-- corre y se pega en un chat.
SELECT x AS secreto_que_falta
FROM unnest(ARRAY['cron_secret', 'backend_base_url']::text[]) x
WHERE NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets v WHERE v.name = x);

\echo '=== 14. Columnas que SON la autorización o el pozo, escribibles por el cliente ==='
-- LA FAMILIA ENTERA QUE DESTAPÓ LA AUDITORÍA DEL 22 SEP 2026, y que ninguna de
-- las trece secciones anteriores podía ver: la sección 6 solo mira a `anon`, y
-- la 9 solo mira `users`. El agujero estaba en `authenticated`, sobre tablas
-- que sí tienen RLS y políticas de aspecto razonable.
--
-- El fallo no es «la política está mal», es que la política responde «¿la fila
-- es tuya?» cuando la pregunta era «¿quién sos?». Con `es_admin` escribible,
-- cualquiera se auto-nombraba co-admin de una quiniela ajena; con
-- `points_earned` escribible, cualquiera se ponía 9999 puntos (comprobado:
-- 43 → 10042); con `pago_confirmado_at` escribible, cualquiera se daba por
-- pagado en un pozo de ₡170.000. Lo cerró la migración 85.
--
-- OJO CON POSTGRES al arreglar algo de acá: un REVOKE de COLUMNA **no resta**
-- de un GRANT de TABLA. Hay que quitar el de tabla y volver a otorgar la lista
-- exacta de columnas, o la comprobación pasa sin haber cambiado nada.
--
-- Y se exige que sea ALCANZABLE, no solo que el privilegio exista: `users`
-- conserva un GRANT de INSERT sobre estas columnas que no sirve de nada
-- porque la única política de INSERT de esa tabla es `TO service_role`.
-- Una comprobación que avisa de lo normal se termina ignorando — es la misma
-- lección que la sección 11.
SELECT c.relname AS tabla, a.attname AS columna,
       (has_column_privilege('authenticated', c.oid, a.attname, 'INSERT') AND pol.insert_ok) AS puede_insertar,
       (has_column_privilege('authenticated', c.oid, a.attname, 'UPDATE') AND pol.update_ok) AS puede_actualizar
FROM pg_class c
JOIN pg_attribute a ON a.attrelid = c.oid
CROSS JOIN LATERAL (
  SELECT EXISTS (SELECT 1 FROM pg_policies pp
                  WHERE pp.schemaname='public' AND pp.tablename=c.relname
                    AND pp.cmd IN ('INSERT','ALL')
                    AND (pp.roles && ARRAY['authenticated','public']::name[])) AS insert_ok,
         EXISTS (SELECT 1 FROM pg_policies pp
                  WHERE pp.schemaname='public' AND pp.tablename=c.relname
                    AND pp.cmd IN ('UPDATE','ALL')
                    AND (pp.roles && ARRAY['authenticated','public']::name[])) AS update_ok
) pol
WHERE c.relnamespace = 'public'::regnamespace
  AND a.attnum > 0 AND NOT a.attisdropped
  AND (c.relname, a.attname) IN (
        ('league_members','es_admin'),              -- = es_admin_liga()
        ('league_members','rules_accepted_at'),     -- = aceptaste el contrato
        ('league_members','pago_confirmado_at'),    -- = constancia del pago
        ('league_members','pago_confirmado_por'),
        ('predictions','points_earned'),            -- = tu puesto en la Tabla
        ('tournament_predictions','champion_points'),
        ('tournament_predictions','top_scorer_points'),
        ('tournament_predictions','top_assist_points'),
        ('users','is_admin'), ('users','total_points'), ('users','points_adjustment'),
        -- la 89: el puntaje, la cuota y el dueño de una quiniela solo por RPC
        ('leagues','points_exact'), ('leagues','powerup_limits'), ('leagues','cuota'),
        ('leagues','admin_id'), ('leagues','tournament_id'))
  AND ((has_column_privilege('authenticated', c.oid, a.attname, 'INSERT') AND pol.insert_ok)
    OR (has_column_privilege('authenticated', c.oid, a.attname, 'UPDATE') AND pol.update_ok))
ORDER BY c.relname, a.attname;

\echo '=== 15. ¿La fórmula del total global sigue escrita una sola vez? ==='
-- El error crónico del proyecto. `user_total_calculado` (migración 62) cuenta
-- cada partido UNA vez con tu mejor puntaje y cada torneo UNA vez para campeón,
-- goleador y asistidor. Ha vuelto a duplicarse dos veces:
--   · en la base, porque volver a correr la 61 pisa a la 62 (lo arregló la 86);
--   · en el backend, en un endpoint muerto que sumaba sin el asistidor.
-- Cuando el repo y la base se separan acá no salta ningún error: los números
-- coinciden mientras nadie juegue dos quinielas del mismo torneo, y el día que
-- alguien lo haga cada partido empieza a contar doble sin aviso.
SELECT 'recompute_user_total no delega en user_total_calculado' AS problema
WHERE pg_get_functiondef('public.recompute_user_total(uuid)'::regprocedure)
      NOT LIKE '%user_total_calculado%';

\echo '=== 16. ¿El que AUTORIZA el ×2 y el que COBRA el crédito miran lo mismo? ==='
-- `check_powerup_limit` deja pasar una activación por encima del cupo cuando
-- hay un crédito de arrastre; `consume_powerup_credit` es quien lo cobra. Si no
-- usan la MISMA llave (`llave_cupo`, migración 73) y el MISMO cupo
-- (`cupo_powerups`), se autoriza con un crédito que nadie descuenta y el
-- crédito se reutiliza para siempre. Pasó hasta la 86: el que cobraba agrupaba
-- por `matches.phase` crudo y leía `leagues.powerup_limit` pelado, así que en
-- la postemporada de la liga tica —donde toda la eliminatoria llega con
-- `phase='knockout'`— metía Semifinal, Final y Gran final en una sola bolsa.
SELECT p.proname AS funcion,
       (pg_get_functiondef(p.oid) LIKE '%llave_cupo%')   AS usa_la_llave,
       (pg_get_functiondef(p.oid) LIKE '%cupo_powerups%') AS usa_el_cupo
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('check_powerup_limit', 'consume_powerup_credit')
  AND (pg_get_functiondef(p.oid) NOT LIKE '%llave_cupo%'
    OR pg_get_functiondef(p.oid) NOT LIKE '%cupo_powerups%')
ORDER BY p.proname;

\echo '=== 17. Puntajes pendientes que la recuperación ya NO va a reintentar ==='
-- `partidos_pendientes_de_puntaje()` (migraciones 92/93) reintenta solo durante
-- 3 días desde que el partido quedó pendiente. Si el puntaje falla todo ese
-- tiempo, el partido SALE de la lista sin que nada avise: salir de la lista no
-- significa que se haya resuelto. Esta sección es ese aviso (octava auditoría).
-- Lo que aparezca acá lo resuelve el admin con «Recalcular» desde el panel.
-- No lista los partidos viejos sin firma anteriores a la 88 (sin marca de
-- pendiente): esos tienen los puntos bien y no son trabajo abandonado.
SELECT m.id AS partido, m.status, m.puntaje_pendiente_desde,
       (SELECT count(*) FROM public.predictions p
         WHERE p.match_id = m.id AND p.puntaje_pendiente) AS predicciones_marcadas
FROM public.matches m
WHERE m.status IN ('finished', 'cancelled', 'postponed')
  AND (
    ( CASE WHEN m.status = 'finished' THEN m.puntuado_con IS NULL
           ELSE m.puntuado_con IS DISTINCT FROM 'anulado' END
      AND m.puntaje_pendiente_desde < now() - interval '3 days' )
    OR EXISTS (SELECT 1 FROM public.predictions p
                WHERE p.match_id = m.id AND p.puntaje_pendiente
                  AND p.modificada_at <= now() - interval '3 days')
  )
ORDER BY m.id;
