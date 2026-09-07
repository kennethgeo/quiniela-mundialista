-- =============================================================================
-- 72_cupos_por_fase_configurables.sql
-- Que el cupo de ×2 se pueda fijar por CADA fase, incluidas las que todavía no
-- existen en matches. Solo funciones: no toca ninguna fila.
-- Idempotente.
-- =============================================================================
--
-- DOS PROBLEMAS DISTINTOS, LOS DOS COMPROBADOS CONTRA PRODUCCIÓN.
--
-- 1) EL EDITOR SOLO MUESTRA LO QUE YA EXISTE. `fases_del_torneo` sale de
--    matches, y hoy la Champions y la liga tica solo tienen `groups`: las
--    finales las publica ESPN más adelante. Resultado: no se puede dejar
--    configurado el cupo de octavos ANTES de que empiecen, que es justo
--    cuando hay que decidirlo — después ya es cambiar las reglas en marcha.
--
-- 2) TODAS LAS ELIMINATORIAS COMPARTÍAN UN SOLO CUPO. clave_fase miraba
--    `stage`, que en el Mundial es NULL, así que round_of_32, round_of_16,
--    quarter_finals, semi_finals, third_place y final caían las seis en la
--    clave 'knockout': 32 partidos con un mismo número. O sea que ni
--    configurándolo se podía dar 1 en la final y 3 en los octavos.
--
--    Ojo: el trigger que VALIDA ya contaba por (phase, matchday), o sea por
--    fase separada. El que colapsaba era el que elegía el NÚMERO. Esta
--    migración alinea las dos cosas.
--
-- NO HAY QUE MIGRAR DATOS: hoy las tres quinielas tienen powerup_limits = {}
-- (comprobado), así que nadie tenía guardada la clave 'knockout'. Y el único
-- torneo con fases eliminatorias cargadas —Mundial 2026— está finished.

-- ── 1. La clave de cupo sale de `phase` cuando la fase es específica ────────
CREATE OR REPLACE FUNCTION public.clave_fase(p_phase text, p_stage text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO pg_catalog, public
AS $$
  SELECT CASE
    WHEN COALESCE(p_phase, 'groups') = 'groups' THEN 'groups'
    -- 'knockout' es el comodín que pone espn_tournament_sync cuando la fase
    -- viene solo en el texto: ahí sí manda `stage`, recortado en ' · ' porque
    -- el cupo es de la RONDA, no de cada partido ('Octavos · Ida' -> 'Octavos').
    WHEN p_phase = 'knockout'
      THEN COALESCE(NULLIF(split_part(COALESCE(p_stage, ''), ' · ', 1), ''), 'knockout')
    -- Cualquier otra fase (round_of_16, semi_finals, final…) es su propia
    -- clave. Viene del sync y es estable; no depende de cómo ESPN escriba el
    -- texto, que cambia entre torneos e idiomas.
    ELSE p_phase
  END;
$$;

-- ── 2. El editor ve también las fases que aún no existen ───────────────────
-- Devuelve las fases con partidos MÁS las que ya tengan un cupo guardado,
-- para que una fase configurada por adelantado no desaparezca de la pantalla
-- hasta que ESPN la publique.
DROP FUNCTION IF EXISTS public.fases_del_torneo(uuid);
CREATE FUNCTION public.fases_del_torneo(p_league_id uuid)
RETURNS TABLE(clave text, partidos integer, jornadas integer, existe boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public
AS $$
  WITH permitido AS (
    SELECT public.puede_ver_quiniela(p_league_id) AS ok
  ), reales AS (
    SELECT public.clave_fase(m.phase, m.stage) AS clave,
           COUNT(*)::integer AS partidos,
           COUNT(DISTINCT COALESCE(m.matchday, 0))::integer AS jornadas
    FROM public.matches m
    JOIN public.leagues l ON l.tournament_id = m.tournament_id
    WHERE l.id = p_league_id AND (SELECT ok FROM permitido)
    GROUP BY 1
  ), guardadas AS (
    SELECT e.key AS clave
    FROM public.leagues l, jsonb_each(COALESCE(l.powerup_limits, '{}'::jsonb)) e
    WHERE l.id = p_league_id AND (SELECT ok FROM permitido)
  )
  SELECT COALESCE(r.clave, g.clave),
         COALESCE(r.partidos, 0),
         COALESCE(r.jornadas, 0),
         r.clave IS NOT NULL
  FROM reales r
  FULL OUTER JOIN guardadas g ON g.clave = r.clave
  ORDER BY 4 DESC, 1;
$$;

-- El DROP reabre el ACL a PUBLIC; hay que volver a cerrarlo a mano.
REVOKE ALL ON FUNCTION public.fases_del_torneo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fases_del_torneo(uuid) TO authenticated;

DO $verificar$
DECLARE
  v_anon boolean;
  v_auth boolean;
  v_colapsa integer;
BEGIN
  SELECT has_function_privilege('anon', 'public.fases_del_torneo(uuid)', 'EXECUTE') INTO v_anon;
  SELECT has_function_privilege('authenticated', 'public.fases_del_torneo(uuid)', 'EXECUTE') INTO v_auth;

  -- Ninguna fase eliminatoria específica puede seguir cayendo en 'knockout'.
  SELECT count(DISTINCT phase) INTO v_colapsa
  FROM public.matches
  WHERE phase NOT IN ('groups', 'knockout')
    AND public.clave_fase(phase, stage) = 'knockout';

  IF v_anon THEN RAISE EXCEPTION 'fases_del_torneo quedó ejecutable por anon'; END IF;
  IF NOT v_auth THEN RAISE EXCEPTION 'fases_del_torneo perdió EXECUTE para authenticated'; END IF;
  IF v_colapsa > 0 THEN
    RAISE EXCEPTION '% fases eliminatorias siguen compartiendo la clave knockout', v_colapsa;
  END IF;

  RAISE NOTICE 'Cupos por fase: cada eliminatoria tiene su clave y el editor ve las fases guardadas. Ninguna fila modificada.';
END $verificar$;

NOTIFY pgrst, 'reload schema';
