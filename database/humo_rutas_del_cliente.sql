-- =============================================================================
-- PRUEBA DE HUMO de las rutas del cliente — NO ESCRIBE NADA
-- =============================================================================
-- Recorre, como `authenticated` y con el JWT de personas reales, TODO lo que la
-- app hace contra la base, y comprueba que lo que tiene que estar CERRADO siga
-- cerrado. Termina en RAISE EXCEPTION: nada de lo que hace queda escrito, y el
-- informe sale como texto del error.
--
-- POR QUÉ EXISTE: la migración 85 rompió el guardado de predicciones y se había
-- comprobado con una petición escrita a mano, no con la que manda la app.
--
-- VERSIÓN 2 (24 sep 2026), después de la cuarta auditoría. La primera daba
-- «24 bien» diciendo menos de lo que parecía:
--   · las lecturas hacían `count(*)`, y CERO filas también pasaba;
--   · los rechazos aceptaban CUALQUIER error, incluso «la función no existe»;
--   · confirmar un pago se revertía antes de desconfirmarlo, así que
--     desconfirmar no probaba que quitara una confirmación existente;
--   · faltaban 7 RPC que el frontend llama, el guardado de las globales y el
--     RETURNING que pide `.upsert(...).select()`.
-- Ahora cada paso AFIRMA su resultado, y cada rechazo tiene que ser EL rechazo
-- esperado: `42501` por falta de permiso, o el mensaje exacto de la regla.
--
-- VERSIÓN 3 (24 sep 2026), después de la quinta auditoría, que reemplazó
-- `set_group_extras` por una función que no hace nada y la v2 siguió dando ✓:
--   · toda escritura manda un valor DISTINTO del que ya hay y afirma que quedó
--     (reescribir el mismo valor pasa igual con la función vacía);
--   · el upsert de GroupPage devuelve TODAS las columnas (`.select()` sin
--     argumentos es `RETURNING *`), no solo el id;
--   · las lecturas que pueden venir vacías se comparan contra lo que la base
--     tiene de verdad, calculado ANTES como dueño;
--   · se agregan las operaciones directas sobre tablas (push, chat, ajustes,
--     jugadores, bitácora, estadísticas, perfil, avatar) y las del admin global.
--   Regla: sustituir cualquier escritura por una que no hace nada tiene que
--   hacer caer SU comprobación.
--
-- VERSIÓN 4 (24 sep 2026), después de la sexta auditoría, que encontró dos
-- escrituras que seguían pasando con un no-op (aceptar reglas y medallas) y
-- lecturas cuya expectativa salía de la MISMA RPC probada:
--   · aceptar reglas parte de reglas SIN aceptar; medallas parte de cero;
--   · votar afirma que el voto quedó guardado;
--   · lo esperado de las lecturas sale de las TABLAS, no de la RPC;
--   · el resultado del admin manda el payload completo de MatchResultsAdmin;
--   · migración 92: una cuenta con pago no se borra, y una predicción corregida
--     después de puntuar deja el partido pendiente.
--   El avatar (`users.avatar_url` + Storage) NO se ejercita más allá de la fila
--   de storage: el dueño pidió no tocar avatares por SQL, ni revertido.
--
-- CÓMO SE USA: antes y después de cada migración, y como ENSAYO (la migración
-- sin BEGIN/COMMIT + esta prueba, en un solo envío: el RAISE final revierte
-- todo). Una línea con ✗ se mira ANTES de seguir.
-- =============================================================================
DO $humo$
DECLARE
  v_liga uuid; v_tid int; v_creador uuid; v_socio uuid; v_ajeno uuid; v_codigo text;
  v_pagador uuid; v_m1 int; v_m2 int; v_prop uuid; v_liga_sin_pagos uuid; v_creador_sin_pagos uuid;
  v_expulsable uuid; v_rules text; v_premios text; v_wa text; v_cuota numeric;
  v_moneda text; v_reparto jsonb; v_limits jsonb; v_recaudado numeric; v_miembros int;
  v_puntuada uuid; v_dueno_puntuada uuid; v_abierto_libre int;
  v_pe int; v_pc int; v_cp int; v_sp int; v_pl int; v_ap int; v_ppp int;
  n int; j jsonb; t timestamptz; x numeric; id_devuelto uuid; st text;
  fila record; a1 int; a2 int; v_admin_global uuid;
  e_propuestas int; e_creditos int; e_medallas int; e_mis_medallas int; e_auditoria int;
  e_jugadores int; e_bitacora int; e_votos int;
  r text := E'\n';
  ok int := 0; mal int := 0;
BEGIN
  -- ---------------------------------------------------------------- actores
  SELECT l.id, l.tournament_id, l.admin_id, l.invitation_code, l.rules, l.prizes_text,
         l.whatsapp_link, l.cuota, l.moneda, l.premios_reparto, l.powerup_limits,
         l.points_exact, l.points_correct, l.champion_points, l.scorer_points,
         l.powerup_limit, l.assist_points, l.powerup_por_partidos
    INTO v_liga, v_tid, v_creador, v_codigo, v_rules, v_premios, v_wa, v_cuota,
         v_moneda, v_reparto, v_limits, v_pe, v_pc, v_cp, v_sp, v_pl, v_ap, v_ppp
    FROM public.leagues l WHERE l.name = 'Bundestica';
  SELECT user_id INTO v_socio FROM public.league_members
   WHERE league_id = v_liga AND user_id <> v_creador AND NOT coalesce(es_admin,false)
     AND pago_confirmado_at IS NULL LIMIT 1;
  SELECT user_id INTO v_pagador FROM public.league_members
   WHERE league_id = v_liga AND user_id <> v_creador AND pago_confirmado_at IS NOT NULL LIMIT 1;
  SELECT user_id INTO v_expulsable FROM public.league_members
   WHERE league_id = v_liga AND user_id NOT IN (v_creador, v_socio)
     AND NOT coalesce(es_admin,false) AND pago_confirmado_at IS NULL LIMIT 1;
  SELECT u.id INTO v_ajeno FROM public.users u
   WHERE NOT coalesce(u.is_admin,false)
     AND NOT EXISTS (SELECT 1 FROM public.league_members m WHERE m.league_id = v_liga AND m.user_id = u.id)
   LIMIT 1;
  SELECT id INTO v_m1 FROM public.matches WHERE tournament_id = v_tid
     AND kickoff_at - interval '15 minutes' > now() ORDER BY kickoff_at LIMIT 1;
  SELECT id INTO v_m2 FROM public.matches WHERE tournament_id = v_tid
     AND kickoff_at - interval '15 minutes' > now() ORDER BY kickoff_at OFFSET 1 LIMIT 1;
  SELECT l.id, l.admin_id INTO v_liga_sin_pagos, v_creador_sin_pagos FROM public.leagues l
   WHERE NOT EXISTS (SELECT 1 FROM public.league_members m WHERE m.league_id = l.id AND m.pago_confirmado_at IS NOT NULL)
   ORDER BY l.created_at DESC LIMIT 1;
  -- una predicción PUNTUADA de un partido terminado, y un partido abierto que su dueño no predijo
  SELECT p.id, p.user_id INTO v_puntuada, v_dueno_puntuada
    FROM public.predictions p JOIN public.matches m ON m.id = p.match_id
   WHERE p.league_id = v_liga AND m.status = 'finished' AND p.points_earned > 0 LIMIT 1;
  SELECT m.id INTO v_abierto_libre FROM public.matches m
   WHERE m.tournament_id = v_tid AND m.kickoff_at - interval '15 minutes' > now()
     AND NOT EXISTS (SELECT 1 FROM public.predictions p WHERE p.match_id = m.id
                      AND p.user_id = v_dueno_puntuada AND p.league_id = v_liga)
   ORDER BY m.kickoff_at LIMIT 1;
  -- lo que el pozo TIENE que decir
  SELECT COALESCE(SUM(COALESCE(pago_confirmado_monto, v_cuota, 0)) FILTER (WHERE pago_confirmado_at IS NOT NULL), 0),
         count(*)
    INTO v_recaudado, v_miembros FROM public.league_members WHERE league_id = v_liga;

  IF v_socio IS NULL OR v_ajeno IS NULL OR v_pagador IS NULL OR v_m1 IS NULL OR v_m2 IS NULL
     OR v_puntuada IS NULL OR v_abierto_libre IS NULL THEN
    RAISE EXCEPTION 'Humo: faltan actores (socio %, ajeno %, pagador %, partidos % %, puntuada %, abierto %)',
      v_socio, v_ajeno, v_pagador, v_m1, v_m2, v_puntuada, v_abierto_libre;
  END IF;

  SELECT u.id INTO v_admin_global FROM public.users u WHERE u.is_admin LIMIT 1;

  -- Lo que TIENEN que devolver las lecturas que pueden venir vacías, calculado
  -- como dueño y con la misma identidad: cero solo vale si la base tiene cero.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_socio, 'role','authenticated')::text, true);
  -- Desde las TABLAS, no desde las RPC que se prueban: si una RPC devolviera
  -- siempre vacío, calcular lo esperado con ella daría vacío = vacío.
  SELECT count(*) INTO e_propuestas FROM public.rule_proposals WHERE league_id = v_liga;
  SELECT count(*) INTO e_creditos FROM (SELECT DISTINCT phase, matchday FROM public.powerup_credits
    WHERE user_id = v_socio AND league_id = v_liga AND consumed_at IS NULL AND phase IS NOT NULL) c;
  SELECT count(*) INTO e_medallas FROM public.user_badges WHERE league_id = v_liga;
  SELECT count(*) INTO e_mis_medallas FROM public.user_badges WHERE user_id = v_socio;
  SELECT least(10, count(*)) INTO e_auditoria FROM public.match_audit a
    JOIN public.matches m ON m.id = a.match_id WHERE m.tournament_id = v_tid;
  SELECT count(*) INTO e_jugadores FROM public.players WHERE tournament_id = v_tid;
  SELECT count(*) INTO e_bitacora FROM (SELECT 1 FROM public.prediction_logs WHERE user_id = v_socio LIMIT 50) b;

  SET LOCAL ROLE authenticated;

  -- ======================================================= LO QUE TIENE QUE FUNCIONAR
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_socio, 'role','authenticated')::text, true);

  BEGIN  -- GroupPage: upsert completo de PostgREST, con el RETURNING * de .upsert().select()
    -- Un marcador DISTINTO del que ya tiene: reescribir el mismo pasaría con un no-op.
    SELECT (COALESCE(home_goals_pred, 0) + 1) % 10 INTO a1 FROM public.predictions
     WHERE user_id = v_socio AND league_id = v_liga AND match_id = v_m1;
    a1 := COALESCE(a1, 2);
    INSERT INTO public.predictions (match_id,prediction_type,home_goals_pred,away_goals_pred,penalties_winner_pred,use_powerup_x2,user_id,league_id)
    VALUES (v_m1,'Marcador',a1,1,NULL,false,v_socio,v_liga)
    ON CONFLICT (user_id,league_id,match_id) DO UPDATE SET match_id=excluded.match_id, prediction_type=excluded.prediction_type,
      home_goals_pred=excluded.home_goals_pred, away_goals_pred=excluded.away_goals_pred,
      penalties_winner_pred=excluded.penalties_winner_pred, use_powerup_x2=excluded.use_powerup_x2,
      user_id=excluded.user_id, league_id=excluded.league_id
    RETURNING * INTO fila;
    IF fila.id IS NULL OR fila.home_goals_pred IS DISTINCT FROM a1 OR fila.user_id IS DISTINCT FROM v_socio THEN
      RAISE EXCEPTION 'el upsert no devolvió la fila guardada'; END IF;
    SELECT home_goals_pred INTO n FROM public.predictions WHERE id = fila.id;
    IF n IS DISTINCT FROM a1 THEN RAISE EXCEPTION 'no quedó guardado el marcador'; END IF;
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ guardar predicción (GroupPage, con RETURNING)\n'; ok := ok + 1;
    ELSE r := r || '✗ guardar predicción: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN  -- PredecirJornada: lote en un solo upsert, con marcadores distintos de los que hay
    SELECT (COALESCE(max(home_goals_pred) FILTER (WHERE match_id = v_m1), 0) + 2) % 10,
           (COALESCE(max(home_goals_pred) FILTER (WHERE match_id = v_m2), 0) + 3) % 10
      INTO a1, a2 FROM public.predictions WHERE user_id = v_socio AND league_id = v_liga;
    INSERT INTO public.predictions (user_id,league_id,match_id,prediction_type,home_goals_pred,away_goals_pred,penalties_winner_pred,use_powerup_x2)
    VALUES (v_socio,v_liga,v_m1,'Marcador',a1,0,NULL,false),(v_socio,v_liga,v_m2,'Marcador',a2,0,NULL,false)
    ON CONFLICT (user_id,league_id,match_id) DO UPDATE SET user_id=excluded.user_id, league_id=excluded.league_id,
      match_id=excluded.match_id, prediction_type=excluded.prediction_type, home_goals_pred=excluded.home_goals_pred,
      away_goals_pred=excluded.away_goals_pred, penalties_winner_pred=excluded.penalties_winner_pred,
      use_powerup_x2=excluded.use_powerup_x2;
    SELECT count(*) INTO n FROM public.predictions
     WHERE user_id = v_socio AND league_id = v_liga
       AND ((match_id = v_m1 AND home_goals_pred = a1) OR (match_id = v_m2 AND home_goals_pred = a2));
    IF n <> 2 THEN RAISE EXCEPTION 'el lote dejó % de 2 con el marcador enviado', n; END IF;
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ guardar jornada (PredecirJornada)\n'; ok := ok + 1;
    ELSE r := r || '✗ guardar jornada: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN  -- TournamentGlobalCard: upsert de las globales (con el torneo abierto a propósito)
    RESET ROLE;
    UPDATE public.tournaments SET predictions_force_open = true, predictions_locked = false WHERE id = v_tid;
    SET LOCAL ROLE authenticated;
    INSERT INTO public.tournament_predictions (user_id,tournament_id,league_id,champion_team,top_scorer_name,top_assist_name)
    VALUES (v_socio,v_tid,v_liga,'HUMO','HUMO','HUMO')
    ON CONFLICT (user_id,league_id) DO UPDATE SET user_id=excluded.user_id, tournament_id=excluded.tournament_id,
      league_id=excluded.league_id, champion_team=excluded.champion_team, top_scorer_name=excluded.top_scorer_name,
      top_assist_name=excluded.top_assist_name;
    SELECT count(*) INTO n FROM public.tournament_predictions
     WHERE user_id = v_socio AND league_id = v_liga AND champion_team = 'HUMO';
    IF n <> 1 THEN RAISE EXCEPTION 'las globales no quedaron guardadas'; END IF;
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ guardar las globales (TournamentGlobalCard)\n'; ok := ok + 1;
    ELSE r := r || '✗ guardar globales: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN  -- las lecturas de cada pantalla, y que traigan DATOS
    SELECT count(*) INTO n FROM public.my_groups();                IF n = 0 THEN RAISE EXCEPTION 'my_groups vacío'; END IF;
    SELECT count(*) INTO n FROM public.quiniela_por_id(v_liga);    IF n <> 1 THEN RAISE EXCEPTION 'quiniela_por_id devolvió %', n; END IF;
    SELECT count(*) INTO n FROM public.group_standings(v_liga);    IF n = 0 THEN RAISE EXCEPTION 'group_standings vacío'; END IF;
    IF public.league_jornadas(v_liga) IS NULL THEN RAISE EXCEPTION 'league_jornadas vacío'; END IF;
    SELECT count(*) INTO n FROM public.league_proposals(v_liga);  IF n <> e_propuestas THEN RAISE EXCEPTION 'league_proposals da % de %', n, e_propuestas; END IF;
    j := public.league_pozo(v_liga);
    IF (j->>'recaudado')::numeric IS DISTINCT FROM v_recaudado THEN
      RAISE EXCEPTION 'el pozo dice % recaudado y tendría que decir %', j->>'recaudado', v_recaudado; END IF;
    SELECT count(*) INTO n FROM public.league_miembros(v_liga);    IF n <> v_miembros THEN RAISE EXCEPTION 'league_miembros da % de %', n, v_miembros; END IF;
    SELECT count(*) INTO n FROM public.my_powerup_credits(v_liga); IF n <> e_creditos THEN RAISE EXCEPTION 'my_powerup_credits da % de %', n, e_creditos; END IF;
    SELECT count(*) INTO n FROM public.cupos_por_jornada(v_liga);  IF n = 0 THEN RAISE EXCEPTION 'cupos_por_jornada vacío'; END IF;
    SELECT count(*) INTO n FROM public.fases_del_torneo(v_liga);   IF n = 0 THEN RAISE EXCEPTION 'fases_del_torneo vacío'; END IF;
    IF public.perfil_en_quiniela(v_liga, v_socio) IS NULL THEN RAISE EXCEPTION 'perfil_en_quiniela vacío'; END IF;
    SELECT count(*) INTO n FROM public.league_medals(v_liga);      IF n <> e_medallas THEN RAISE EXCEPTION 'league_medals da % de %', n, e_medallas; END IF;
    SELECT count(*) INTO n FROM public.my_medals();                IF n <> e_mis_medallas THEN RAISE EXCEPTION 'my_medals da % de %', n, e_mis_medallas; END IF;
    SELECT count(*) INTO n FROM public.ranking_global(10);          IF n = 0 THEN RAISE EXCEPTION 'ranking_global vacío'; END IF;
    IF public.mi_resumen_global() IS NULL THEN RAISE EXCEPTION 'mi_resumen_global vacío'; END IF;
    SELECT count(*) INTO n FROM public.match_audit_log(v_tid, 10); IF n <> e_auditoria THEN RAISE EXCEPTION 'match_audit_log da % de %', n, e_auditoria; END IF;
    SELECT count(*) INTO n FROM public.predictions WHERE league_id = v_liga;    IF n = 0 THEN RAISE EXCEPTION 'no se ven predicciones'; END IF;
    SELECT count(*) INTO n FROM public.league_members WHERE league_id = v_liga; IF n <> v_miembros THEN RAISE EXCEPTION 'league_members da %', n; END IF;
    SELECT count(*) INTO n FROM public.leagues WHERE id = v_liga;               IF n <> 1 THEN RAISE EXCEPTION 'no se ve la quiniela'; END IF;
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ lecturas de todas las pantallas (20), con datos\n'; ok := ok + 1;
    ELSE r := r || '✗ lecturas: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN  -- parte de reglas SIN aceptar: con la fecha ya puesta, un no-op pasaba
    RESET ROLE;
    UPDATE public.league_members SET rules_accepted_at = NULL WHERE league_id = v_liga AND user_id = v_socio;
    SET LOCAL ROLE authenticated;
    PERFORM public.accept_group_rules(v_liga);
    SELECT rules_accepted_at INTO t FROM public.league_members WHERE league_id = v_liga AND user_id = v_socio;
    IF t IS NULL THEN RAISE EXCEPTION 'no quedó aceptado'; END IF;
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ aceptar reglas\n'; ok := ok + 1;
    ELSE r := r || '✗ aceptar reglas: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN PERFORM public.avisar_pago(v_liga, true);
    SELECT pago_avisado_at INTO t FROM public.league_members WHERE league_id = v_liga AND user_id = v_socio;
    IF t IS NULL THEN RAISE EXCEPTION 'no quedó el aviso'; END IF;
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ avisar «ya pagué»\n'; ok := ok + 1;
    ELSE r := r || '✗ avisar pago: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN  -- operaciones DIRECTAS sobre tablas, tal como las manda el cliente
    -- notificaciones.js: borrar + insertar por endpoint (no hay UPDATE)
    DELETE FROM public.push_subscriptions WHERE endpoint = 'https://humo.invalid/ep';
    INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth)
    VALUES (v_socio, 'https://humo.invalid/ep', 'k', 'a');
    SELECT count(*) INTO n FROM public.push_subscriptions WHERE endpoint = 'https://humo.invalid/ep';
    IF n <> 1 THEN RAISE EXCEPTION 'la suscripción no quedó (%)', n; END IF;
    DELETE FROM public.push_subscriptions WHERE endpoint = 'https://humo.invalid/ep';
    RESET ROLE;
    SELECT count(*) INTO n FROM public.push_subscriptions WHERE endpoint = 'https://humo.invalid/ep';
    SET LOCAL ROLE authenticated;
    IF n <> 0 THEN RAISE EXCEPTION 'darse de baja no borró la suscripción'; END IF;
    -- GlobalChatDrawer: leer con el nombre, escribir con .select(), borrar el propio
    PERFORM c.*, u.display_name FROM public.global_chat c JOIN public.users u ON u.id = c.user_id LIMIT 50;
    INSERT INTO public.global_chat (user_id, content) VALUES (v_socio, 'humo') RETURNING * INTO fila;
    IF fila.id IS NULL OR fila.content IS DISTINCT FROM 'humo' THEN RAISE EXCEPTION 'el chat no devolvió el mensaje'; END IF;
    DELETE FROM public.global_chat WHERE id = fila.id;
    RESET ROLE;
    SELECT count(*) INTO n FROM public.global_chat WHERE id = fila.id;
    SET LOCAL ROLE authenticated;
    IF n <> 0 THEN RAISE EXCEPTION 'borrar el mensaje propio no lo borró'; END IF;
    -- SettingsContext / AnnouncementBanner
    SELECT count(*) INTO n FROM (SELECT * FROM public.global_settings WHERE id = 1) g;
    IF n <> 1 THEN RAISE EXCEPTION 'global_settings no se lee'; END IF;
    -- TournamentGlobalCard: jugadores del torneo
    SELECT count(*) INTO n FROM public.players WHERE tournament_id = v_tid;
    IF n <> e_jugadores THEN RAISE EXCEPTION 'players da % de %', n, e_jugadores; END IF;
    -- ProfilePage: bitácora propia, estadísticas y perfil (columnas explícitas)
    SELECT count(*) INTO n FROM (SELECT id, match_id, changed_at, action, old_data, new_data
      FROM public.prediction_logs WHERE user_id = v_socio ORDER BY changed_at DESC LIMIT 50) b;
    IF n <> e_bitacora THEN RAISE EXCEPTION 'prediction_logs da % de %', n, e_bitacora; END IF;
    PERFORM talisman_team, maldito_team FROM public.user_stats_view WHERE user_id = v_socio;
    UPDATE public.users SET display_name = display_name || ' ·humo' WHERE id = v_socio RETURNING display_name INTO st;
    IF st NOT LIKE '% ·humo' THEN RAISE EXCEPTION 'no se guardó el nombre'; END IF;
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ tablas directas: push, chat, ajustes, jugadores, bitácora, estadísticas, perfil\n'; ok := ok + 1;
    ELSE r := r || '✗ tablas directas: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN  -- avatar.js: subir al bucket con el prefijo propio (la fila; el archivo no existe)
    INSERT INTO storage.objects (bucket_id, name, owner, metadata)
    VALUES ('avatars', v_socio || '-humo.webp', v_socio, '{"mimetype":"image/webp","size":10}'::jsonb);
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ subir avatar propio (storage)\n'; ok := ok + 1;
    ELSE r := r || '✗ subir avatar: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  -- ---------------------------------------------------------------- el creador
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_creador, 'role','authenticated')::text, true);

  BEGIN  -- confirmar y DESCONFIRMAR la misma confirmación
    PERFORM public.confirmar_pago(v_liga, v_socio, true);
    SELECT pago_confirmado_at, pago_confirmado_monto INTO t, x FROM public.league_members WHERE league_id = v_liga AND user_id = v_socio;
    IF t IS NULL OR x IS DISTINCT FROM v_cuota THEN RAISE EXCEPTION 'confirmar no dejó el pago con su monto (%)', x; END IF;
    PERFORM public.confirmar_pago(v_liga, v_socio, false);
    SELECT pago_confirmado_at, pago_confirmado_monto INTO t, x FROM public.league_members WHERE league_id = v_liga AND user_id = v_socio;
    IF t IS NOT NULL OR x IS NOT NULL THEN RAISE EXCEPTION 'desconfirmar no quitó la confirmación'; END IF;
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ confirmar y desconfirmar un pago\n'; ok := ok + 1;
    ELSE r := r || '✗ confirmar/desconfirmar: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN PERFORM public.set_league_pozo(v_liga, v_cuota + 1, v_moneda, v_reparto);
    IF (SELECT cuota FROM public.leagues WHERE id = v_liga) IS DISTINCT FROM v_cuota + 1 THEN
      RAISE EXCEPTION 'la cuota nueva no quedó guardada'; END IF;
    IF (public.league_pozo(v_liga)->>'recaudado')::numeric IS DISTINCT FROM v_recaudado THEN
      RAISE EXCEPTION 'cambiar la cuota movió lo recaudado'; END IF;
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ guardar el pozo (cuota nueva; lo recaudado no se mueve)\n'; ok := ok + 1;
    ELSE r := r || '✗ guardar pozo: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN  -- la función recorta espacios: se compara contra el texto ya recortado
    PERFORM public.set_group_extras(v_liga, 'humo · ' || COALESCE(v_premios, ''), v_wa);
    IF (SELECT prizes_text FROM public.leagues WHERE id = v_liga) IS DISTINCT FROM btrim('humo · ' || COALESCE(v_premios, '')) THEN
      RAISE EXCEPTION 'los premios no quedaron guardados'; END IF;
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ guardar premios/WhatsApp\n'; ok := ok + 1;
    ELSE r := r || '✗ guardar extras: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN  -- una fase que todavía no empezó: se puede configurar por adelantado (74)
    PERFORM public.set_powerup_limits(v_liga, coalesce(v_limits, '{}'::jsonb) || '{"Humo":1}'::jsonb);
    IF (SELECT powerup_limits->>'Humo' FROM public.leagues WHERE id = v_liga) IS DISTINCT FROM '1' THEN
      RAISE EXCEPTION 'el cupo nuevo no quedó guardado'; END IF;
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ guardar cupos ×2 (una fase nueva)\n'; ok := ok + 1;
    ELSE r := r || '✗ guardar cupos: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN PERFORM public.set_league_admin(v_liga, v_socio, true);
    IF NOT (SELECT es_admin FROM public.league_members WHERE league_id = v_liga AND user_id = v_socio) THEN
      RAISE EXCEPTION 'no quedó nombrado'; END IF;
    PERFORM public.set_league_admin(v_liga, v_socio, false);
    IF (SELECT es_admin FROM public.league_members WHERE league_id = v_liga AND user_id = v_socio) THEN
      RAISE EXCEPTION 'no quedó quitado'; END IF;
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ nombrar y quitar un co-admin\n'; ok := ok + 1;
    ELSE r := r || '✗ co-admin: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN  -- parte de CERO medallas: sin efecto que medir, un no-op pasaba
    RESET ROLE;
    DELETE FROM public.user_badges WHERE league_id = v_liga;
    SET LOCAL ROLE authenticated;
    PERFORM public.recompute_league_badges(v_liga);
    RESET ROLE;
    SELECT count(*) INTO n FROM public.user_badges WHERE league_id = v_liga;
    SET LOCAL ROLE authenticated;
    IF e_medallas > 0 AND n = 0 THEN RAISE EXCEPTION 'recalcular no dejó ninguna medalla (había %)', e_medallas; END IF;
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ recalcular medallas\n'; ok := ok + 1;
    ELSE r := r || '✗ medallas: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN  -- votación completa, afirmando el padrón y el estado final
    v_prop := public.propose_rule_change(v_liga, 'rules', jsonb_build_object('rules', v_rules), 'humo');
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_socio, 'role','authenticated')::text, true);
    PERFORM public.cast_rule_vote(v_prop, false);
    RESET ROLE;
    SELECT count(*) INTO e_votos FROM public.rule_votes WHERE proposal_id = v_prop AND user_id = v_socio AND vote = false;
    SET LOCAL ROLE authenticated;
    IF e_votos <> 1 THEN RAISE EXCEPTION 'el voto no quedó guardado'; END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_creador, 'role','authenticated')::text, true);
    SELECT members INTO n FROM public.league_proposals(v_liga) WHERE id = v_prop;
    IF n IS DISTINCT FROM v_miembros THEN RAISE EXCEPTION 'el padrón es % y no %', n, v_miembros; END IF;
    PERFORM public.cancel_rule_proposal(v_prop);
    SELECT status INTO st FROM public.league_proposals(v_liga) WHERE id = v_prop;
    IF st IS DISTINCT FROM 'cancelled' THEN RAISE EXCEPTION 'quedó %', st; END IF;
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ proponer, votar y cancelar (padrón completo)\n'; ok := ok + 1;
    ELSE r := r || '✗ votación: ' || sqlerrm || E'\n'; mal := mal + 1; END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_creador, 'role','authenticated')::text, true);
  END;

  IF v_expulsable IS NOT NULL THEN
    BEGIN PERFORM public.expulsar_miembro(v_liga, v_expulsable);
      SELECT count(*) INTO n FROM public.league_members WHERE league_id = v_liga AND user_id = v_expulsable;
      IF n <> 0 THEN RAISE EXCEPTION 'sigue en la quiniela'; END IF;
      RAISE EXCEPTION 'HUMO_OK';
    EXCEPTION WHEN others THEN
      IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ expulsar a un miembro sin pago\n'; ok := ok + 1;
      ELSE r := r || '✗ expulsar: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;
  END IF;

  -- ------------------------------------------------------------ otras personas
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ajeno, 'role','authenticated')::text, true);
  BEGIN PERFORM public.join_group_by_code(v_codigo);
    RESET ROLE;
    SELECT count(*) INTO n FROM public.league_members WHERE league_id = v_liga AND user_id = v_ajeno;
    SET LOCAL ROLE authenticated;
    IF n <> 1 THEN RAISE EXCEPTION 'no quedó dentro'; END IF;
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ unirse con el código\n'; ok := ok + 1;
    ELSE r := r || '✗ unirse: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN PERFORM public.create_group('humo', v_tid, NULL);
    SELECT count(*) INTO n FROM public.leagues WHERE name = 'humo' AND admin_id = v_ajeno;
    IF n <> 1 THEN RAISE EXCEPTION 'no se ve la quiniela creada'; END IF;
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ crear una quiniela\n'; ok := ok + 1;
    ELSE r := r || '✗ crear quiniela: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_socio, 'role','authenticated')::text, true);
  BEGIN PERFORM public.salir_de_quiniela(v_liga);
    RESET ROLE;
    SELECT count(*) INTO n FROM public.league_members WHERE league_id = v_liga AND user_id = v_socio;
    SET LOCAL ROLE authenticated;
    IF n <> 0 THEN RAISE EXCEPTION 'sigue en la quiniela'; END IF;
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ salir de la quiniela (sin pago)\n'; ok := ok + 1;
    ELSE r := r || '✗ salir: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  IF v_liga_sin_pagos IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_creador_sin_pagos, 'role','authenticated')::text, true);
    BEGIN PERFORM public.delete_group(v_liga_sin_pagos);
      RESET ROLE;
      SELECT count(*) INTO n FROM public.leagues WHERE id = v_liga_sin_pagos;
      SET LOCAL ROLE authenticated;
      IF n <> 0 THEN RAISE EXCEPTION 'la quiniela sigue ahí'; END IF;
      RAISE EXCEPTION 'HUMO_OK';
    EXCEPTION WHEN others THEN
      IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ borrar una quiniela SIN pagos\n'; ok := ok + 1;
      ELSE r := r || '✗ borrar quiniela sin pagos: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;
  END IF;

  -- ------------------------------------------------------------ el admin global
  IF v_admin_global IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_global, 'role','authenticated')::text, true);
    BEGIN
      -- AnnouncementsAdmin: upsert del anuncio
      INSERT INTO public.global_settings (id, announcement, announcement_active) VALUES (1, 'humo', false)
      ON CONFLICT (id) DO UPDATE SET id = excluded.id, announcement = excluded.announcement,
        announcement_active = excluded.announcement_active;
      IF (SELECT announcement FROM public.global_settings WHERE id = 1) IS DISTINCT FROM 'humo' THEN
        RAISE EXCEPTION 'el anuncio no quedó guardado'; END IF;
      -- BannedEmailsAdmin
      PERFORM * FROM public.banned_emails ORDER BY banned_at DESC;
      -- MatchResultsAdmin: el payload COMPLETO de handleSave (se revierte)
      UPDATE public.matches SET status = 'finished', kickoff_at = kickoff_at - interval '1 minute',
        home_goals_actual = 9, away_goals_actual = 8, goes_to_penalties = false,
        penalties_winner_real = NULL, score_locked = true, predictions_force_open = false
       WHERE id = v_m1;
      IF (SELECT (home_goals_actual, status, score_locked) FROM public.matches WHERE id = v_m1)
         IS DISTINCT FROM (9, 'finished'::text, true) THEN
        RAISE EXCEPTION 'el resultado no quedó guardado'; END IF;
      -- (92) corregir una predicción de un partido ya puntuado lo deja pendiente
      UPDATE public.predictions SET home_goals_pred = (home_goals_pred + 1) % 10 WHERE id = v_puntuada;
      RESET ROLE;
      UPDATE public.matches SET puntuado_con = 'humo', puntuado_at = now() - interval '1 second'
       WHERE id = (SELECT match_id FROM public.predictions WHERE id = v_puntuada) AND puntuado_at IS NULL;
      IF NOT EXISTS (SELECT 1 FROM public.partidos_pendientes_de_puntaje() AS pend(mid)
                      WHERE pend.mid = (SELECT match_id FROM public.predictions WHERE id = v_puntuada)) THEN
        RAISE EXCEPTION 'una predicción corregida después de puntuar no dejó el partido pendiente'; END IF;
      SET LOCAL ROLE authenticated;
      RAISE EXCEPTION 'HUMO_OK';
    EXCEPTION WHEN others THEN
      IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ admin global: anuncio, correos vetados, resultado\n'; ok := ok + 1;
      ELSE r := r || '✗ admin global: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;
  END IF;

  -- ================================================ REGLAS QUE RECHAZAN A PROPÓSITO
  -- Cuentan solo si el rechazo es ESE: con otro mensaje es un fallo distinto.
  r := r || E'--- rechazos por regla ---\n';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_creador, 'role','authenticated')::text, true);

  BEGIN PERFORM public.set_group_rules(v_liga, v_rules);
    RAISE EXCEPTION 'HUMO_ABIERTO';
  EXCEPTION WHEN others THEN
    IF sqlerrm LIKE 'El torneo ya inició%' THEN r := r || E'✓ reglas bloqueadas con el torneo empezado\n'; ok := ok + 1;
    ELSE r := r || '✗ reglas: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN PERFORM public.set_group_scoring(v_liga, v_pe, v_pc, v_cp, v_sp, v_pl, v_ap, v_ppp);
    RAISE EXCEPTION 'HUMO_ABIERTO';
  EXCEPTION WHEN others THEN
    IF sqlerrm LIKE 'El torneo ya inició%' THEN r := r || E'✓ puntaje bloqueado con el torneo empezado\n'; ok := ok + 1;
    ELSE r := r || '✗ puntaje: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN PERFORM public.delete_group(v_liga);
    RAISE EXCEPTION 'HUMO_ABIERTO';
  EXCEPTION WHEN others THEN
    IF sqlerrm LIKE 'No se puede eliminar: hay %pago(s) confirmado(s)%' THEN r := r || E'✓ delete_group se niega con pagos confirmados\n'; ok := ok + 1;
    ELSE r := r || '✗ delete_group con pagos: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN  -- (4.ª auditoría) reconfirmar un pago NO puede reescribir su monto
    PERFORM public.set_league_pozo(v_liga, v_cuota * 2, v_moneda, v_reparto);
    PERFORM public.confirmar_pago(v_liga, v_pagador, true);
    SELECT pago_confirmado_monto INTO x FROM public.league_members WHERE league_id = v_liga AND user_id = v_pagador;
    IF x IS DISTINCT FROM v_cuota THEN RAISE EXCEPTION 'HUMO_ABIERTO: reconfirmar dejó el pago en %', x; END IF;
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ reconfirmar un pago conserva su monto\n'; ok := ok + 1;
    ELSE r := r || '✗ ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN  -- (6.ª auditoría) borrar la CUENTA de quien pagó: la cascada no se lleva el pago
    RESET ROLE;
    DELETE FROM auth.users WHERE id = v_pagador;
    RAISE EXCEPTION 'HUMO_ABIERTO';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_ABIERTO' THEN r := r || E'✗ ABIERTO: borrar la cuenta borra su pago confirmado\n'; mal := mal + 1;
    ELSIF sqlerrm LIKE 'Esta membresía tiene un pago confirmado%' THEN r := r || E'✓ una cuenta con pago no se borra\n'; ok := ok + 1;
    ELSE r := r || '✗ borrar cuenta, otra causa: ' || sqlerrm || E'\n'; mal := mal + 1; END IF;
    SET LOCAL ROLE authenticated; END;

  BEGIN  -- (4.ª auditoría) una predicción cerrada no se muda a otro partido con sus puntos
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_dueno_puntuada, 'role','authenticated')::text, true);
    UPDATE public.predictions SET match_id = v_abierto_libre WHERE id = v_puntuada;
    RAISE EXCEPTION 'HUMO_ABIERTO';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_ABIERTO' THEN r := r || E'✗ ABIERTO: una predicción puntuada se muda de partido con sus puntos\n'; mal := mal + 1;
    ELSIF sqlerrm LIKE 'Una predicción no cambia de%' THEN r := r || E'✓ una predicción no se muda de partido\n'; ok := ok + 1;
    ELSE r := r || '✗ mudar predicción, rechazada por otra causa: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  -- ================================================ SIN PERMISO (tiene que ser 42501)
  r := r || E'--- cerrado por permiso ---\n';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ajeno, 'role','authenticated')::text, true);
  BEGIN
    INSERT INTO public.league_members (league_id, user_id, es_admin) VALUES (v_liga, v_ajeno, true);
    RAISE EXCEPTION 'HUMO_ABIERTO';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_ABIERTO' THEN r := r || E'✗ ABIERTO: auto-inscribirse como co-admin\n'; mal := mal + 1;
    ELSIF sqlstate = '42501' THEN r := r || E'✓ auto-inscripción directa: 42501\n'; ok := ok + 1;
    ELSE r := r || '✗ auto-inscripción, otra causa: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN  -- una suscripción de push a nombre de OTRA persona
    INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth)
    VALUES (v_socio, 'https://humo.invalid/ajeno', 'k', 'a');
    RAISE EXCEPTION 'HUMO_ABIERTO';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_ABIERTO' THEN r := r || E'✗ ABIERTO: suscribir a otra persona a los push\n'; mal := mal + 1;
    ELSIF sqlstate = '42501' THEN r := r || E'✓ push a nombre de otro: 42501\n'; ok := ok + 1;
    ELSE r := r || '✗ push ajeno, otra causa: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN  -- el anuncio global es del admin global
    UPDATE public.global_settings SET announcement = 'humo' WHERE id = 1;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE EXCEPTION 'HUMO_ABIERTO'; END IF;
    RAISE EXCEPTION 'HUMO_CERO';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_ABIERTO' THEN r := r || E'✗ ABIERTO: cualquiera cambia el anuncio global\n'; mal := mal + 1;
    ELSIF sqlstate = '42501' OR sqlerrm = 'HUMO_CERO' THEN r := r || E'✓ anuncio global cerrado a un miembro\n'; ok := ok + 1;
    ELSE r := r || '✗ anuncio, otra causa: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_creador, 'role','authenticated')::text, true);
  BEGIN
    UPDATE public.predictions SET points_earned = 9999 WHERE user_id = v_creador AND league_id = v_liga;
    RAISE EXCEPTION 'HUMO_ABIERTO';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_ABIERTO' THEN r := r || E'✗ ABIERTO: escribirse los puntos\n'; mal := mal + 1;
    ELSIF sqlstate = '42501' THEN r := r || E'✓ escribirse los puntos: 42501\n'; ok := ok + 1;
    ELSE r := r || '✗ puntos, otra causa: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN
    UPDATE public.leagues SET points_exact = 50 WHERE id = v_liga;
    RAISE EXCEPTION 'HUMO_ABIERTO';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_ABIERTO' THEN r := r || E'✗ ABIERTO: UPDATE directo sobre leagues\n'; mal := mal + 1;
    ELSIF sqlstate = '42501' AND sqlerrm LIKE '%table leagues%' THEN r := r || E'✓ UPDATE directo sobre leagues: 42501 de la tabla\n'; ok := ok + 1;
    ELSE r := r || '✗ UPDATE leagues, otra causa: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN
    DELETE FROM public.leagues WHERE id = v_liga;
    RAISE EXCEPTION 'HUMO_ABIERTO';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_ABIERTO' THEN r := r || E'✗ ABIERTO: DELETE directo sobre leagues\n'; mal := mal + 1;
    ELSIF sqlstate = '42501' THEN r := r || E'✓ DELETE directo sobre leagues: 42501\n'; ok := ok + 1;
    ELSE r := r || '✗ DELETE leagues, otra causa: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN  -- (4.ª auditoría) la escritura atómica del puntaje es solo del backend
    PERFORM public.aplicar_puntaje(v_m1, NULL, NULL, false, NULL, 'x', '[]'::jsonb);
    RAISE EXCEPTION 'HUMO_ABIERTO';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_ABIERTO' THEN r := r || E'✗ ABIERTO: el cliente escribe puntos por aplicar_puntaje\n'; mal := mal + 1;
    ELSIF sqlstate = '42501' THEN r := r || E'✓ aplicar_puntaje cerrado al cliente: 42501\n'; ok := ok + 1;
    ELSE r := r || '✗ aplicar_puntaje, otra causa: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  RESET ROLE;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM count(*) FROM public.tournament_predictions;
    RAISE EXCEPTION 'HUMO_ABIERTO';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_ABIERTO' THEN r := r || E'✗ ABIERTO: anon lee las globales\n'; mal := mal + 1;
    ELSIF sqlstate = '42501' THEN r := r || E'✓ anon no lee las globales: 42501\n'; ok := ok + 1;
    ELSE r := r || '✗ anon, otra causa: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;
  RESET ROLE;

  RAISE EXCEPTION 'HUMO: % bien, % mal (nada se escribió)%', ok, mal, r;
END $humo$;
