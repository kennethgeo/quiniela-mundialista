-- ============================================================================
-- 68. Cupo de comodines ×2 editable POR FASE
-- ============================================================================
--
-- POR QUÉ: la migración 67 dejó dos formas de fijar el cupo —un número fijo y
-- una razón "1 cada N partidos"— y ninguna deja decir "en la fase de liga tres,
-- pero en la final uno". Los formatos son muy distintos: la fase de liga de la
-- Champions son 18 partidos por jornada, los octavos son 8 en dos series, y la
-- final es 1. Un solo número no sirve para las tres.
--
-- LA CLAVE DE CADA FASE:
--   'groups'  -> todas las jornadas regulares (una sola entrada las cubre)
--   'Octavos', 'Cuartos', 'Semifinal', 'Final', 'Tercer puesto', ...
--             -> la etiqueta que ya pone el sync en matches.stage
--
-- Se usa la etiqueta y no matches.phase porque phase solo tiene dos valores
-- ('groups' y 'knockout'): con eso no se puede distinguir octavos de la final,
-- que es justo lo que hace falta.
--
-- ORDEN DE RESOLUCIÓN (de más específico a más general):
--   1. powerup_limits[clave de la fase]   <- lo que se agrega acá
--   2. razón "1 cada N partidos"          <- migración 67
--   3. powerup_limit (número fijo)        <- el de siempre
--
-- ANTECEDENTE QUE NO HAY QUE REPETIR: ya existió una tabla powerup_limits por
-- fase y se quitó en la migración 48 porque el panel guardaba, decía "listo" y
-- NO cambiaba el límite que se aplicaba de verdad. Acá el valor entra en
-- cupo_powerups(), que es la función que usa el trigger, así que lo que se
-- guarda es lo que se aplica.
-- ============================================================================

BEGIN;

ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS powerup_limits jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.leagues.powerup_limits IS
  'Cupo de ×2 por fase: {"groups":3,"Octavos":2,"Final":1}. Vacío = usar la razón o el número fijo.';

-- Sin esto, un valor de texto o negativo entraría y reventaría al leerlo.
-- Va en una función porque un CHECK no admite subconsultas, y recorrer las
-- claves del jsonb necesita una.
CREATE OR REPLACE FUNCTION public.powerup_limits_valido(p jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(p) = 'object' AND NOT EXISTS (
    SELECT 1 FROM jsonb_each(p) e
    WHERE jsonb_typeof(e.value) <> 'number'
       OR (e.value)::numeric < 0
       OR (e.value)::numeric > 99
  );
$$;

ALTER TABLE public.leagues DROP CONSTRAINT IF EXISTS leagues_powerup_limits_ck;
ALTER TABLE public.leagues ADD CONSTRAINT leagues_powerup_limits_ck
  CHECK (public.powerup_limits_valido(powerup_limits));

-- ── La clave de fase de un partido ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.clave_fase(p_phase text, p_stage text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN COALESCE(p_phase, 'groups') = 'groups' THEN 'groups'
    -- 'Octavos · Ida' -> 'Octavos': el cupo es de la ronda, no de cada partido.
    ELSE COALESCE(NULLIF(split_part(COALESCE(p_stage, ''), ' · ', 1), ''), 'knockout')
  END;
$$;

COMMENT ON FUNCTION public.clave_fase(text, text) IS
  'Clave con la que se busca el cupo por fase. Una sola definición: la usan cupo_powerups y cupos_por_jornada.';

-- ── cupo_powerups pasa a mirar primero el cupo por fase ─────────────────────
CREATE OR REPLACE FUNCTION public.cupo_powerups(p_league_id uuid, p_match_id integer)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH liga AS (
    SELECT powerup_limit, powerup_por_partidos, powerup_limits, tournament_id
    FROM public.leagues WHERE id = p_league_id
  ), partido AS (
    SELECT phase, stage, COALESCE(matchday, 0) AS matchday
    FROM public.matches WHERE id = p_match_id
  ), cuantos AS (
    SELECT COUNT(*)::numeric AS n
    FROM public.matches m, partido p, liga l
    WHERE m.tournament_id = l.tournament_id
      AND m.phase IS NOT DISTINCT FROM p.phase
      AND COALESCE(m.matchday, 0) = p.matchday
  )
  SELECT COALESCE(
    -- 1. Cupo explícito de esa fase.
    (l.powerup_limits ->> public.clave_fase(p.phase, p.stage))::integer,
    -- 2. Razón "1 cada N partidos", si está puesta.
    CASE WHEN l.powerup_por_partidos IS NULL THEN NULL
         ELSE GREATEST(COALESCE(l.powerup_limit, 0),
                       CEIL(c.n / l.powerup_por_partidos)::integer) END,
    -- 3. El número fijo de siempre.
    COALESCE(l.powerup_limit, 0)
  )
  FROM liga l, partido p, cuantos c;
$$;

-- ── Y lo mismo para lo que consulta el frontend ─────────────────────────────
-- Devuelve una columna más (la clave de la fase), y eso cambia el tipo de
-- retorno: CREATE OR REPLACE no puede, hay que soltarla antes. Eso REABRE su
-- ACL a PUBLIC, y por eso más abajo se revoca y se re-otorga explícitamente.
DROP FUNCTION IF EXISTS public.cupos_por_jornada(uuid);

CREATE FUNCTION public.cupos_por_jornada(p_league_id uuid)
RETURNS TABLE (phase text, matchday integer, partidos integer, cupo integer, clave text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH liga AS (
    SELECT powerup_limit, powerup_por_partidos, powerup_limits, tournament_id
    FROM public.leagues WHERE id = p_league_id
  ), jornadas AS (
    SELECT m.phase, COALESCE(m.matchday, 0) AS matchday,
           public.clave_fase(m.phase, m.stage) AS clave, COUNT(*)::numeric AS n
    FROM public.matches m, liga l
    WHERE m.tournament_id = l.tournament_id
    GROUP BY 1, 2, 3
  )
  SELECT j.phase, j.matchday, j.n::integer,
         COALESCE(
           (l.powerup_limits ->> j.clave)::integer,
           CASE WHEN l.powerup_por_partidos IS NULL THEN NULL
                ELSE GREATEST(COALESCE(l.powerup_limit,0),
                              CEIL(j.n / l.powerup_por_partidos)::integer) END,
           COALESCE(l.powerup_limit, 0)
         ),
         j.clave
  FROM jornadas j, liga l
  WHERE public.puede_ver_quiniela(p_league_id);
$$;

-- ── Guardar los cupos por fase ──────────────────────────────────────────────
-- RPC propia y no otro parámetro en set_group_scoring: esa función ya tuvo que
-- recrearse en la 67 para agregar uno, y cada DROP + CREATE reabre su ACL.
CREATE OR REPLACE FUNCTION public.set_powerup_limits(p_league_id uuid, p_limits jsonb)
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
  IF p_limits IS NULL OR jsonb_typeof(p_limits) <> 'object' THEN
    RAISE EXCEPTION 'Los cupos por fase deben venir como objeto';
  END IF;
  -- La restricción de la tabla valida el contenido; acá solo se guarda.
  UPDATE public.leagues SET powerup_limits = p_limits WHERE id = p_league_id;
END; $$;

-- ── Fases que existen en el torneo de una quiniela ──────────────────────────
-- Para que Reglas muestre solo las que aplican y no una lista inventada.
CREATE OR REPLACE FUNCTION public.fases_del_torneo(p_league_id uuid)
RETURNS TABLE (clave text, partidos integer, jornadas integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.clave_fase(m.phase, m.stage) AS clave,
         COUNT(*)::integer,
         COUNT(DISTINCT COALESCE(m.matchday, 0))::integer
  FROM public.matches m
  JOIN public.leagues l ON l.tournament_id = m.tournament_id
  WHERE l.id = p_league_id AND public.puede_ver_quiniela(p_league_id)
  GROUP BY 1
  ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION public.cupo_powerups(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clave_fase(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.powerup_limits_valido(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cupos_por_jornada(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_powerup_limits(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fases_del_torneo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cupos_por_jornada(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_powerup_limits(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fases_del_torneo(uuid) TO authenticated;
-- clave_fase y cupo_powerups quedan internas: las llaman funciones que ya son
-- SECURITY DEFINER, así que corren como su dueño. Por eso no van al inventario
-- de la migración 61.

COMMIT;

-- ── Comprobación ────────────────────────────────────────────────────────────
DO $$
DECLARE v_ok boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='leagues'
                   AND column_name='powerup_limits') INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'Falta la columna powerup_limits'; END IF;

  IF public.clave_fase('groups', 'Jornada 7') <> 'groups'
     OR public.clave_fase('knockout', 'Octavos · Ida') <> 'Octavos'
     OR public.clave_fase('knockout', 'Final') <> 'Final'
     OR public.clave_fase('knockout', NULL) <> 'knockout' THEN
    RAISE EXCEPTION 'clave_fase no resuelve como se espera';
  END IF;

  FOR v_ok IN SELECT has_function_privilege('authenticated', f, 'EXECUTE')
              FROM unnest(ARRAY['public.cupos_por_jornada(uuid)',
                                'public.set_powerup_limits(uuid,jsonb)',
                                'public.fases_del_torneo(uuid)']) f LOOP
    IF NOT v_ok THEN RAISE EXCEPTION 'authenticated sin EXECUTE en una de las RPC'; END IF;
  END LOOP;

  FOR v_ok IN SELECT has_function_privilege('anon', f, 'EXECUTE')
              FROM unnest(ARRAY['public.cupos_por_jornada(uuid)',
                                'public.set_powerup_limits(uuid,jsonb)',
                                'public.fases_del_torneo(uuid)']) f LOOP
    IF v_ok THEN RAISE EXCEPTION 'anon NO debería poder ejecutar estas RPC'; END IF;
  END LOOP;

  FOR v_ok IN SELECT has_function_privilege('authenticated', f, 'EXECUTE')
              FROM unnest(ARRAY['public.cupo_powerups(uuid,integer)',
                                'public.clave_fase(text,text)',
                                'public.powerup_limits_valido(jsonb)']) f LOOP
    IF v_ok THEN RAISE EXCEPTION 'authenticated NO debería poder ejecutar helpers internos'; END IF;
  END LOOP;

  RAISE NOTICE 'Migración 68 aplicada. Con powerup_limits vacío nada cambia.';
END $$;
