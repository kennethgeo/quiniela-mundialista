-- =============================================================================
-- 61_endurecer_permisos.sql  ·  Cerrar la escalada de privilegios y el acceso
--                                anónimo a las funciones privilegiadas
-- =============================================================================
-- Contexto: la quiniela va a abrirse al público, así que el modelo de amenaza
-- deja de ser "17 amigos" y pasa a ser "cualquiera con la anon key", que es
-- pública por diseño. Esta migración cierra los agujeros de una auditoría
-- externa, verificados uno por uno contra el código y contra la BD.
--
-- QUÉ ARREGLA
--
-- 1) ESCALADA A ADMIN (crítico). La política users_update_own solo preguntaba
--    "¿es tu fila?", y la fila incluye is_admin. Cualquiera podía hacerse
--    administrador global desde la consola del navegador con un UPDATE.
--
-- 2) FUNCIONES PRIVILEGIADAS ABIERTAS A anon (crítico). PostgreSQL otorga
--    EXECUTE a PUBLIC por defecto al crear una función, y un GRANT posterior
--    a 'authenticated' NO lo revoca. Las 44 funciones SECURITY DEFINER de la
--    base eran ejecutables por anon. Además, void_cancelled_match y
--    resolve_pending_powerup_credits usaban 'auth.uid() IS NULL' como prueba
--    de "me llama el backend" — pero una llamada anónima también da NULL.
--
-- 3) SALTARSE LA VOTACIÓN. _apply_rule_proposal no valida quién llama ni el
--    estado de la propuesta: cualquier miembro con el UUID podía aplicar un
--    cambio de reglas que el grupo había rechazado.
--
-- 4) CORREOS EXPUESTOS. users_select_authenticated permite leer todas las
--    filas y la tabla tiene email; RLS filtra filas, no columnas.
--
-- 5) PUNTOS DE ASISTIDOR PERDIDOS en el total global (ni la función ni el
--    trigger los contemplaban).
--
-- 6) CARRERA EN EL CUPO DE ×2: el trigger contaba sin serializar, así que dos
--    envíos simultáneos podían pasarse del límite.
--
-- DOS TRAMPAS QUE ESTA MIGRACIÓN EVITA A PROPÓSITO
--
--   · recompute_user_total era SECURITY INVOKER y lo dispara CADA guardado de
--     predicción. Al restringir las columnas de users, ese UPDATE pasaría a
--     fallar por permisos y NADIE PODRÍA PREDECIR. Por eso se convierte en
--     SECURITY DEFINER antes de tocar los permisos.
--   · is_league_member, tournament_predictions_open y es_admin_liga se usan
--     DENTRO de políticas RLS, donde se evalúan como quien llama. Aunque
--     ningún cliente las invoque directo, 'authenticated' necesita EXECUTE o
--     se caen todas las lecturas que dependen de esas políticas.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0) Quién llama de verdad
-- -----------------------------------------------------------------------------
-- PostgREST fija request.jwt.claims en TODA petición, incluidas las anónimas
-- (ahí el rol es 'anon'). Que no haya claims significa conexión directa a la
-- base — psql, el SQL Editor, un cron con la service key — o sea, confianza.
-- Esto reemplaza a 'auth.uid() IS NULL', que confundía anónimo con backend.
CREATE OR REPLACE FUNCTION public.es_backend()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
           NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
           'service_role'
         ) = 'service_role';
$$;
COMMENT ON FUNCTION public.es_backend() IS
  'TRUE si la llamada viene con rol service_role o por conexión directa. Nunca usar auth.uid() IS NULL para esto: anon también da NULL.';

-- -----------------------------------------------------------------------------
-- 1) recompute_user_total: SECURITY DEFINER + puntos de asistidor
-- -----------------------------------------------------------------------------
-- DEFINER porque lo dispara el trigger de predictions con los privilegios de
-- quien guarda la predicción, y abajo le quitamos a esa gente el permiso de
-- escribir total_points.
CREATE OR REPLACE FUNCTION public.recompute_user_total(p_user_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.users u
  SET total_points =
        COALESCE((SELECT SUM(COALESCE(points_earned, 0))
                  FROM public.predictions WHERE user_id = p_user_id), 0)
      + COALESCE((SELECT SUM(COALESCE(champion_points, 0)
                           + COALESCE(top_scorer_points, 0)
                           + COALESCE(top_assist_points, 0))
                  FROM public.tournament_predictions WHERE user_id = p_user_id), 0)
      + COALESCE(u.points_adjustment, 0)
  WHERE u.id = p_user_id;
$$;

-- Y la función de trigger pasa a DEFINER también. Esto NO es cosmético: el
-- trigger corre con los privilegios de quien guarda la predicción, así que al
-- revocar EXECUTE más abajo el PERFORM de adentro fallaba con "permission
-- denied for function recompute_user_total" y NADIE PODÍA PREDECIR. Se detectó
-- probando la migración contra Postgres, no leyéndola.
CREATE OR REPLACE FUNCTION public.trg_recompute_user_total()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    PERFORM public.recompute_user_total(OLD.user_id);
    RETURN OLD;
  END IF;
  IF (TG_OP = 'UPDATE') AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN
    PERFORM public.recompute_user_total(OLD.user_id);
  END IF;
  PERFORM public.recompute_user_total(NEW.user_id);
  RETURN NEW;
END; $$;

-- El trigger tampoco escuchaba top_assist_points: repartir los puntos de
-- asistidor no recalculaba nada.
DROP TRIGGER IF EXISTS tournament_predictions_recompute_total ON public.tournament_predictions;
CREATE TRIGGER tournament_predictions_recompute_total
  AFTER INSERT OR DELETE OR
  UPDATE OF champion_points, top_scorer_points, top_assist_points, user_id
  ON public.tournament_predictions
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_user_total();

-- -----------------------------------------------------------------------------
-- 2) users: nadie se hace admin, y el correo deja de ser público
-- -----------------------------------------------------------------------------
-- Privilegios POR COLUMNA. Un UPDATE que toque is_admin ahora falla con
-- "permission denied for column", antes incluso de llegar a la política RLS.
REVOKE UPDATE ON public.users FROM authenticated, anon;
GRANT  UPDATE (display_name, avatar_url) ON public.users TO authenticated;

-- SELECT sin email. No se puede revocar una columna de un GRANT de tabla:
-- hay que quitar el de tabla y otorgar la lista explícita.
REVOKE SELECT ON public.users FROM authenticated, anon;
GRANT  SELECT (id, display_name, avatar_url, total_points, points_adjustment,
               is_admin, created_at, updated_at)
       ON public.users TO authenticated;

-- Cinturón y tirantes: si alguien vuelve a correr un GRANT ALL amplio (algo
-- muy fácil de copiar de un tutorial), el trigger sigue protegiendo.
-- SECURITY INVOKER a propósito: así current_user delata el contexto real —
-- 'authenticated'/'anon' en un UPDATE directo desde PostgREST, y el dueño de
-- la función cuando el UPDATE viene de adentro de un SECURITY DEFINER nuestro.
CREATE OR REPLACE FUNCTION public.congelar_campos_sensibles_users()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.is_admin          := OLD.is_admin;
    NEW.total_points      := OLD.total_points;
    NEW.points_adjustment := OLD.points_adjustment;
    NEW.email             := OLD.email;
    NEW.id                := OLD.id;
    NEW.created_at        := OLD.created_at;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS users_congelar_campos_sensibles ON public.users;
CREATE TRIGGER users_congelar_campos_sensibles
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.congelar_campos_sensibles_users();

-- -----------------------------------------------------------------------------
-- 3) void_cancelled_match / resolve_pending_powerup_credits: rol explícito
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.void_cancelled_match(p_match_id integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status text; v_tid int; v_kickoff timestamptz;
  v_next_phase text; v_next_matchday integer;
  r record; v_zeroed int := 0; v_refunded int := 0;
BEGIN
  -- Antes: 'auth.uid() IS NOT NULL AND no es admin'. Una llamada anónima daba
  -- auth.uid() NULL y se colaba entera.
  IF NOT public.es_backend()
     AND COALESCE((SELECT is_admin FROM public.users WHERE id = auth.uid()), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Solo un administrador puede anular un partido';
  END IF;

  SELECT status, tournament_id, kickoff_at INTO v_status, v_tid, v_kickoff
  FROM public.matches WHERE id = p_match_id;

  IF v_status IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'Partido no encontrado');
  END IF;
  IF v_status NOT IN ('cancelled', 'postponed') THEN
    RETURN jsonb_build_object('status', 'ok', 'message', 'El partido no está cancelado', 'zeroed', 0, 'refunded', 0);
  END IF;

  SELECT m.phase, m.matchday INTO v_next_phase, v_next_matchday
  FROM public.matches m
  WHERE m.tournament_id = v_tid AND m.kickoff_at > v_kickoff
    AND m.status NOT IN ('cancelled', 'postponed')
  ORDER BY m.kickoff_at ASC LIMIT 1;

  FOR r IN
    SELECT p.id, p.user_id, p.league_id, p.use_powerup_x2
    FROM public.predictions p WHERE p.match_id = p_match_id
  LOOP
    UPDATE public.predictions SET points_earned = 0 WHERE id = r.id;
    v_zeroed := v_zeroed + 1;

    IF r.use_powerup_x2 THEN
      UPDATE public.predictions SET use_powerup_x2 = FALSE WHERE id = r.id;
      INSERT INTO public.powerup_credits (user_id, league_id, phase, matchday, source_match_id)
      VALUES (r.user_id, r.league_id, v_next_phase, v_next_matchday, p_match_id)
      ON CONFLICT (user_id, league_id, source_match_id) DO NOTHING;
      v_refunded := v_refunded + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('status', 'ok', 'zeroed', v_zeroed, 'refunded', v_refunded);
END; $$;

CREATE OR REPLACE FUNCTION public.resolve_pending_powerup_credits(p_tournament_id integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_next_phase text; v_next_matchday integer; v_resolved int := 0;
BEGIN
  -- Antes no tenía NINGUNA comprobación de quién llamaba.
  IF NOT public.es_backend()
     AND COALESCE((SELECT is_admin FROM public.users WHERE id = auth.uid()), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Solo un administrador puede resolver créditos pendientes';
  END IF;

  FOR r IN
    SELECT pc.id, sm.kickoff_at AS src_kickoff
    FROM public.powerup_credits pc
    JOIN public.leagues l ON l.id = pc.league_id
    JOIN public.matches sm ON sm.id = pc.source_match_id
    WHERE l.tournament_id = p_tournament_id
      AND pc.phase IS NULL AND pc.consumed_at IS NULL
  LOOP
    SELECT m.phase, m.matchday INTO v_next_phase, v_next_matchday
    FROM public.matches m
    WHERE m.tournament_id = p_tournament_id
      AND m.kickoff_at > r.src_kickoff
      AND m.status NOT IN ('cancelled', 'postponed')
    ORDER BY m.kickoff_at ASC LIMIT 1;

    IF v_next_phase IS NOT NULL THEN
      UPDATE public.powerup_credits
      SET phase = v_next_phase, matchday = v_next_matchday
      WHERE id = r.id;
      v_resolved := v_resolved + 1;
    END IF;
  END LOOP;

  RETURN v_resolved;
END; $$;

-- -----------------------------------------------------------------------------
-- 4) _apply_rule_proposal: no se aplica una propuesta que no está en votación
-- -----------------------------------------------------------------------------
-- La defensa principal es el REVOKE de más abajo (PostgREST deja de poder
-- enrutar a esta función). Esto es la segunda línea: sus dos llamadores
-- legítimos la invocan con la propuesta todavía en 'open', así que exigirlo
-- impide re-aplicar una rechazada, cancelada o ya cerrada.
CREATE OR REPLACE FUNCTION public._apply_rule_proposal(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.rule_proposals;
BEGIN
  SELECT * INTO r FROM public.rule_proposals WHERE id = p_id;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'Propuesta inexistente';
  END IF;
  IF r.status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'Esta propuesta ya está cerrada y no se puede aplicar';
  END IF;

  IF r.kind = 'scoring' THEN
    UPDATE public.leagues SET
      points_exact    = GREATEST(0, COALESCE((r.payload->>'points_exact')::int,    points_exact)),
      points_correct  = GREATEST(0, COALESCE((r.payload->>'points_correct')::int,  points_correct)),
      champion_points = GREATEST(0, COALESCE((r.payload->>'champion_points')::int, champion_points)),
      scorer_points   = GREATEST(0, COALESCE((r.payload->>'scorer_points')::int,   scorer_points)),
      assist_points   = GREATEST(0, COALESCE((r.payload->>'assist_points')::int,   assist_points)),
      powerup_limit   = GREATEST(0, COALESCE((r.payload->>'powerup_limit')::int,   powerup_limit))
    WHERE id = r.league_id;
  ELSIF r.kind = 'rules' THEN
    UPDATE public.leagues SET rules = btrim(COALESCE(r.payload->>'rules','')) WHERE id = r.league_id;
    UPDATE public.league_members SET rules_accepted_at = NULL
    WHERE league_id = r.league_id AND user_id <> r.proposed_by;
  END IF;
END; $$;

-- -----------------------------------------------------------------------------
-- 5) Lecturas que no validaban membresía
-- -----------------------------------------------------------------------------
-- league_table decía en su propio comentario "no valida membresía (lo hace
-- quien la llama)". Con el REVOKE ya no es alcanzable desde fuera, pero la
-- comprobación se agrega igual por si algún día se vuelve a otorgar.
CREATE OR REPLACE FUNCTION public.league_table(p_league_id uuid)
RETURNS TABLE (
  uid uuid, display_name text, avatar_url text, created_at timestamptz,
  points numeric, exactos_x2 int, exactos int, aciertos int, jugadas int, error_goles int, pos int
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.es_backend()
     AND NOT EXISTS (SELECT 1 FROM public.league_members lm
                     WHERE lm.league_id = p_league_id AND lm.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'No sos miembro de esta quiniela';
  END IF;

  RETURN QUERY
  WITH agg AS (
    SELECT u.id AS uid, u.display_name, u.avatar_url, u.created_at,
           public.league_points(p_league_id, u.id) AS points,
           COALESCE(SUM(CASE WHEN m.status = 'finished' AND p.use_powerup_x2
                              AND p.home_goals_pred = m.home_goals_actual
                              AND p.away_goals_pred = m.away_goals_actual
                             THEN 1 ELSE 0 END), 0)::int AS exactos_x2,
           COALESCE(SUM(CASE WHEN m.status = 'finished'
                              AND p.home_goals_pred = m.home_goals_actual
                              AND p.away_goals_pred = m.away_goals_actual
                             THEN 1 ELSE 0 END), 0)::int AS exactos,
           COALESCE(SUM(CASE WHEN m.status = 'finished' AND COALESCE(p.points_earned, 0) > 0
                             THEN 1 ELSE 0 END), 0)::int AS aciertos,
           COALESCE(SUM(CASE WHEN m.status = 'finished' THEN 1 ELSE 0 END), 0)::int AS jugadas,
           COALESCE(SUM(CASE WHEN m.status = 'finished'
                             THEN abs(p.home_goals_pred - m.home_goals_actual)
                                + abs(p.away_goals_pred - m.away_goals_actual)
                             ELSE 0 END), 0)::int AS error_goles
    FROM public.league_members lm
    JOIN public.users u ON u.id = lm.user_id
    LEFT JOIN public.predictions p ON p.user_id = u.id AND p.league_id = p_league_id
    LEFT JOIN public.matches m ON m.id = p.match_id
    WHERE lm.league_id = p_league_id
    GROUP BY u.id, u.display_name, u.avatar_url, u.created_at
  )
  SELECT a.uid, a.display_name, a.avatar_url, a.created_at, a.points, a.exactos_x2,
         a.exactos, a.aciertos, a.jugadas, a.error_goles,
         (row_number() OVER (ORDER BY a.points DESC, a.exactos_x2 DESC, a.exactos DESC,
                                      a.aciertos DESC, a.jugadas DESC, a.error_goles ASC,
                                      a.created_at ASC))::int
  FROM agg a;
END; $$;

-- El registro de correcciones lo ve quien juega ese torneo, no cualquiera.
CREATE OR REPLACE FUNCTION public.match_audit_log(p_tournament_id integer, p_limite integer DEFAULT 30)
RETURNS TABLE (
  id uuid, changed_at timestamptz, campo text, valor_antes text, valor_despues text,
  match_id integer, home_team text, away_team text, matchday integer, autor text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.es_backend()
     AND NOT EXISTS (SELECT 1 FROM public.league_members lm
                     JOIN public.leagues l ON l.id = lm.league_id
                     WHERE lm.user_id = auth.uid() AND l.tournament_id = p_tournament_id) THEN
    RAISE EXCEPTION 'No jugás ninguna quiniela de este torneo';
  END IF;

  RETURN QUERY
  SELECT a.id, a.changed_at, a.campo, a.valor_antes, a.valor_despues,
         m.id, m.home_team, m.away_team, m.matchday,
         COALESCE(u.display_name, 'Admin')
  FROM public.match_audit a
  JOIN public.matches m ON m.id = a.match_id
  LEFT JOIN public.users u ON u.id = a.changed_by
  WHERE m.tournament_id = p_tournament_id
  ORDER BY a.changed_at DESC
  LIMIT GREATEST(p_limite, 1);
END; $$;

-- Recalcular medallas es caro (recorre el torneo entero): solo admin de la
-- quiniela. Antes lo podía disparar cualquiera, en bucle.
--
-- El motor de medallas son ~140 líneas que NO se tocan: se renombra el
-- original a _..._inner y se crea encima un envoltorio con la guarda. Copiar
-- el cuerpo a mano sería la forma más fácil de introducir un bug de puntaje.
DO $ren$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'recompute_league_badges')
     AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = '_recompute_league_badges_inner') THEN
    ALTER FUNCTION public.recompute_league_badges(uuid)
      RENAME TO _recompute_league_badges_inner;
  END IF;
END $ren$;

CREATE OR REPLACE FUNCTION public.recompute_league_badges(p_league_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.es_backend() AND NOT public.es_admin_liga(p_league_id, auth.uid()) THEN
    RAISE EXCEPTION 'Solo un administrador de la quiniela puede recalcular las medallas';
  END IF;
  PERFORM public._recompute_league_badges_inner(p_league_id);
END; $$;

-- -----------------------------------------------------------------------------
-- 6) Cupo de ×2: serializar las activaciones concurrentes
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_powerup_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_phase text; v_matchday integer; v_base_limit integer; v_current integer;
  v_credits integer; v_activating boolean; v_prev_x2 boolean;
BEGIN
  SELECT use_powerup_x2 INTO v_prev_x2
  FROM public.predictions
  WHERE user_id = NEW.user_id AND league_id = NEW.league_id AND match_id = NEW.match_id;

  v_activating := (NEW.use_powerup_x2 = TRUE) AND (COALESCE(v_prev_x2, FALSE) = FALSE);

  IF v_activating AND NEW.league_id IS NOT NULL THEN
    SELECT phase, COALESCE(matchday, 0) INTO v_phase, v_matchday
    FROM public.matches WHERE id = NEW.match_id;

    -- Sin esto, dos predicciones enviadas a la vez leen el mismo conteo y las
    -- dos pasan: el cupo se supera por uno. El lock es por
    -- (usuario, liga, fase, jornada) y se suelta al terminar la transacción.
    PERFORM pg_advisory_xact_lock(
      hashtextextended(NEW.user_id::text || NEW.league_id::text
                       || COALESCE(v_phase, '') || v_matchday::text, 0));

    SELECT powerup_limit INTO v_base_limit FROM public.leagues WHERE id = NEW.league_id;

    SELECT COUNT(*) INTO v_current
    FROM public.predictions p
    JOIN public.matches m ON p.match_id = m.id
    WHERE p.user_id = NEW.user_id
      AND p.league_id = NEW.league_id
      AND p.use_powerup_x2 = TRUE
      AND m.phase = v_phase
      AND COALESCE(m.matchday, 0) = v_matchday
      AND p.match_id <> NEW.match_id;

    SELECT COUNT(*) INTO v_credits
    FROM public.powerup_credits
    WHERE user_id = NEW.user_id AND league_id = NEW.league_id
      AND phase = v_phase AND COALESCE(matchday, 0) = v_matchday
      AND consumed_at IS NULL;

    IF v_current >= COALESCE(v_base_limit, 0) + COALESCE(v_credits, 0) THEN
      RAISE EXCEPTION 'Límite de comodines x2 alcanzado para esta jornada.';
    END IF;
  END IF;

  IF COALESCE(v_prev_x2, FALSE) = TRUE AND NEW.use_powerup_x2 = FALSE THEN
    UPDATE public.powerup_credits SET consumed_at = NULL, consumed_by_prediction_id = NULL
    WHERE consumed_by_prediction_id = NEW.id;
  END IF;

  RETURN NEW;
END; $$;

-- -----------------------------------------------------------------------------
-- 7) Reparto del pozo: validar de verdad
-- -----------------------------------------------------------------------------
-- Antes: si el JSON no era un arreglo se saltaba la validación ENTERA, los
-- porcentajes negativos pasaban (solo se miraba que la suma no excediera 100)
-- y se podían repetir puestos.
CREATE OR REPLACE FUNCTION public.set_league_pozo(
  p_league_id uuid, p_cuota numeric, p_moneda text, p_reparto jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_suma numeric;
  v_n int;
  v_distintos int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT public.es_admin_liga(p_league_id, v_uid) THEN
    RAISE EXCEPTION 'Solo un administrador puede configurar el pozo';
  END IF;
  IF COALESCE(p_cuota, 0) < 0 THEN RAISE EXCEPTION 'La cuota no puede ser negativa'; END IF;
  IF COALESCE(p_cuota, 0) > 100000000 THEN RAISE EXCEPTION 'La cuota es absurdamente alta'; END IF;
  IF COALESCE(NULLIF(btrim(p_moneda), ''), 'CRC') NOT IN ('CRC', 'USD') THEN
    RAISE EXCEPTION 'Moneda no soportada';
  END IF;

  IF p_reparto IS NOT NULL THEN
    IF jsonb_typeof(p_reparto) <> 'array' THEN
      RAISE EXCEPTION 'El reparto tiene que ser una lista de puestos';
    END IF;

    SELECT count(*),
           count(DISTINCT (e->>'puesto')),
           COALESCE(SUM((e->>'porcentaje')::numeric), 0)
      INTO v_n, v_distintos, v_suma
    FROM jsonb_array_elements(p_reparto) e;

    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_reparto) e
               WHERE jsonb_typeof(e) <> 'object'
                  OR (e->>'puesto') IS NULL OR (e->>'porcentaje') IS NULL
                  OR (e->>'puesto') !~ '^[0-9]+$'
                  OR (e->>'porcentaje') !~ '^[0-9]+(\.[0-9]+)?$'
                  OR (e->>'puesto')::int < 1
                  OR (e->>'porcentaje')::numeric > 100) THEN
      RAISE EXCEPTION 'Cada puesto necesita un número entero >= 1 y un porcentaje entre 0 y 100';
    END IF;

    IF v_distintos <> v_n THEN
      RAISE EXCEPTION 'Hay puestos repetidos en el reparto';
    END IF;
    IF v_suma > 100 THEN
      RAISE EXCEPTION 'El reparto suma % por ciento y no puede pasar de 100', v_suma;
    END IF;
  END IF;

  UPDATE public.leagues SET
    cuota = COALESCE(p_cuota, 0),
    moneda = COALESCE(NULLIF(btrim(p_moneda), ''), 'CRC'),
    premios_reparto = p_reparto
  WHERE id = p_league_id;
END; $$;

-- =============================================================================
-- 8) EL REVOKE: quitar el EXECUTE que PostgreSQL regala a PUBLIC
-- =============================================================================
-- Un GRANT a 'authenticated' no quita el de PUBLIC — comprobado. Por eso hay
-- que revocar primero y volver a otorgar la lista EXACTA.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;

-- Que las funciones FUTURAS no vuelvan a nacer abiertas.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Se otorga POR NOMBRE, resolviendo la firma real desde el catálogo. Escribir
-- las firmas a mano es la forma más fácil de que la migración explote a mitad
-- de camino por un 'int' que en realidad era 'integer', o de dejar afuera una
-- sobrecarga y romper una pantalla sin darse cuenta.
DO $g$
DECLARE
  r record;
  -- Inventario sacado de los supabase.rpc(...) del frontend, no a ojo.
  v_frontend text[] := ARRAY[
    'accept_group_rules', 'avisar_pago', 'cancel_rule_proposal', 'cast_rule_vote',
    'confirmar_pago', 'create_group', 'delete_group', 'expulsar_miembro',
    'group_standings', 'join_group_by_code', 'league_jornadas', 'league_medals',
    'league_miembros', 'league_pozo', 'league_proposals', 'match_audit_log',
    'my_groups', 'my_medals', 'my_powerup_credits', 'propose_rule_change',
    'recompute_league_badges', 'set_group_extras', 'set_group_rules',
    'set_group_scoring', 'set_league_admin', 'set_league_pozo',
    -- Estas cuatro NO las llama ningún cliente, pero viven DENTRO de políticas
    -- RLS, donde se evalúan como quien consulta. Sin EXECUTE se caen todas las
    -- lecturas que dependen de esas políticas.
    'is_league_member', 'tournament_predictions_open', 'es_admin_liga', 'es_backend'
  ];
  v_backend text[] := ARRAY[
    'void_cancelled_match', 'resolve_pending_powerup_credits',
    'recompute_user_total', 'recompute_league_badges'
  ];
  v_faltan text[] := '{}';
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY (v_frontend)
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY (v_backend)
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;

  -- Si alguna del inventario no existe en esta base, hay que enterarse ahora y
  -- no cuando un usuario reporte una pantalla en blanco.
  SELECT array_agg(x) INTO v_faltan
  FROM unnest(v_frontend || v_backend) x
  WHERE NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public' AND p.proname = x);
  IF v_faltan IS NOT NULL THEN
    RAISE WARNING 'Funciones del inventario que no existen en esta base: %', v_faltan;
  END IF;
END $g$;

-- Todo lo demás queda SIN permiso para anon y authenticated a propósito:
-- _apply_rule_proposal, _tally_rule_proposal, _resolve_expired_proposals,
-- league_points, league_rank, league_table, group_tournament_started y las
-- funciones de trigger. Se siguen ejecutando desde adentro de las funciones
-- SECURITY DEFINER que las usan, porque ahí corren con los privilegios del
-- dueño, no con los de quien llamó.

-- =============================================================================
-- 9) RED DE SEGURIDAD
-- =============================================================================
-- schema.sql ya no representa la base viva (las migraciones se corren a mano),
-- así que el inventario de arriba se sacó del repo y podría no cubrir algo que
-- solo existe en producción. Este bloque revisa la base REAL y avisa de dos
-- cosas que dejarían pantallas en blanco sin dar una pista clara:
--   · funciones invocadas DENTRO de una política RLS que quedaron sin EXECUTE
--     (ahí se evalúan como quien consulta, no como el dueño)
--   · funciones SECURITY DEFINER que 'anon' todavía puede ejecutar
DO $red$
DECLARE
  r record;
  v_huerfanas text[] := '{}';
  v_abiertas  text[] := '{}';
BEGIN
  FOR r IN
    SELECT DISTINCT m[1] AS fn
    FROM pg_policies pol,
         LATERAL regexp_matches(
           COALESCE(pol.qual, '') || ' ' || COALESCE(pol.with_check, ''),
           '(?:public\.)?([a-z_][a-z0-9_]*)\s*\(', 'g') AS m
    WHERE pol.schemaname = 'public'
  LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.proname = r.fn)
       AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                       WHERE n.nspname = 'public' AND p.proname = r.fn
                         AND has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    THEN
      v_huerfanas := v_huerfanas || r.fn;
    END IF;
  END LOOP;

  SELECT array_agg(p.proname ORDER BY p.proname) INTO v_abiertas
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF v_huerfanas <> '{}' THEN
    RAISE WARNING 'REVISAR: funciones usadas en políticas RLS que quedaron sin EXECUTE para authenticated: %', v_huerfanas;
  END IF;
  IF v_abiertas IS NOT NULL THEN
    RAISE WARNING 'REVISAR: SECURITY DEFINER que anon todavía puede ejecutar: %', v_abiertas;
  END IF;
  IF v_huerfanas = '{}' AND v_abiertas IS NULL THEN
    RAISE NOTICE 'Permisos correctos: ninguna política quedó huérfana y anon no ejecuta ninguna SECURITY DEFINER.';
  END IF;
END $red$;

NOTIFY pgrst, 'reload schema';
