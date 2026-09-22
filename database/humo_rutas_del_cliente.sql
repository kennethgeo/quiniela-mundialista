-- =============================================================================
-- PRUEBA DE HUMO de las rutas del cliente — NO ESCRIBE NADA
-- =============================================================================
-- Recorre, como `authenticated` y con el JWT de personas reales, TODO lo que la
-- app hace contra la base: guardar predicciones (con el upsert completo que
-- arma PostgREST), globales, pozo y pagos, reglas, votaciones, salir, expulsar,
-- borrar, unirse, crear, y las lecturas de cada pantalla. Y además comprueba
-- que lo que tiene que estar CERRADO siga cerrado.
--
-- POR QUÉ EXISTE: la migración 85 rompió el guardado de predicciones y nadie
-- lo vio hasta la auditoría siguiente, porque se comprobó con una petición
-- escrita a mano y no con la que manda la app. Una prueba que corre las rutas
-- REALES antes y después de cada migración es la que habría cazado eso.
--
-- CÓMO SE USA: correrla ANTES y DESPUÉS de aplicar una migración y comparar.
-- Todo va dentro de un único bloque que termina en RAISE EXCEPTION, así que
-- NADA de lo que hace queda escrito: el informe sale como texto del error.
-- Las columnas «esperado» dicen qué tiene que pasar; una línea con ✗ es algo
-- que hay que mirar ANTES de seguir.
-- =============================================================================
DO $humo$
DECLARE
  v_liga uuid; v_tid int; v_creador uuid; v_socio uuid; v_ajeno uuid; v_codigo text;
  v_m1 int; v_m2 int; v_prop uuid; v_liga_sin_pagos uuid; v_creador_sin_pagos uuid;
  v_expulsable uuid; v_rules text; v_premios text; v_wa text; v_cuota numeric;
  v_moneda text; v_reparto jsonb; v_limits jsonb;
  r text := E'\n';
  ok int := 0; mal int := 0;
BEGIN
  -- ---------------------------------------------------------------- actores
  SELECT l.id, l.tournament_id, l.admin_id, l.invitation_code, l.rules, l.prizes_text,
         l.whatsapp_link, l.cuota, l.moneda, l.premios_reparto, l.powerup_limits
    INTO v_liga, v_tid, v_creador, v_codigo, v_rules, v_premios, v_wa, v_cuota,
         v_moneda, v_reparto, v_limits
    FROM public.leagues l WHERE l.name = 'Bundestica';
  SELECT user_id INTO v_socio FROM public.league_members
   WHERE league_id = v_liga AND user_id <> v_creador AND NOT coalesce(es_admin,false)
     AND pago_confirmado_at IS NULL LIMIT 1;
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

  IF v_socio IS NULL OR v_ajeno IS NULL OR v_m1 IS NULL OR v_m2 IS NULL THEN
    RAISE EXCEPTION 'Humo: faltan actores (socio %, ajeno %, partidos % %)', v_socio, v_ajeno, v_m1, v_m2;
  END IF;

  SET LOCAL ROLE authenticated;

  -- ================================================= LO QUE TIENE QUE FUNCIONAR
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_socio, 'role','authenticated')::text, true);

  BEGIN  -- GroupPage: upsert de a uno, con el SET completo de PostgREST
    INSERT INTO public.predictions (match_id,prediction_type,home_goals_pred,away_goals_pred,penalties_winner_pred,use_powerup_x2,user_id,league_id)
    VALUES (v_m1,'Marcador',2,1,NULL,false,v_socio,v_liga)
    ON CONFLICT (user_id,league_id,match_id) DO UPDATE SET match_id=excluded.match_id, prediction_type=excluded.prediction_type,
      home_goals_pred=excluded.home_goals_pred, away_goals_pred=excluded.away_goals_pred,
      penalties_winner_pred=excluded.penalties_winner_pred, use_powerup_x2=excluded.use_powerup_x2,
      user_id=excluded.user_id, league_id=excluded.league_id;
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ guardar predicción (GroupPage)\n'; ok := ok + 1;
    ELSE r := r || '✗ guardar predicción: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN  -- PredecirJornada: lote en un solo upsert
    INSERT INTO public.predictions (user_id,league_id,match_id,prediction_type,home_goals_pred,away_goals_pred,penalties_winner_pred,use_powerup_x2)
    VALUES (v_socio,v_liga,v_m1,'Marcador',1,0,NULL,false),(v_socio,v_liga,v_m2,'Marcador',0,0,NULL,false)
    ON CONFLICT (user_id,league_id,match_id) DO UPDATE SET user_id=excluded.user_id, league_id=excluded.league_id,
      match_id=excluded.match_id, prediction_type=excluded.prediction_type, home_goals_pred=excluded.home_goals_pred,
      away_goals_pred=excluded.away_goals_pred, penalties_winner_pred=excluded.penalties_winner_pred,
      use_powerup_x2=excluded.use_powerup_x2;
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ guardar jornada (PredecirJornada)\n'; ok := ok + 1;
    ELSE r := r || '✗ guardar jornada: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN  -- lecturas de cada pantalla
    PERFORM count(*) FROM public.my_groups();
    PERFORM count(*) FROM public.quiniela_por_id(v_liga);
    PERFORM count(*) FROM public.group_standings(v_liga);
    PERFORM public.league_jornadas(v_liga);
    PERFORM count(*) FROM public.league_proposals(v_liga);
    PERFORM public.league_pozo(v_liga);
    PERFORM count(*) FROM public.league_miembros(v_liga);
    PERFORM count(*) FROM public.my_powerup_credits(v_liga);
    PERFORM count(*) FROM public.cupos_por_jornada(v_liga);
    PERFORM count(*) FROM public.fases_del_torneo(v_liga);
    PERFORM public.perfil_en_quiniela(v_liga, v_socio);
    PERFORM count(*) FROM public.predictions WHERE league_id = v_liga;
    PERFORM count(*) FROM public.tournament_predictions WHERE league_id = v_liga;
    PERFORM count(*) FROM public.league_members WHERE league_id = v_liga;
    PERFORM count(*) FROM public.leagues WHERE id = v_liga;
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ lecturas de todas las pantallas (13)\n'; ok := ok + 1;
    ELSE r := r || '✗ lecturas: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN PERFORM public.accept_group_rules(v_liga);
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ aceptar reglas\n'; ok := ok + 1;
    ELSE r := r || '✗ aceptar reglas: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN PERFORM public.avisar_pago(v_liga, true);
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ avisar «ya pagué»\n'; ok := ok + 1;
    ELSE r := r || '✗ avisar pago: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  -- ------------------------------------------------------------- el creador
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_creador, 'role','authenticated')::text, true);

  BEGIN PERFORM public.confirmar_pago(v_liga, v_socio, true);
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ confirmar un pago ajeno\n'; ok := ok + 1;
    ELSE r := r || '✗ confirmar pago: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN PERFORM public.confirmar_pago(v_liga, v_socio, false);
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ desconfirmar ese pago\n'; ok := ok + 1;
    ELSE r := r || '✗ desconfirmar pago: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN PERFORM public.set_league_pozo(v_liga, v_cuota, v_moneda, v_reparto);
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ guardar el pozo (mismos valores)\n'; ok := ok + 1;
    ELSE r := r || '✗ guardar pozo: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  -- Con el torneo ya empezado las reglas se BLOQUEAN a propósito (se cambian
  -- por votación): lo correcto acá es el rechazo, con ESE mensaje.
  BEGIN PERFORM public.set_group_rules(v_liga, v_rules);
    RAISE EXCEPTION 'HUMO_ABIERTO';
  EXCEPTION WHEN others THEN
    IF sqlerrm LIKE 'El torneo ya inició%' THEN r := r || E'✓ reglas bloqueadas con el torneo empezado\n'; ok := ok + 1;
    ELSE r := r || '✗ reglas: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN PERFORM public.set_group_extras(v_liga, v_premios, v_wa);
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ guardar premios/WhatsApp\n'; ok := ok + 1;
    ELSE r := r || '✗ guardar extras: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN PERFORM public.set_powerup_limits(v_liga, coalesce(v_limits, '{}'::jsonb));
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ guardar cupos ×2 (mismos valores)\n'; ok := ok + 1;
    ELSE r := r || '✗ guardar cupos: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN PERFORM public.set_league_admin(v_liga, v_socio, true);
        PERFORM public.set_league_admin(v_liga, v_socio, false);
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ nombrar y quitar un co-admin\n'; ok := ok + 1;
    ELSE r := r || '✗ co-admin: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN  -- votación: proponer (creador), votar (socio), cancelar (creador)
    v_prop := public.propose_rule_change(v_liga, 'rules', jsonb_build_object('rules', v_rules), 'humo');
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_socio, 'role','authenticated')::text, true);
    PERFORM public.cast_rule_vote(v_prop, false);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_creador, 'role','authenticated')::text, true);
    PERFORM public.cancel_rule_proposal(v_prop);
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ proponer, votar y cancelar\n'; ok := ok + 1;
    ELSE r := r || '✗ votación: ' || sqlerrm || E'\n'; mal := mal + 1; END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_creador, 'role','authenticated')::text, true);
  END;

  IF v_expulsable IS NOT NULL THEN
    BEGIN PERFORM public.expulsar_miembro(v_liga, v_expulsable);
      RAISE EXCEPTION 'HUMO_OK';
    EXCEPTION WHEN others THEN
      IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ expulsar a un miembro sin pago\n'; ok := ok + 1;
      ELSE r := r || '✗ expulsar: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;
  END IF;

  -- ---------------------------------------------------------- otras personas
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ajeno, 'role','authenticated')::text, true);
  BEGIN PERFORM public.join_group_by_code(v_codigo);
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ unirse con el código\n'; ok := ok + 1;
    ELSE r := r || '✗ unirse: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  BEGIN PERFORM public.create_group('humo', v_tid, NULL);
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ crear una quiniela\n'; ok := ok + 1;
    ELSE r := r || '✗ crear quiniela: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_socio, 'role','authenticated')::text, true);
  BEGIN PERFORM public.salir_de_quiniela(v_liga);
    RAISE EXCEPTION 'HUMO_OK';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ salir de la quiniela (sin pago)\n'; ok := ok + 1;
    ELSE r := r || '✗ salir: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;

  IF v_liga_sin_pagos IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_creador_sin_pagos, 'role','authenticated')::text, true);
    BEGIN PERFORM public.delete_group(v_liga_sin_pagos);
      RAISE EXCEPTION 'HUMO_OK';
    EXCEPTION WHEN others THEN
      IF sqlerrm = 'HUMO_OK' THEN r := r || E'✓ borrar una quiniela SIN pagos\n'; ok := ok + 1;
      ELSE r := r || '✗ borrar quiniela sin pagos: ' || sqlerrm || E'\n'; mal := mal + 1; END IF; END;
  END IF;

  -- ================================================= LO QUE TIENE QUE ESTAR CERRADO
  r := r || E'--- cerrado ---\n';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ajeno, 'role','authenticated')::text, true);
  BEGIN
    INSERT INTO public.league_members (league_id, user_id, es_admin) VALUES (v_liga, v_ajeno, true)
    ON CONFLICT DO NOTHING;
    RAISE EXCEPTION 'HUMO_ABIERTO';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_ABIERTO' THEN r := r || E'✗ ABIERTO: auto-inscribirse como co-admin\n'; mal := mal + 1;
    ELSE r := r || E'✓ auto-inscripción directa bloqueada\n'; ok := ok + 1; END IF; END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_creador, 'role','authenticated')::text, true);
  BEGIN
    UPDATE public.predictions SET points_earned = 9999 WHERE user_id = v_creador AND league_id = v_liga;
    RAISE EXCEPTION 'HUMO_ABIERTO';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_ABIERTO' THEN r := r || E'✗ ABIERTO: escribirse los puntos\n'; mal := mal + 1;
    ELSE r := r || E'✓ escribirse los puntos bloqueado\n'; ok := ok + 1; END IF; END;

  BEGIN
    UPDATE public.leagues SET points_exact = 50 WHERE id = v_liga;
    RAISE EXCEPTION 'HUMO_ABIERTO';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_ABIERTO' THEN r := r || E'✗ ABIERTO: cambiar el puntaje directo sobre leagues\n'; mal := mal + 1;
    ELSE r := r || E'✓ UPDATE directo sobre leagues bloqueado\n'; ok := ok + 1; END IF; END;

  BEGIN
    DELETE FROM public.leagues WHERE id = v_liga;
    IF FOUND THEN RAISE EXCEPTION 'HUMO_ABIERTO'; END IF;
    r := r || E'✓ DELETE directo sobre leagues no borra nada\n'; ok := ok + 1;
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_ABIERTO' THEN r := r || E'✗ ABIERTO: DELETE directo de una quiniela con pagos\n'; mal := mal + 1;
    ELSE r := r || E'✓ DELETE directo sobre leagues bloqueado\n'; ok := ok + 1; END IF; END;

  BEGIN
    PERFORM public.delete_group(v_liga);
    RAISE EXCEPTION 'HUMO_ABIERTO';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_ABIERTO' THEN r := r || E'✗ ABIERTO: delete_group borra una quiniela con pagos confirmados\n'; mal := mal + 1;
    ELSE r := r || E'✓ delete_group se niega con pagos confirmados\n'; ok := ok + 1; END IF; END;

  RESET ROLE;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM count(*) FROM public.tournament_predictions;
    RAISE EXCEPTION 'HUMO_ABIERTO';
  EXCEPTION WHEN others THEN
    IF sqlerrm = 'HUMO_ABIERTO' THEN r := r || E'✗ ABIERTO: anon lee las globales\n'; mal := mal + 1;
    ELSE r := r || E'✓ anon no lee las globales\n'; ok := ok + 1; END IF; END;
  RESET ROLE;

  RAISE EXCEPTION 'HUMO: % bien, % mal (nada se escribió)%', ok, mal, r;
END $humo$;
