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
--   Séptima auditoría: el paso de «predicción corregida» ya no le fabrica un
--   `puntuado_at` al partido; prueba el estado histórico real (NULL).
--   El avatar (`users.avatar_url` + Storage) NO se ejercita más allá de la fila
--   de storage: el dueño pidió no tocar avatares por SQL, ni revertido.
--
-- VERSIÓN 9 (27 sep 2026), después de la decimotercera auditoría: cupos, fases
-- y ajustes de créditos se comparan como CONJUNTOS fila entera (una jornada
-- repetida en lugar de otra, o `empezo`/`existe` falsos, pasaban); my_groups y
-- quiniela_por_id afirman también `is_admin` y `soy_creador`; y la 99: el admin
-- global no escribe predicciones cerradas y salir se lleva los créditos.
--
-- VERSIÓN 10 (27 sep 2026), después de la decimosexta auditoría: el ranking se
-- compara entero (personas, posiciones, puntos y «soy yo») y las globales
-- afirman los tres campos guardados.
--
-- VERSIÓN 11 (28 sep 2026), auditoría de Claude: con 13 sabotajes a la vez la
-- v10 seguía en 39/0. Ahora: premios y WhatsApp, reparto del pozo y cupos se
-- comparan ENTEROS; un ×2 se prende de verdad (y el que se pasa del cupo se
-- rechaza con el mensaje del trigger); salir deja cero predicciones y globales;
-- el ranking se pide con 20 como la app; la visibilidad de predicciones ajenas
-- se mide (abiertas 0, cerradas las de la quiniela, ajeno 0); el cliente no
-- edita partidos ni lee `email`; el SELECT de AuthContext trae su fila; y lo
-- de la 104/105 (funciones de backend, bitácora de predicciones, push, chat).
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
  v_puntuada uuid; v_dueno_puntuada uuid; v_abierto_libre int; v_abierto_socio int;
  v_pe int; v_pc int; v_cp int; v_sp int; v_pl int; v_ap int; v_ppp int;
  n int; j jsonb; t timestamptz; x numeric; id_devuelto uuid; st text;
  fila record; a1 int; a2 int; v_admin_global uuid; v_adm_liga uuid; v_adm_partido int;
  e_propuestas int; e_creditos int; e_medallas int; e_mis_medallas int; e_auditoria int;
  e_jugadores int; e_bitacora int; e_votos int;
  e_puntos_global int; e_quinielas int; e_puntos_liga numeric; e_hay_jornadas boolean;
  e_tabla jsonb; e_ranking jsonb; e_liga jsonb; e_cupos jsonb; e_fases text[];
  e_cupos_set text[]; e_fases_set text[]; e_creditos_set text[]; e_ranking_set text[];
  v_x2 int[];
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
  -- (99) un partido abierto que el socio NO predijo, distinto de v_m1
  SELECT m.id INTO v_abierto_socio FROM public.matches m
   WHERE m.tournament_id = v_tid AND m.kickoff_at - interval '15 minutes' > now() AND m.id <> v_m1
     AND NOT EXISTS (SELECT 1 FROM public.predictions p WHERE p.match_id = m.id
                      AND p.user_id = v_socio AND p.league_id = v_liga)
   ORDER BY m.kickoff_at LIMIT 1;
  -- (99) una predicción del admin global en un partido ya terminado
  SELECT p.league_id, p.match_id INTO v_adm_liga, v_adm_partido
    FROM public.predictions p JOIN public.matches m ON m.id = p.match_id
   WHERE p.user_id = v_admin_global AND m.status = 'finished' LIMIT 1;

  -- (99) Un crédito de ×2 para el socio en la jornada del primer partido
  -- abierto: si no tiene ninguno, «el ajuste de créditos coincide» compara
  -- vacío con vacío y no prueba nada (se revierte con todo lo demás).
  INSERT INTO public.powerup_credits (user_id, league_id, phase, matchday)
  SELECT v_socio, v_liga, public.clave_fase(m.phase, m.stage), m.matchday FROM public.matches m WHERE m.id = v_m1;

  -- Lo que TIENEN que devolver las lecturas que pueden venir vacías, calculado
  -- como dueño y con la misma identidad: cero solo vale si la base tiene cero.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_socio, 'role','authenticated')::text, true);
  -- Desde las TABLAS, no desde las RPC que se prueban: si una RPC devolviera
  -- siempre vacío, calcular lo esperado con ella daría vacío = vacío.
  SELECT count(*) INTO e_propuestas FROM public.rule_proposals WHERE league_id = v_liga;
  -- (novena auditoría) Los JSON se comparan contra valores, no contra NULL:
  -- una RPC reemplazada por una que devuelve '{}' pasaba.
  SELECT total_points INTO e_puntos_global FROM public.users WHERE id = v_socio;
  SELECT count(*) INTO e_quinielas FROM public.league_members WHERE user_id = v_socio;
  SELECT COALESCE((SELECT sum(COALESCE(points_earned,0)) FROM public.predictions
                    WHERE user_id = v_socio AND league_id = v_liga), 0)
       + COALESCE((SELECT sum(COALESCE(champion_points,0) + COALESCE(top_scorer_points,0) + COALESCE(top_assist_points,0))
                     FROM public.tournament_predictions WHERE user_id = v_socio AND league_id = v_liga), 0)
    INTO e_puntos_liga;
  -- (undécima auditoría) Los puntos de TODOS los miembros y de todo el
  -- ranking, desde las tablas: comprobar una sola fila dejaba pasar una Tabla
  -- con los demás en 999 y todos en la posición 1.
  SELECT jsonb_object_agg(lm.user_id::text,
           COALESCE((SELECT sum(COALESCE(p.points_earned,0)) FROM public.predictions p
                      WHERE p.user_id = lm.user_id AND p.league_id = v_liga), 0)
         + COALESCE((SELECT sum(COALESCE(tp.champion_points,0) + COALESCE(tp.top_scorer_points,0) + COALESCE(tp.top_assist_points,0))
                      FROM public.tournament_predictions tp WHERE tp.user_id = lm.user_id AND tp.league_id = v_liga), 0))
    INTO e_tabla FROM public.league_members lm WHERE lm.league_id = v_liga;
  SELECT jsonb_object_agg(u.id::text, COALESCE(u.total_points, 0)) INTO e_ranking FROM public.users u;
  -- (decimosexta auditoría) El ranking ENTERO que tiene que salir: los 20
  -- primeros por puntos y antigüedad, más el socio si queda afuera. Solo
  -- comparar puntos y orden dejaba pasar un ranking con una sola fila.
  SELECT array_agg(o.p || '|' || o.id || '|' || o.puntos || '|' || (o.id = v_socio) ORDER BY o.p) INTO e_ranking_set
    FROM (SELECT u.id, COALESCE(u.total_points, 0) AS puntos,
                 row_number() OVER (ORDER BY COALESCE(u.total_points, 0) DESC, u.created_at ASC) AS p
            FROM public.users u) o
   WHERE o.p <= 20 OR o.id = v_socio;   -- 20: lo que pide RankingGlobal.jsx (v11)
  -- (duodécima auditoría) Lo que las pantallas de la quiniela tienen que
  -- mostrar, sacado de las tablas: reglas y puntaje, el cupo de cada jornada y
  -- las fases del editor de cupos. Antes solo se contaban filas.
  SELECT jsonb_build_object('name', l.name, 'admin_id', l.admin_id, 'tournament_id', l.tournament_id,
           'points_exact', l.points_exact, 'points_correct', l.points_correct, 'champion_points', l.champion_points,
           'scorer_points', l.scorer_points, 'assist_points', l.assist_points, 'powerup_limit', l.powerup_limit,
           'powerup_por_partidos', l.powerup_por_partidos, 'powerup_limits', l.powerup_limits,
           'rules', l.rules, 'prizes_text', l.prizes_text, 'whatsapp_link', l.whatsapp_link,
           'is_admin', public.es_admin_liga(v_liga, v_socio), 'soy_creador', l.admin_id = v_socio)
    INTO e_liga FROM public.leagues l WHERE l.id = v_liga;
  SELECT jsonb_object_agg(b.llave, public.cupo_powerups(v_liga, b.mid)) INTO e_cupos
    FROM (SELECT public.llave_cupo(m.id) AS llave, min(m.id) AS mid FROM public.matches m
           WHERE m.tournament_id = v_tid GROUP BY 1) b;
  SELECT array_agg(DISTINCT c ORDER BY c) INTO e_fases FROM (
    SELECT public.clave_fase(m.phase, m.stage) AS c FROM public.matches m WHERE m.tournament_id = v_tid
    UNION SELECT jsonb_object_keys(COALESCE(v_limits, '{}'::jsonb))) z;
  -- (decimotercera auditoría) Contar filas o mirar solo las claves no
  -- alcanza: Astra hizo pasar una jornada repetida en lugar de otra con el
  -- mismo cupo, y fases con `empezo`/`existe` falsos. Se comparan CONJUNTOS
  -- con multiplicidad, fila entera. OJO: dentro de un agregado, `ORDER BY 1`
  -- ordena por la CONSTANTE 1, no por la primera columna; hay que nombrar la
  -- expresión (la primera versión comparaba arreglos en orden arbitrario).
  SELECT array_agg(b.llave || '=' || public.cupo_powerups(v_liga, b.mid) ORDER BY b.llave) INTO e_cupos_set
    FROM (SELECT public.llave_cupo(m.id) AS llave, min(m.id) AS mid FROM public.matches m
           WHERE m.tournament_id = v_tid GROUP BY 1) b;
  SELECT array_agg(f.c || '|existe=' || f.existe || '|empezo=' || public.fase_ya_empezo(v_liga, f.c) ORDER BY f.c) INTO e_fases_set
    FROM (SELECT z.c, bool_or(z.real) AS existe FROM (
            SELECT public.clave_fase(m.phase, m.stage) AS c, true AS real FROM public.matches m WHERE m.tournament_id = v_tid
            UNION ALL SELECT jsonb_object_keys(COALESCE(v_limits, '{}'::jsonb)), false) z GROUP BY z.c) f;
  SELECT EXISTS (SELECT 1 FROM public.predictions p JOIN public.matches m ON m.id = p.match_id
                  WHERE p.league_id = v_liga AND m.status = 'finished') INTO e_hay_jornadas;
  -- (97) my_powerup_credits devuelve el AJUSTE neto por jornada: créditos de
  -- la jornada menos ×2 anulados de la jornada, solo donde no da cero.
  SELECT count(*) INTO e_creditos FROM (
    SELECT z.llave FROM (
      SELECT phase || '|' || COALESCE(matchday, 0)::text AS llave, 1 AS d FROM public.powerup_credits
       WHERE user_id = v_socio AND league_id = v_liga AND phase IS NOT NULL
      UNION ALL
      SELECT public.llave_cupo(source_match_id), -1 FROM public.powerup_credits
       WHERE user_id = v_socio AND league_id = v_liga AND source_match_id IS NOT NULL) z
    GROUP BY z.llave HAVING sum(z.d) <> 0) c;
  SELECT array_agg(c.llave || '=' || c.ajuste ORDER BY c.llave) INTO e_creditos_set FROM (
    SELECT z.llave, sum(z.d) AS ajuste FROM (
      SELECT phase || '|' || COALESCE(matchday, 0)::text AS llave, 1 AS d FROM public.powerup_credits
       WHERE user_id = v_socio AND league_id = v_liga AND phase IS NOT NULL
      UNION ALL
      SELECT public.llave_cupo(source_match_id), -1 FROM public.powerup_credits
       WHERE user_id = v_socio AND league_id = v_liga AND source_match_id IS NOT NULL) z
    GROUP BY z.llave HAVING sum(z.d) <> 0) c;
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
    -- (decimosexta auditoría) Los TRES campos: con solo el campeón, un guardado
    -- que perdiera goleador y asistidor pasaba.
    SELECT count(*) INTO n FROM public.tournament_predictions
     WHERE user_id = v_socio AND league_id = v_liga AND champion_team = 'HUMO'
       AND top_scorer_name = 'HUMO' AND top_assist_name = 'HUMO';
    IF n <> 1 THEN RAISE EXCEPTION 'las globales no quedaron guardadas (los tres campos)'; END IF;
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ guardar las globales (TournamentGlobalCard)\n'; ok := ok + 1;
    ELSE r := r || '✗ guardar globales: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN  -- las lecturas de cada pantalla, y que traigan DATOS
    SELECT count(*) INTO n FROM public.my_groups();                IF n = 0 THEN RAISE EXCEPTION 'my_groups vacío'; END IF;
    SELECT count(*) INTO n FROM public.quiniela_por_id(v_liga);    IF n <> 1 THEN RAISE EXCEPTION 'quiniela_por_id devolvió %', n; END IF;
    SELECT jsonb_build_object('name', q.name, 'admin_id', q.admin_id, 'tournament_id', q.tournament_id,
             'points_exact', q.points_exact, 'points_correct', q.points_correct, 'champion_points', q.champion_points,
             'scorer_points', q.scorer_points, 'assist_points', q.assist_points, 'powerup_limit', q.powerup_limit,
             'powerup_por_partidos', q.powerup_por_partidos, 'powerup_limits', q.powerup_limits,
             'rules', q.rules, 'prizes_text', q.prizes_text, 'whatsapp_link', q.whatsapp_link,
             'is_admin', q.is_admin, 'soy_creador', q.soy_creador)
      INTO j FROM public.quiniela_por_id(v_liga) q;
    IF j IS DISTINCT FROM e_liga THEN RAISE EXCEPTION 'quiniela_por_id no dice lo que tiene la quiniela'; END IF;
    SELECT jsonb_build_object('name', g.name, 'admin_id', g.admin_id, 'tournament_id', g.tournament_id,
             'points_exact', g.points_exact, 'points_correct', g.points_correct, 'champion_points', g.champion_points,
             'scorer_points', g.scorer_points, 'assist_points', g.assist_points, 'powerup_limit', g.powerup_limit,
             'powerup_por_partidos', g.powerup_por_partidos, 'powerup_limits', g.powerup_limits,
             'rules', g.rules, 'prizes_text', g.prizes_text, 'whatsapp_link', g.whatsapp_link,
             'is_admin', g.is_admin, 'soy_creador', g.soy_creador)
      INTO j FROM public.my_groups() g WHERE g.id = v_liga;
    IF j IS DISTINCT FROM e_liga THEN RAISE EXCEPTION 'my_groups no dice lo que tiene la quiniela'; END IF;
    SELECT count(*) INTO n FROM public.cupos_por_jornada(v_liga) c
     WHERE c.cupo IS DISTINCT FROM (e_cupos->>c.llave)::int;
    IF n > 0 OR (SELECT count(*) FROM public.cupos_por_jornada(v_liga)) <> (SELECT count(*) FROM jsonb_object_keys(e_cupos)) THEN
      RAISE EXCEPTION 'cupos_por_jornada no coincide con cupo_powerups (% jornadas distintas)', n; END IF;
    IF (SELECT array_agg(f.clave ORDER BY f.clave) FROM public.fases_del_torneo(v_liga) f) IS DISTINCT FROM e_fases THEN
      RAISE EXCEPTION 'fases_del_torneo no trae las fases del torneo y de los cupos guardados'; END IF;
    IF (SELECT array_agg(c.llave || '=' || c.cupo ORDER BY c.llave) FROM public.cupos_por_jornada(v_liga) c) IS DISTINCT FROM e_cupos_set THEN
      RAISE EXCEPTION 'cupos_por_jornada: las jornadas o sus cupos no son los de la base'; END IF;
    IF (SELECT array_agg(f.clave || '|existe=' || f.existe || '|empezo=' || f.empezo ORDER BY f.clave) FROM public.fases_del_torneo(v_liga) f)
       IS DISTINCT FROM e_fases_set THEN
      RAISE EXCEPTION 'fases_del_torneo: existe/empezo no coinciden con los partidos (el candado del editor mentiría)'; END IF;
    -- (décima auditoría) La Tabla es la del dinero: no alcanza con que no venga
    -- vacía. Una fila por miembro, la del socio con los puntos de las tablas,
    -- y posiciones que arrancan en 1.
    SELECT count(*), min(pos) INTO n, a1 FROM public.group_standings(v_liga);
    IF n <> v_miembros THEN RAISE EXCEPTION 'group_standings da % filas de % miembros', n, v_miembros; END IF;
    IF a1 IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'group_standings no arranca en la posición 1 (%)', a1; END IF;
    SELECT points INTO x FROM public.group_standings(v_liga) WHERE user_id = v_socio;
    IF x IS DISTINCT FROM e_puntos_liga THEN
      RAISE EXCEPTION 'group_standings le da % puntos al socio y la quiniela tiene %', x, e_puntos_liga; END IF;
    -- Cada fila con los puntos de las tablas, y el orden coherente con ellos.
    SELECT count(*) INTO n FROM public.group_standings(v_liga) g
     WHERE g.points IS DISTINCT FROM (e_tabla->>(g.user_id::text))::numeric;
    IF n > 0 THEN RAISE EXCEPTION 'group_standings: % filas con puntos distintos de las tablas', n; END IF;
    SELECT count(*) INTO n FROM public.group_standings(v_liga) a, public.group_standings(v_liga) b
     WHERE a.pos < b.pos AND a.points < b.points;
    IF n > 0 THEN RAISE EXCEPTION 'group_standings: % pares con alguien arriba teniendo menos puntos', n; END IF;
    SELECT count(DISTINCT pos) INTO n FROM public.group_standings(v_liga);
    IF n < 2 AND v_miembros > 1 AND (SELECT count(DISTINCT points) FROM public.group_standings(v_liga)) > 1 THEN
      RAISE EXCEPTION 'group_standings: todos en la misma posición con puntos distintos'; END IF;
    j := public.league_jornadas(v_liga);
    IF NOT (j ? 'jornadas' AND j ? 'rachas') THEN RAISE EXCEPTION 'league_jornadas sin jornadas/rachas: %', left(j::text, 80); END IF;
    IF e_hay_jornadas AND COALESCE(jsonb_array_length(j->'jornadas'), 0) = 0 THEN
      RAISE EXCEPTION 'league_jornadas sin jornadas y la quiniela tiene partidos jugados'; END IF;
    SELECT count(*) INTO n FROM public.league_proposals(v_liga);  IF n <> e_propuestas THEN RAISE EXCEPTION 'league_proposals da % de %', n, e_propuestas; END IF;
    j := public.league_pozo(v_liga);
    IF (j->>'recaudado')::numeric IS DISTINCT FROM v_recaudado THEN
      RAISE EXCEPTION 'el pozo dice % recaudado y tendría que decir %', j->>'recaudado', v_recaudado; END IF;
    SELECT count(*) INTO n FROM public.league_miembros(v_liga);    IF n <> v_miembros THEN RAISE EXCEPTION 'league_miembros da % de %', n, v_miembros; END IF;
    SELECT count(*) INTO n FROM public.my_powerup_credits(v_liga); IF n <> e_creditos THEN RAISE EXCEPTION 'my_powerup_credits da % de %', n, e_creditos; END IF;
    IF (SELECT array_agg(c.phase || '|' || c.matchday || '=' || c.credits ORDER BY c.phase || '|' || c.matchday) FROM public.my_powerup_credits(v_liga) c)
       IS DISTINCT FROM e_creditos_set THEN
      RAISE EXCEPTION 'my_powerup_credits: el ajuste de alguna jornada no es el de las tablas'; END IF;
    SELECT count(*) INTO n FROM public.cupos_por_jornada(v_liga);  IF n = 0 THEN RAISE EXCEPTION 'cupos_por_jornada vacío'; END IF;
    SELECT count(*) INTO n FROM public.fases_del_torneo(v_liga);   IF n = 0 THEN RAISE EXCEPTION 'fases_del_torneo vacío'; END IF;
    j := public.perfil_en_quiniela(v_liga, v_socio);
    IF (j->>'user_id')::uuid IS DISTINCT FROM v_socio THEN RAISE EXCEPTION 'perfil_en_quiniela de otra persona: %', j->>'user_id'; END IF;
    IF (j->>'puntos')::numeric IS DISTINCT FROM e_puntos_liga THEN
      RAISE EXCEPTION 'perfil_en_quiniela dice % puntos y la quiniela tiene %', j->>'puntos', e_puntos_liga; END IF;
    SELECT count(*) INTO n FROM public.league_medals(v_liga);      IF n <> e_medallas THEN RAISE EXCEPTION 'league_medals da % de %', n, e_medallas; END IF;
    SELECT count(*) INTO n FROM public.my_medals();                IF n <> e_mis_medallas THEN RAISE EXCEPTION 'my_medals da % de %', n, e_mis_medallas; END IF;
    SELECT count(*) INTO n FROM public.ranking_global(20);          IF n = 0 THEN RAISE EXCEPTION 'ranking_global vacío'; END IF;
    SELECT count(*) INTO n FROM public.ranking_global(20) g
     WHERE g.puntos IS DISTINCT FROM (e_ranking->>(g.user_id::text))::int;
    IF n > 0 THEN RAISE EXCEPTION 'ranking_global: % filas con puntos distintos del total', n; END IF;
    SELECT count(*) INTO n FROM public.ranking_global(20) a, public.ranking_global(20) b
     WHERE a.pos < b.pos AND a.puntos < b.puntos;
    IF n > 0 THEN RAISE EXCEPTION 'ranking_global: orden incoherente con los puntos'; END IF;
    IF (SELECT array_agg(g.pos || '|' || g.user_id || '|' || g.puntos || '|' || g.soy_yo ORDER BY g.pos) FROM public.ranking_global(20) g)
       IS DISTINCT FROM e_ranking_set THEN
      RAISE EXCEPTION 'ranking_global: faltan o sobran personas, o no marca bien quién soy'; END IF;
    j := public.mi_resumen_global();
    IF (j->>'puntos')::int IS DISTINCT FROM e_puntos_global THEN
      RAISE EXCEPTION 'mi_resumen_global dice % puntos y el total es %', j->>'puntos', e_puntos_global; END IF;
    IF (j->>'quinielas')::int IS DISTINCT FROM e_quinielas THEN
      RAISE EXCEPTION 'mi_resumen_global dice % quinielas y son %', j->>'quinielas', e_quinielas; END IF;
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

  BEGIN  -- parte SIN aviso: con la fecha ya puesta, un no-op pasaba (novena auditoría)
    RESET ROLE;
    UPDATE public.league_members SET pago_avisado_at = NULL WHERE league_id = v_liga AND user_id = v_socio;
    SET LOCAL ROLE authenticated;
    PERFORM public.avisar_pago(v_liga, true);
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

  BEGIN  -- (v11) prender un ×2 de verdad: ningún paso mandaba use_powerup_x2 = true
    RESET ROLE;
    SELECT public.llave_cupo(v_m1) INTO st;
    SELECT c.usados, c.creditos INTO a1, a2 FROM public._x2_cuenta(v_socio, v_liga, st, NULL) c;
    n := public.cupo_powerups(v_liga, v_m1) + a2 - a1;   -- lugares libres en la jornada de v_m1
    SELECT array_agg(m.id ORDER BY m.kickoff_at) INTO v_x2
      FROM public.matches m
     WHERE m.tournament_id = v_tid AND public.llave_cupo(m.id) = st
       AND m.kickoff_at - interval '15 minutes' > now() AND m.status = 'pending'
       AND NOT EXISTS (SELECT 1 FROM public.predictions p WHERE p.match_id = m.id AND p.user_id = v_socio
                        AND p.league_id = v_liga AND p.use_powerup_x2);
    SET LOCAL ROLE authenticated;
    IF n > 0 AND coalesce(array_length(v_x2, 1), 0) > 0 THEN
      INSERT INTO public.predictions (user_id,league_id,match_id,prediction_type,home_goals_pred,away_goals_pred,penalties_winner_pred,use_powerup_x2)
      VALUES (v_socio, v_liga, v_x2[1], 'Marcador', 1, 0, NULL, true)
      ON CONFLICT (user_id,league_id,match_id) DO UPDATE SET user_id=excluded.user_id, league_id=excluded.league_id,
        match_id=excluded.match_id, prediction_type=excluded.prediction_type, home_goals_pred=excluded.home_goals_pred,
        away_goals_pred=excluded.away_goals_pred, penalties_winner_pred=excluded.penalties_winner_pred,
        use_powerup_x2=excluded.use_powerup_x2;
      IF NOT (SELECT use_powerup_x2 FROM public.predictions WHERE user_id = v_socio AND league_id = v_liga
               AND match_id = v_x2[1]) THEN
        RAISE EXCEPTION 'el ×2 dentro del cupo no quedó prendido'; END IF;
    END IF;
    -- pasarse: prender en TODOS los demás abiertos de esa jornada
    IF coalesce(array_length(v_x2, 1), 0) > GREATEST(n, 0) THEN
      BEGIN
        INSERT INTO public.predictions (user_id,league_id,match_id,prediction_type,home_goals_pred,away_goals_pred,penalties_winner_pred,use_powerup_x2)
        SELECT v_socio, v_liga, px.mid, 'Marcador', 1, 0, NULL, true FROM unnest(v_x2) AS px(mid)
        ON CONFLICT (user_id,league_id,match_id) DO UPDATE SET use_powerup_x2 = excluded.use_powerup_x2;
        RAISE EXCEPTION 'HUMO_PASADO';
      EXCEPTION WHEN others THEN
        IF sqlerrm = 'HUMO_PASADO' THEN RAISE EXCEPTION 'se guardaron más ×2 que el cupo (%)', n; END IF;
        IF sqlerrm NOT LIKE 'Límite de comodines x2 alcanzado%' THEN RAISE; END IF;
      END;
    END IF;
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ prender un ×2 dentro del cupo; pasarse lo rechaza el trigger\n'; ok := ok + 1;
    ELSE r := r || '✗ ×2: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN  -- (v11) AuthContext: el SELECT exacto del perfil trae SU fila; `email` no se lee
    SELECT count(*) INTO n FROM (SELECT id, display_name, avatar_url, total_points, points_adjustment,
                                        is_admin, created_at, updated_at
                                   FROM public.users WHERE id = v_socio) q;
    IF n <> 1 THEN RAISE EXCEPTION 'el perfil no se puede leer: sin él no arranca la sesión'; END IF;
    BEGIN PERFORM email FROM public.users LIMIT 1; RAISE EXCEPTION 'HUMO_ABIERTO';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ perfil de AuthContext (y el correo sigue cerrado)\n'; ok := ok + 1;
    ELSE r := r || '✗ perfil: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

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

  BEGIN PERFORM public.set_league_pozo(v_liga, v_cuota + 1, v_moneda, '[{"puesto":1,"porcentaje":100}]'::jsonb);
    IF (SELECT cuota FROM public.leagues WHERE id = v_liga) IS DISTINCT FROM v_cuota + 1 THEN
      RAISE EXCEPTION 'la cuota nueva no quedó guardada'; END IF;
    -- (v11) el reparto, DISTINTO del que hay, y la moneda intacta
    IF (SELECT (premios_reparto, moneda) FROM public.leagues WHERE id = v_liga)
       IS DISTINCT FROM ('[{"puesto":1,"porcentaje":100}]'::jsonb, v_moneda) THEN
      RAISE EXCEPTION 'el reparto del pozo no quedó guardado'; END IF;
    IF (public.league_pozo(v_liga)->>'recaudado')::numeric IS DISTINCT FROM v_recaudado THEN
      RAISE EXCEPTION 'cambiar la cuota movió lo recaudado'; END IF;
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ guardar el pozo (cuota nueva; lo recaudado no se mueve)\n'; ok := ok + 1;
    ELSE r := r || '✗ guardar pozo: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN  -- la función recorta espacios: se compara contra el texto ya recortado
    PERFORM public.set_group_extras(v_liga, 'humo · ' || COALESCE(v_premios, ''), 'https://chat.whatsapp.com/humo');
    IF (SELECT prizes_text FROM public.leagues WHERE id = v_liga) IS DISTINCT FROM btrim('humo · ' || COALESCE(v_premios, '')) THEN
      RAISE EXCEPTION 'los premios no quedaron guardados'; END IF;
    -- (v11) el enlace también, con un valor DISTINTO: mandar el mismo pasaba con un NULL fijo
    IF (SELECT whatsapp_link FROM public.leagues WHERE id = v_liga) IS DISTINCT FROM 'https://chat.whatsapp.com/humo' THEN
      RAISE EXCEPTION 'el enlace de WhatsApp no quedó guardado'; END IF;
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ guardar premios/WhatsApp\n'; ok := ok + 1;
    ELSE r := r || '✗ guardar extras: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN  -- una fase que todavía no empezó: se puede configurar por adelantado (74)
    PERFORM public.set_powerup_limits(v_liga, coalesce(v_limits, '{}'::jsonb) || '{"Humo":1}'::jsonb);
    -- (v11) ENTERO: guardar solo la clave nueva perdía las demás (la 76 otra vez)
    IF (SELECT powerup_limits FROM public.leagues WHERE id = v_liga)
       IS DISTINCT FROM coalesce(v_limits, '{}'::jsonb) || '{"Humo":1}'::jsonb THEN
      RAISE EXCEPTION 'los cupos no quedaron como se mandaron (¿se perdieron fases?)'; END IF;
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

  BEGIN  -- (novena auditoría) borrar la CUENTA de quien votó no se lleva su voto
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_creador, 'role','authenticated')::text, true);
    v_prop := public.propose_rule_change(v_liga, 'rules', jsonb_build_object('rules', v_rules), 'humo');
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_socio, 'role','authenticated')::text, true);
    PERFORM public.cast_rule_vote(v_prop, false);
    RESET ROLE;
    DELETE FROM auth.users WHERE id = v_socio;
    RAISE EXCEPTION 'HUMO_ABIERTO';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_ABIERTO' THEN r := r || E'✗ ABIERTO: borrar la cuenta de quien votó borra su voto\n'; mal := mal + 1;
    ELSIF sqlstate = '23503' AND sqlerrm LIKE '%rule_votes%' THEN r := r || E'✓ una cuenta que votó no se borra (la FK de rule_votes)\n'; ok := ok + 1;
    ELSE r := r || '✗ borrar votante, otra causa: ' || sqlerrm || E'\n'; mal := mal + 1; END IF;
    SET LOCAL ROLE authenticated;
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
  BEGIN
    -- (99) con un crédito de ×2: al salir se va con la membresía
    RESET ROLE;
    INSERT INTO public.powerup_credits (user_id, league_id, phase, matchday) VALUES (v_socio, v_liga, 'groups', 999);
    SET LOCAL ROLE authenticated;
    PERFORM public.salir_de_quiniela(v_liga);
    RESET ROLE;
    SELECT count(*) INTO n FROM public.league_members WHERE league_id = v_liga AND user_id = v_socio;
    SELECT count(*) INTO a1 FROM public.powerup_credits WHERE league_id = v_liga AND user_id = v_socio;
    -- (v11) las predicciones y las globales se van con ella (una salida que
    -- solo borraba la membresía pasaba)
    SELECT (SELECT count(*) FROM public.predictions WHERE league_id = v_liga AND user_id = v_socio)
         + (SELECT count(*) FROM public.tournament_predictions WHERE league_id = v_liga AND user_id = v_socio) INTO a2;
    SET LOCAL ROLE authenticated;
    IF n <> 0 THEN RAISE EXCEPTION 'sigue en la quiniela'; END IF;
    IF a2 <> 0 THEN RAISE EXCEPTION 'se fue y quedaron % predicciones o globales suyas', a2; END IF;
    IF a1 <> 0 THEN RAISE EXCEPTION 'se fue y conserva % créditos de ×2 para cuando vuelva', a1; END IF;
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
      -- (93) SIN prepararle una firma: el partido queda como los históricos
      -- reales (puntuado_at NULL). La v4 le ponía uno artificial y así tapaba
      -- justo el caso que fallaba (séptima auditoría).
      -- (99) Como DUEÑO de la base, no como admin global: la 99 le quitó al
      -- admin la escritura de predicciones cerradas, y esa corrección hoy solo
      -- se hace desde el dashboard.
      RESET ROLE;
      UPDATE public.predictions SET home_goals_pred = (home_goals_pred + 1) % 10 WHERE id = v_puntuada;
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
    -- (99) El USING ya no deja tocar una fila cerrada: 0 filas es rechazo.
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN RAISE EXCEPTION 'HUMO_CERO'; END IF;
    RAISE EXCEPTION 'HUMO_ABIERTO';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_ABIERTO' THEN r := r || E'✗ ABIERTO: una predicción puntuada se muda de partido con sus puntos\n'; mal := mal + 1;
    ELSIF sqlerrm LIKE 'Una predicción no cambia de%' OR sqlerrm = 'HUMO_CERO' THEN r := r || E'✓ una predicción no se muda de partido\n'; ok := ok + 1;
    ELSE r := r || '✗ mudar predicción, rechazada por otra causa: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  -- (99) Con el USING nuevo, la fila CERRADA del paso anterior ni se ve, así
  -- que ese paso ya no llega al trigger `identidad_de_prediccion_fija`. Sobre
  -- una predicción ABIERTA el USING deja pasar y quien frena es el trigger:
  -- si alguien lo borra, esto cae.
  BEGIN
    RESET ROLE;
    INSERT INTO public.predictions (user_id, league_id, match_id, prediction_type, home_goals_pred, away_goals_pred)
    VALUES (v_socio, v_liga, v_m1, 'Marcador', 1, 0) ON CONFLICT (user_id, league_id, match_id) DO NOTHING;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_socio, 'role','authenticated')::text, true);
    IF v_abierto_socio IS NULL THEN RAISE EXCEPTION 'HUMO_SIN_DATOS'; END IF;
    UPDATE public.predictions SET match_id = v_abierto_socio
     WHERE user_id = v_socio AND league_id = v_liga AND match_id = v_m1;
    RAISE EXCEPTION 'HUMO_ABIERTO';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_ABIERTO' THEN r := r || E'✗ ABIERTO: una predicción abierta se muda de partido\n'; mal := mal + 1;
    ELSIF sqlerrm LIKE 'Una predicción no cambia de%' THEN r := r || E'✓ una predicción abierta tampoco se muda (el trigger)\n'; ok := ok + 1;
    ELSE r := r || '✗ mudar predicción abierta, otra causa: ' || sqlerrm || E'\n'; mal := mal + 1; END IF;
    SET LOCAL ROLE authenticated; END;

  -- (99) las globales con el torneo CERRADO no se reescriben: el USING nuevo
  -- mira `tournament_predictions_open`, como el WITH CHECK.
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_socio, 'role','authenticated')::text, true);
    IF public.tournament_predictions_open(v_tid) THEN RAISE EXCEPTION 'HUMO_SIN_DATOS'; END IF;
    INSERT INTO public.tournament_predictions (user_id,tournament_id,league_id,champion_team,top_scorer_name,top_assist_name)
    VALUES (v_socio,v_tid,v_liga,'HUMO','HUMO','HUMO')
    ON CONFLICT (user_id,league_id) DO UPDATE SET user_id=excluded.user_id, tournament_id=excluded.tournament_id,
      league_id=excluded.league_id, champion_team=excluded.champion_team, top_scorer_name=excluded.top_scorer_name,
      top_assist_name=excluded.top_assist_name;
    RAISE EXCEPTION 'HUMO_ABIERTO';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_ABIERTO' THEN r := r || E'✗ ABIERTO: las globales se reescriben con el torneo cerrado\n'; mal := mal + 1;
    ELSIF sqlstate = '42501' THEN r := r || E'✓ globales con el torneo cerrado: 42501\n'; ok := ok + 1;
    ELSE r := r || '✗ globales cerradas, otra causa: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  -- ================================================ SIN PERMISO (tiene que ser 42501)
  r := r || E'--- cerrado por permiso ---\n';
  -- (99) el admin global TAMPOCO escribe una predicción cerrada: con el
  -- upsert completo de PredecirJornada, sobre su propia fila de un terminado.
  IF v_adm_partido IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_global, 'role','authenticated')::text, true);
    BEGIN
      INSERT INTO public.predictions (user_id,league_id,match_id,prediction_type,home_goals_pred,away_goals_pred,penalties_winner_pred,use_powerup_x2)
      VALUES (v_admin_global, v_adm_liga, v_adm_partido, 'Marcador', 7, 7, NULL, false)
      ON CONFLICT (user_id, league_id, match_id) DO UPDATE SET user_id = excluded.user_id, league_id = excluded.league_id,
        match_id = excluded.match_id, prediction_type = excluded.prediction_type, home_goals_pred = excluded.home_goals_pred,
        away_goals_pred = excluded.away_goals_pred, penalties_winner_pred = excluded.penalties_winner_pred,
        use_powerup_x2 = excluded.use_powerup_x2;
      RAISE EXCEPTION 'HUMO_ABIERTO';
    EXCEPTION WHEN others THEN
      IF sqlerrm = 'HUMO_ABIERTO' THEN r := r || E'✗ ABIERTO: el admin global reescribe una predicción de un partido terminado\n'; mal := mal + 1;
      ELSIF sqlstate = '42501' THEN r := r || E'✓ predicción cerrada del admin global: 42501\n'; ok := ok + 1;
      ELSE r := r || '✗ predicción cerrada del admin, otra causa: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;
  ELSE
    r := r || E'✗ no hay predicción cerrada del admin global con qué probar\n'; mal := mal + 1;
  END IF;
  -- (v11) VISIBILIDAD de predicciones ajenas (65): se MIDE, no «hay alguna».
  -- Lo esperado se cuenta como dueño: una política `USING (true)` pasaba la v10.
  RESET ROLE;
  SELECT count(*) INTO a1 FROM public.predictions p JOIN public.matches m ON m.id = p.match_id
   WHERE p.league_id = v_liga AND p.user_id <> v_socio AND m.kickoff_at - interval '15 minutes' <= now();
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_socio, 'role','authenticated')::text, true);
  BEGIN
    SELECT count(*) INTO n FROM public.predictions p JOIN public.matches m ON m.id = p.match_id
     WHERE p.league_id = v_liga AND p.user_id <> v_socio AND m.kickoff_at - interval '15 minutes' > now();
    IF n <> 0 THEN RAISE EXCEPTION 'el socio ve % predicciones ajenas de partidos SIN destapar', n; END IF;
    SELECT count(*) INTO n FROM public.predictions p JOIN public.matches m ON m.id = p.match_id
     WHERE p.league_id = v_liga AND p.user_id <> v_socio AND m.kickoff_at - interval '15 minutes' <= now();
    IF n <> a1 THEN RAISE EXCEPTION 'el socio ve % de % predicciones destapadas de su quiniela', n, a1; END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ajeno, 'role','authenticated')::text, true);
    SELECT count(*) INTO n FROM public.predictions WHERE league_id = v_liga;
    IF n <> 0 THEN RAISE EXCEPTION 'alguien de afuera ve % predicciones de la quiniela', n; END IF;
    SELECT count(*) INTO n FROM public.tournament_predictions WHERE league_id = v_liga;
    IF n <> 0 THEN RAISE EXCEPTION 'alguien de afuera ve % globales de la quiniela', n; END IF;
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ predicciones ajenas: sin destapar 0, destapadas todas, de afuera 0\n'; ok := ok + 1;
    ELSE r := r || '✗ visibilidad: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  -- (v11/105) un miembro no edita partidos; nadie del cliente escribe la firma de puntaje
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_socio, 'role','authenticated')::text, true);
  BEGIN
    UPDATE public.matches SET home_goals_actual = 9 WHERE id = v_m1;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'HUMO_ABIERTO'; END IF;
    BEGIN UPDATE public.matches SET puntuado_con = 'x' WHERE id = v_m1; RAISE EXCEPTION 'HUMO_ABIERTO';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ un miembro no edita partidos ni la firma de puntaje\n'; ok := ok + 1;
    ELSE r := r || '✗ editar partidos: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN  -- (104) las funciones de backend no son del cliente
    BEGIN PERFORM public.anonimizar_usuario(v_socio); RAISE EXCEPTION 'HUMO_ABIERTO';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM * FROM public.reclamar_alertas_de_puntaje(6); RAISE EXCEPTION 'HUMO_ABIERTO';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ anonimizar y alertas: solo backend (42501)\n'; ok := ok + 1;
    ELSE r := r || '✗ funciones de backend: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN  -- (105) push solo a proveedores reales; el chat no elige su fecha
    BEGIN
      INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth)
      VALUES (v_socio, 'http://169.254.169.254/humo', 'a', 'b');
      RAISE EXCEPTION 'HUMO_ABIERTO';
    EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN
      INSERT INTO public.global_chat (user_id, content, created_at) VALUES (v_socio, 'humo', '2099-01-01');
      RAISE EXCEPTION 'HUMO_ABIERTO';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ push a una URL cualquiera y chat con fecha propia: rechazados\n'; ok := ok + 1;
    ELSE r := r || '✗ push/chat: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  IF v_admin_global IS NOT NULL THEN  -- (105) la bitácora de predicciones es de cada uno, también para el admin
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_global, 'role','authenticated')::text, true);
    BEGIN
      SELECT count(*) INTO n FROM public.prediction_logs WHERE user_id <> v_admin_global;
      IF n <> 0 THEN RAISE EXCEPTION 'el admin global lee % registros ajenos (con marcador)', n; END IF;
      RAISE EXCEPTION 'HUMO_OK';
    EXCEPTION WHEN others THEN
      IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ bitácora de predicciones: el admin solo ve la suya\n'; ok := ok + 1;
      ELSE r := r || '✗ bitácora: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;
  END IF;

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
    -- El 42501 tiene que ser DE ESTA función: uno de otra tabla por dentro
    -- significaría que el cliente sí la ejecuta (novena auditoría).
    ELSIF sqlstate = '42501' AND sqlerrm LIKE '%function aplicar_puntaje%' THEN r := r || E'✓ aplicar_puntaje cerrado al cliente: 42501 de la función\n'; ok := ok + 1;
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
