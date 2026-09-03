-- ============================================================================
-- 67. El cupo de comodines ×2 puede escalar con el tamaño de la jornada
-- ============================================================================
--
-- EL PROBLEMA: `leagues.powerup_limit` es UN número por quiniela, y se aplica
-- por (fase, jornada). Con la liga tica —unos 5 partidos por jornada— un cupo
-- de 2 es razonable. En la fase de liga de la Champions son 18 partidos por
-- jornada, y ese mismo 2 se vuelve casi nada. En una final de 1 partido, 2
-- comodines es no tener límite.
--
-- LA SOLUCIÓN: una razón opcional, "1 comodín cada N partidos", que se calcula
-- sobre los partidos que de verdad tiene esa jornada.
--
--   cupo = GREATEST(powerup_limit, CEIL(partidos / powerup_por_partidos))
--
-- Con powerup_por_partidos = 6 y powerup_limit = 1:
--   liga tica (5 partidos)      -> 1
--   Champions fase liga (18)    -> 3
--   octavos, ida (8)            -> 2
--   cuartos, ida (4)            -> 1
--   final (1)                   -> 1
--
-- COMPATIBLE HACIA ATRÁS: la columna nace NULL y con NULL el cupo es
-- exactamente `powerup_limit`, igual que hoy. Ninguna quiniela cambia de
-- comportamiento hasta que su admin ponga la razón.
--
-- UNA SOLA FÓRMULA: `cupo_powerups()` es la única definición. La usa el
-- trigger que valida Y la consulta el frontend para pintar "quedan N". Este
-- repo ya vivió el problema de la fórmula escrita dos veces (los puntos de
-- asistidor se olvidaron en una de las dos copias durante meses), así que acá
-- no se duplica ni para mostrar.
-- ============================================================================

BEGIN;

ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS powerup_por_partidos integer;

COMMENT ON COLUMN public.leagues.powerup_por_partidos IS
  '1 comodín ×2 por cada N partidos de la jornada. NULL = cupo fijo (powerup_limit).';

-- Sin tope no hay límite, y un 0 sería una división por cero.
ALTER TABLE public.leagues DROP CONSTRAINT IF EXISTS leagues_powerup_por_partidos_ck;
ALTER TABLE public.leagues ADD CONSTRAINT leagues_powerup_por_partidos_ck
  CHECK (powerup_por_partidos IS NULL OR powerup_por_partidos BETWEEN 1 AND 50);

-- ── La única fórmula del cupo ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cupo_powerups(p_league_id uuid, p_match_id integer)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH liga AS (
    SELECT powerup_limit, powerup_por_partidos, tournament_id
    FROM public.leagues WHERE id = p_league_id
  ), partido AS (
    SELECT phase, COALESCE(matchday, 0) AS matchday, tournament_id
    FROM public.matches WHERE id = p_match_id
  ), cuantos AS (
    -- Los partidos de ESA jornada, en el torneo de la quiniela. Se cuentan los
    -- cancelados también: el cupo se reparte al planear la jornada, no después.
    SELECT COUNT(*)::numeric AS n
    FROM public.matches m, partido p, liga l
    WHERE m.tournament_id = l.tournament_id
      AND m.phase IS NOT DISTINCT FROM p.phase
      AND COALESCE(m.matchday, 0) = p.matchday
  )
  SELECT GREATEST(
           COALESCE(l.powerup_limit, 0),
           CASE
             WHEN l.powerup_por_partidos IS NULL THEN 0
             ELSE CEIL(c.n / l.powerup_por_partidos)::integer
           END
         )
  FROM liga l, cuantos c;
$$;

COMMENT ON FUNCTION public.cupo_powerups(uuid, integer) IS
  'Cupo de comodines ×2 de una persona en la jornada de ese partido. Única fórmula: la usa el trigger y la consulta el frontend.';

-- ── El trigger pasa a usarla ────────────────────────────────────────────────
-- CREATE OR REPLACE (no DROP + CREATE): DROP reabriría el ACL a PUBLIC, y esta
-- función quedó endurecida en la migración 61.
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

    -- ÚNICO CAMBIO respecto de la 61: el cupo sale de cupo_powerups() en vez
    -- de leerse directo de leagues.powerup_limit.
    v_base_limit := public.cupo_powerups(NEW.league_id, NEW.match_id);

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

  RETURN NEW;
END;
$$;

-- ── Lo que el frontend consulta ─────────────────────────────────────────────
-- Una sola llamada devuelve el cupo de TODAS las jornadas del torneo de esa
-- quiniela. Pedirlo partido por partido sería una consulta por tarjeta.
CREATE OR REPLACE FUNCTION public.cupos_por_jornada(p_league_id uuid)
RETURNS TABLE (phase text, matchday integer, partidos integer, cupo integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH liga AS (
    SELECT powerup_limit, powerup_por_partidos, tournament_id
    FROM public.leagues WHERE id = p_league_id
  ), jornadas AS (
    SELECT m.phase, COALESCE(m.matchday, 0) AS matchday, COUNT(*)::numeric AS n
    FROM public.matches m, liga l
    WHERE m.tournament_id = l.tournament_id
    GROUP BY 1, 2
  )
  SELECT j.phase, j.matchday, j.n::integer,
         GREATEST(
           COALESCE(l.powerup_limit, 0),
           CASE WHEN l.powerup_por_partidos IS NULL THEN 0
                ELSE CEIL(j.n / l.powerup_por_partidos)::integer END
         )
  FROM jornadas j, liga l
  -- Solo para miembros (o el admin global): el cupo es información de la
  -- quiniela, no del torneo.
  WHERE public.puede_ver_quiniela(p_league_id);
$$;

-- ── Que el admin pueda guardarlo desde Reglas ───────────────────────────────
-- set_group_scoring tiene parámetros fijos, así que agregar uno obliga a
-- DROP + CREATE: CREATE OR REPLACE no puede cambiar la firma, y dejar las dos
-- versiones haría ambigua la llamada desde PostgREST.
--
-- OJO: DROP + CREATE REABRE EL ACL A PUBLIC (comprobado, documentado en la
-- migración 66). Por eso abajo se revoca y se re-otorga a mano. Esta función
-- ya está en el inventario de la 61, así que no hay que agregarla.
DROP FUNCTION IF EXISTS public.set_group_scoring(uuid, int, int, int, int, int, int);

CREATE FUNCTION public.set_group_scoring(
  p_league_id uuid, p_points_exact int, p_points_correct int,
  p_champion_points int, p_scorer_points int, p_powerup_limit int,
  p_assist_points int DEFAULT NULL,
  p_powerup_por_partidos int DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT public.es_admin_liga(p_league_id, v_uid) THEN
    RAISE EXCEPTION 'Solo un administrador puede editar las reglas';
  END IF;
  IF public.group_tournament_started(p_league_id) THEN
    RAISE EXCEPTION 'El torneo ya inició: el puntaje queda bloqueado (los cambios se someten a votación).';
  END IF;
  UPDATE public.leagues SET
    points_exact    = GREATEST(0, COALESCE(p_points_exact, points_exact)),
    points_correct  = GREATEST(0, COALESCE(p_points_correct, points_correct)),
    champion_points = GREATEST(0, COALESCE(p_champion_points, champion_points)),
    scorer_points   = GREATEST(0, COALESCE(p_scorer_points, scorer_points)),
    assist_points   = GREATEST(0, COALESCE(p_assist_points, assist_points)),
    powerup_limit   = GREATEST(0, COALESCE(p_powerup_limit, powerup_limit)),
    -- Este SÍ se puede volver a NULL a propósito: NULL significa "cupo fijo",
    -- así que un COALESCE con el valor viejo impediría desactivarlo.
    powerup_por_partidos = p_powerup_por_partidos
  WHERE id = p_league_id;
END; $$;

REVOKE ALL ON FUNCTION public.set_group_scoring(uuid, int, int, int, int, int, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_group_scoring(uuid, int, int, int, int, int, int, int) TO authenticated;

REVOKE ALL ON FUNCTION public.cupo_powerups(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cupos_por_jornada(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupos_por_jornada(uuid) TO authenticated;
-- cupo_powerups NO se otorga: es interna, la llama el trigger (SECURITY
-- DEFINER, corre como su dueño). Por eso tampoco va al inventario de la 61.

COMMIT;

-- ── Comprobación ────────────────────────────────────────────────────────────
DO $$
DECLARE v_ok boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='leagues'
                   AND column_name='powerup_por_partidos') INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'Falta la columna powerup_por_partidos'; END IF;

  SELECT has_function_privilege('authenticated', 'public.cupos_por_jornada(uuid)', 'EXECUTE') INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'authenticated no puede ejecutar cupos_por_jornada'; END IF;

  SELECT has_function_privilege('anon', 'public.cupos_por_jornada(uuid)', 'EXECUTE') INTO v_ok;
  IF v_ok THEN RAISE EXCEPTION 'anon NO debería poder ejecutar cupos_por_jornada'; END IF;

  SELECT has_function_privilege('authenticated', 'public.cupo_powerups(uuid,integer)', 'EXECUTE') INTO v_ok;
  IF v_ok THEN RAISE EXCEPTION 'authenticated NO debería poder ejecutar cupo_powerups'; END IF;

  SELECT has_function_privilege('anon',
    'public.set_group_scoring(uuid,int,int,int,int,int,int,int)', 'EXECUTE') INTO v_ok;
  IF v_ok THEN RAISE EXCEPTION 'anon quedó con EXECUTE sobre set_group_scoring tras el DROP+CREATE'; END IF;

  RAISE NOTICE 'Migración 67 aplicada. Ninguna quiniela cambia hasta que su admin ponga powerup_por_partidos.';
END $$;
