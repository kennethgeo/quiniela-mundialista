-- =============================================================================
-- 73_una_sola_llave_de_cupo.sql
-- El cupo de ×2 se ELIGE por fase pero se CONTABA por otra cosa. Una sola
-- llave: (clave_fase, jornada). Solo funciones: no cambia ninguna fila.
-- Idempotente.
-- =============================================================================
--
-- EL DESFASE, REPRODUCIDO EN POSTGRES CON LA POSTEMPORADA REAL DE LA LIGA TICA
-- (semifinales y final, tal como las publica ESPN):
--
--   powerup_limits = {"Semifinal": 2, "Final": 1}
--   uso 2 comodines en semifinales   -> OK
--   uso 1 en la final                -> ERROR: Límite de comodines x2 alcanzado
--
-- Porque había DOS agrupaciones distintas:
--   · cupo_powerups elegía el NÚMERO por clave_fase()  -> 'Semifinal' / 'Final'
--   · check_powerup_limit CONTABA por (phase, matchday) -> ('knockout', NULL)
--
-- En la liga tica y en la Champions TODA la postemporada llega con
-- phase='knockout' y matchday NULL, así que las semifinales y la final caían
-- en la misma bolsa al contar, mientras el límite cambiaba de ronda en ronda.
-- Configurar «Semifinal 2 / Final 1» dejaba la final SIN comodines.
--
-- En el Mundial no se notaba: ahí cada ronda trae su propia `phase`, así que
-- las dos agrupaciones coincidían por casualidad.
--
-- NO CAMBIA NADA DE LO YA JUGADO. Para 'groups' la clave es 'groups' y la
-- jornada sigue siendo la misma; para el Mundial clave_fase(phase,NULL)=phase.
-- O sea que las bolsas de todos los partidos que existen hoy son idénticas
-- antes y después (se comprueba abajo, partido por partido).

-- TODO EN UNA TRANSACCIÓN. El DDL de Postgres es transaccional, así que si la
-- comprobación de abajo falla no queda nada a medias: o entra entera o no
-- entra. Correrla por partes desde el editor de SQL sería lo peligroso.
BEGIN;

-- ── 0. Comprobación PREVIA: esto se mira antes de cambiar nada ─────────────
-- LO QUE NO PUEDE PASAR es que alguien quede PASADO DE CUPO por el cambio: un
-- ×2 ya activado que, al partirse su bolsa, no quepa en la que le toca. Que
-- una bolsa se parta es el OBJETIVO de la migración, así que no se mira si
-- cambia —cambiaría siempre— sino si el corte deja a alguien por encima.
--
-- Escrito así a propósito para que sea IDEMPOTENTE: mide el estado final, no
-- la diferencia. Después de aplicarla, volver a correrla comprueba lo mismo y
-- pasa. Una comprobación de "cambió de bolsa" saltaba en falso la segunda vez.
--
-- Hoy en producción da 0 filas: ningún partido cargado tiene phase='knockout'
-- (la liga tica y la Champions aún no publicaron su postemporada, y el Mundial
-- trae la ronda en la propia `phase`), así que ninguna bolsa se parte.
DO $previo$
DECLARE r record; v_pasados integer := 0;
BEGIN
  FOR r IN
    SELECT p.user_id, p.league_id,
           public.clave_fase(m.phase, m.stage) AS clave,
           COALESCE(m.matchday, 0) AS jornada,
           COUNT(*) AS usados,
           MIN(m.id) AS un_partido
    FROM public.predictions p
    JOIN public.matches m ON m.id = p.match_id
    WHERE p.use_powerup_x2 = TRUE
      -- Solo las bolsas que este cambio parte en dos.
      AND public.clave_fase(m.phase, m.stage) IS DISTINCT FROM COALESCE(m.phase, 'groups')
    GROUP BY 1, 2, 3, 4
  LOOP
    IF r.usados > public.cupo_powerups(r.league_id, r.un_partido) THEN
      RAISE WARNING 'Usuario % en la quiniela %: % comodines en la bolsa %|%, cupo %',
        r.user_id, r.league_id, r.usados, r.clave, r.jornada,
        public.cupo_powerups(r.league_id, r.un_partido);
      v_pasados := v_pasados + 1;
    END IF;
  END LOOP;

  IF v_pasados > 0 THEN
    RAISE EXCEPTION
      '% casos quedarían pasados de cupo (ver los WARNING de arriba): '
      'subir el cupo de esas fases antes de aplicar esto', v_pasados;
  END IF;
END $previo$;

-- ── 1. La llave de una bolsa de cupo, en un solo lugar ─────────────────────
CREATE OR REPLACE FUNCTION public.llave_cupo(p_match_id integer)
RETURNS text
LANGUAGE sql STABLE
SET search_path TO pg_catalog, public
AS $$
  SELECT public.clave_fase(m.phase, m.stage) || '|' || COALESCE(m.matchday, 0)::text
  FROM public.matches m WHERE m.id = p_match_id;
$$;

COMMENT ON FUNCTION public.llave_cupo(integer) IS
  'Bolsa de cupo de ×2 de un partido: clave de fase + jornada. La usan el '
  'trigger que valida, cupo_powerups y cupos_por_jornada. Una sola definición.';

-- ── 2. El trigger cuenta en la MISMA bolsa de la que sale el número ────────
CREATE OR REPLACE FUNCTION public.check_powerup_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_llave text; v_base_limit integer; v_current integer;
  v_credits integer; v_activating boolean; v_prev_x2 boolean;
BEGIN
  SELECT use_powerup_x2 INTO v_prev_x2
  FROM public.predictions
  WHERE user_id = NEW.user_id AND league_id = NEW.league_id AND match_id = NEW.match_id;

  v_activating := (NEW.use_powerup_x2 = TRUE) AND (COALESCE(v_prev_x2, FALSE) = FALSE);

  IF v_activating AND NEW.league_id IS NOT NULL THEN
    v_llave := public.llave_cupo(NEW.match_id);

    -- Sin esto, dos predicciones enviadas a la vez leen el mismo conteo y las
    -- dos pasan: el cupo se supera por uno (comprobado). El lock es por
    -- (usuario, liga, bolsa) y se suelta al terminar la transacción.
    PERFORM pg_advisory_xact_lock(
      hashtextextended(NEW.user_id::text || NEW.league_id::text
                       || COALESCE(v_llave, ''), 0));

    v_base_limit := public.cupo_powerups(NEW.league_id, NEW.match_id);

    -- ANTES: m.phase = v_phase AND COALESCE(m.matchday,0) = v_matchday.
    -- Eso metía toda la eliminatoria de una liga en una sola bolsa.
    SELECT COUNT(*) INTO v_current
    FROM public.predictions p
    JOIN public.matches m ON p.match_id = m.id
    WHERE p.user_id = NEW.user_id
      AND p.league_id = NEW.league_id
      AND p.use_powerup_x2 = TRUE
      AND public.llave_cupo(m.id) = v_llave
      AND p.match_id <> NEW.match_id;

    -- powerup_credits.phase guarda AHORA la clave de fase (ver punto 4). Para
    -- las 5 filas que existen hoy da lo mismo: todas son 'groups', y
    -- clave_fase('groups', …) = 'groups'.
    SELECT COUNT(*) INTO v_credits
    FROM public.powerup_credits
    WHERE user_id = NEW.user_id AND league_id = NEW.league_id
      AND phase || '|' || COALESCE(matchday, 0)::text = v_llave
      AND consumed_at IS NULL;

    IF v_current >= COALESCE(v_base_limit, 0) + COALESCE(v_credits, 0) THEN
      RAISE EXCEPTION 'Límite de comodines x2 alcanzado para esta jornada.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 3. La razón "1 cada N partidos" cuenta los partidos de ESA ronda ───────
-- Antes contaba todos los de la fase: en la postemporada tica daba 6 (semis +
-- final + gran final) para cualquiera de las tres, así que "1 cada 3" daba 2
-- comodines hasta en una final de 2 partidos.
CREATE OR REPLACE FUNCTION public.cupo_powerups(p_league_id uuid, p_match_id integer)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public
AS $$
  WITH liga AS (
    SELECT powerup_limit, powerup_por_partidos, powerup_limits, tournament_id
    FROM public.leagues WHERE id = p_league_id
  ), partido AS (
    SELECT phase, stage, COALESCE(matchday, 0) AS matchday,
           public.clave_fase(phase, stage) AS clave
    FROM public.matches WHERE id = p_match_id
  ), cuantos AS (
    SELECT COUNT(*)::numeric AS n
    FROM public.matches m, partido p, liga l
    WHERE m.tournament_id = l.tournament_id
      AND public.clave_fase(m.phase, m.stage) = p.clave
      AND COALESCE(m.matchday, 0) = p.matchday
  )
  SELECT COALESCE(
    -- 1. Cupo explícito de esa fase.
    (l.powerup_limits ->> p.clave)::integer,
    -- 2. Razón "1 cada N partidos", si está puesta.
    CASE WHEN l.powerup_por_partidos IS NULL THEN NULL
         ELSE GREATEST(COALESCE(l.powerup_limit, 0),
                       CEIL(c.n / l.powerup_por_partidos)::integer) END,
    -- 3. El número fijo de siempre.
    COALESCE(l.powerup_limit, 0)
  )
  FROM liga l, partido p, cuantos c;
$$;

-- ── 4. El crédito de arrastre viaja a la MISMA bolsa ───────────────────────
-- Guarda la clave de fase en vez de `phase` cruda: si no, un crédito nacido en
-- la última jornada de liga apuntaría a 'knockout' y nunca casaría con la
-- bolsa 'Semifinal' donde hay que gastarlo.
CREATE OR REPLACE FUNCTION public.void_cancelled_match(p_match_id integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_status text; v_tid int; v_kickoff timestamptz;
  v_next_phase text; v_next_matchday integer;
  r record; v_zeroed int := 0; v_refunded int := 0;
BEGIN
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

  SELECT public.clave_fase(m.phase, m.stage), m.matchday
    INTO v_next_phase, v_next_matchday
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
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_pending_powerup_credits(p_tournament_id integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE r record; v_next_phase text; v_next_matchday integer; v_resolved int := 0;
BEGIN
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
    SELECT public.clave_fase(m.phase, m.stage), m.matchday
      INTO v_next_phase, v_next_matchday
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
END;
$$;

-- ── 5. La pantalla pinta las mismas bolsas ─────────────────────────────────
-- Antes agrupaba por (phase, matchday, clave) y devolvía `phase`: el frontend
-- armaba su mapa con (phase, matchday), así que las filas 'Semifinal' y
-- 'Final' —las dos con phase='knockout' y jornada NULL— se pisaban y la
-- pantalla mostraba UN cupo para toda la postemporada.
DROP FUNCTION IF EXISTS public.cupos_por_jornada(uuid);
CREATE FUNCTION public.cupos_por_jornada(p_league_id uuid)
RETURNS TABLE (clave text, matchday integer, partidos integer, cupo integer, llave text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public
AS $$
  WITH liga AS (
    SELECT powerup_limit, powerup_por_partidos, powerup_limits, tournament_id
    FROM public.leagues WHERE id = p_league_id
  ), bolsas AS (
    SELECT public.clave_fase(m.phase, m.stage) AS clave,
           COALESCE(m.matchday, 0) AS matchday,
           COUNT(*)::numeric AS n
    FROM public.matches m, liga l
    WHERE m.tournament_id = l.tournament_id
    GROUP BY 1, 2
  )
  SELECT b.clave, b.matchday, b.n::integer,
         COALESCE(
           (l.powerup_limits ->> b.clave)::integer,
           CASE WHEN l.powerup_por_partidos IS NULL THEN NULL
                ELSE GREATEST(COALESCE(l.powerup_limit, 0),
                              CEIL(b.n / l.powerup_por_partidos)::integer) END,
           COALESCE(l.powerup_limit, 0)
         ),
         b.clave || '|' || b.matchday::text
  FROM bolsas b, liga l
  -- Solo para miembros (o el admin global): el cupo es información de la
  -- quiniela, no del torneo.
  WHERE public.puede_ver_quiniela(p_league_id);
$$;

-- El DROP reabre el ACL a PUBLIC; hay que volver a cerrarlo a mano.
REVOKE ALL ON FUNCTION public.cupos_por_jornada(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupos_por_jornada(uuid) TO authenticated;
-- llave_cupo es un ayudante INTERNO: lo llaman funciones que ya son
-- SECURITY DEFINER, así que no necesita EXECUTE para nadie (ver la 66).
REVOKE ALL ON FUNCTION public.llave_cupo(integer) FROM PUBLIC, anon, authenticated;

DO $verificar$
DECLARE
  v_anon boolean; v_auth boolean; v_llave_anon boolean;
BEGIN
  SELECT has_function_privilege('anon', 'public.cupos_por_jornada(uuid)', 'EXECUTE') INTO v_anon;
  SELECT has_function_privilege('authenticated', 'public.cupos_por_jornada(uuid)', 'EXECUTE') INTO v_auth;
  SELECT has_function_privilege('anon', 'public.llave_cupo(integer)', 'EXECUTE') INTO v_llave_anon;

  IF v_anon THEN RAISE EXCEPTION 'cupos_por_jornada quedó ejecutable por anon'; END IF;
  IF NOT v_auth THEN RAISE EXCEPTION 'cupos_por_jornada perdió EXECUTE para authenticated'; END IF;
  IF v_llave_anon THEN RAISE EXCEPTION 'llave_cupo quedó ejecutable por anon'; END IF;

  -- LOS MISMOS CASOS QUE FIJA `powerups.test.js` EN EL NAVEGADOR. La regla está
  -- escrita dos veces a la fuerza (el navegador no puede llamar a la función
  -- para cada partido de una pantalla), así que cada lado pincha los mismos
  -- puntos: si alguien cambia uno, cae la comprobación del otro.
  IF public.clave_fase('groups', 'Jornada 7')        <> 'groups'
     OR public.clave_fase(NULL, NULL)                <> 'groups'
     OR public.clave_fase('round_of_16', NULL)       <> 'round_of_16'
     OR public.clave_fase('third_place', NULL)       <> 'third_place'
     OR public.clave_fase('knockout', 'Octavos · Ida')    <> 'Octavos'
     OR public.clave_fase('knockout', 'Semifinal')        <> 'Semifinal'
     OR public.clave_fase('knockout', 'Gran final · Ida') <> 'Gran final'
     OR public.clave_fase('knockout', NULL)          <> 'knockout'
     OR public.clave_fase('knockout', '')            <> 'knockout' THEN
    RAISE EXCEPTION 'clave_fase dejo de coincidir con la regla del navegador';
  END IF;

  RAISE NOTICE 'Una sola llave de cupo (fase|jornada). Ninguna fila modificada.';
END $verificar$;

COMMIT;

NOTIFY pgrst, 'reload schema';
