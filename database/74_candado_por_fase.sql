-- =============================================================================
-- 74_candado_por_fase.sql
-- El cupo de ×2 por fase se podía configurar SOLO antes de que el torneo
-- empezara, o sea nunca cuando hace falta. El candado pasa a ser POR FASE.
-- Solo funciones: no toca ninguna fila. Idempotente.
-- =============================================================================
--
-- EL PROBLEMA, MEDIDO EN PRODUCCIÓN:
--
--   Bundestica (liga tica)  inició el 2026-07-24  -> editor BLOQUEADO,
--                                                    con 55 partidos por jugar
--                                                    y toda la postemporada.
--   Champions 26-27         inicia el 2026-09-08  -> se bloquea mañana.
--
-- O sea que la pantalla de cupos por fase (migraciones 68 y 72) nace inútil en
-- los dos torneos para los que se hizo: `set_powerup_limits` rechazaba
-- cualquier cambio si `group_tournament_started` era cierto, y esa función
-- mira el PRIMER partido del torneo. Los octavos de la Champions se publican
-- en enero; para entonces hace cuatro meses que no se puede tocar nada.
--
-- POR QUÉ EL CANDADO EXISTE Y POR QUÉ ESTE CAMBIO NO LO AFLOJA. La regla del
-- grupo es que el puntaje no se cambia con el torneo en marcha sin votación:
-- en una quiniela por plata, cambiar cuánto vale algo cuando ya se sabe cómo
-- va la tabla es hacer trampa. Pero fijar el cupo de una fase QUE TODAVÍA NO
-- EMPEZÓ no es cambiar las reglas en marcha: nadie predijo nada ahí, ninguna
-- predicción existente cambia de valor, y es el único momento en que se puede
-- decidir. Lo que sí sigue prohibido —y ahora se comprueba fase por fase— es
-- tocar el cupo de una fase YA EMPEZADA.
--
-- Se comprueba en el servidor, no solo en la pantalla: la RPC es la que manda.

BEGIN;

-- ── 1. ¿Empezó ya una fase? ───────────────────────────────────────────────
-- Una fase sin partidos NO empezó (es justo la que hay que poder configurar
-- por adelantado). Se mira el primer saque de la bolsa, no el del torneo.
CREATE OR REPLACE FUNCTION public.fase_ya_empezo(p_league_id uuid, p_clave text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT COALESCE(
    (SELECT MIN(m.kickoff_at) <= now()
     FROM public.matches m
     JOIN public.leagues l ON l.id = p_league_id
     WHERE m.tournament_id = l.tournament_id
       AND public.clave_fase(m.phase, m.stage) = p_clave),
    false);
$$;

COMMENT ON FUNCTION public.fase_ya_empezo(uuid, text) IS
  'Si la fase ya arrancó, su cupo de ×2 queda bloqueado. Una fase sin partidos '
  'no empezó: es la que hay que poder configurar por adelantado.';

-- ── 2. El editor sabe qué filas puede tocar ───────────────────────────────
DROP FUNCTION IF EXISTS public.fases_del_torneo(uuid);
CREATE FUNCTION public.fases_del_torneo(p_league_id uuid)
RETURNS TABLE(clave text, partidos integer, jornadas integer,
              existe boolean, empezo boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public
AS $$
  WITH permitido AS (
    SELECT public.puede_ver_quiniela(p_league_id) AS ok
  ), reales AS (
    SELECT public.clave_fase(m.phase, m.stage) AS clave,
           COUNT(*)::integer AS partidos,
           COUNT(DISTINCT COALESCE(m.matchday, 0))::integer AS jornadas,
           MIN(m.kickoff_at) <= now() AS empezo
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
         r.clave IS NOT NULL,
         COALESCE(r.empezo, false)
  FROM reales r
  FULL OUTER JOIN guardadas g ON g.clave = r.clave
  ORDER BY 4 DESC, 1;
$$;

REVOKE ALL ON FUNCTION public.fases_del_torneo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fases_del_torneo(uuid) TO authenticated;

-- ── 3. Guardar comprueba FASE POR FASE, no el torneo entero ───────────────
CREATE OR REPLACE FUNCTION public.set_powerup_limits(p_league_id uuid, p_limits jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_antes jsonb;
  v_clave text;
  v_bloqueadas text[] := '{}';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT public.es_admin_liga(p_league_id, v_uid) THEN
    RAISE EXCEPTION 'Solo un administrador puede editar las reglas';
  END IF;
  IF p_limits IS NULL OR jsonb_typeof(p_limits) <> 'object' THEN
    RAISE EXCEPTION 'Los cupos por fase deben venir como objeto';
  END IF;

  SELECT COALESCE(powerup_limits, '{}'::jsonb) INTO v_antes
  FROM public.leagues WHERE id = p_league_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quiniela no encontrada'; END IF;

  -- Solo importan las claves que CAMBIAN. Reenviar el mismo valor de una fase
  -- ya empezada no es un cambio y no se rechaza: si no, el editor no podría
  -- guardar la fase nueva sin borrar antes las viejas.
  FOR v_clave IN
    SELECT k FROM (
      SELECT jsonb_object_keys(v_antes) AS k
      UNION
      SELECT jsonb_object_keys(p_limits)
    ) t
    WHERE (v_antes -> k) IS DISTINCT FROM (p_limits -> k)
  LOOP
    IF public.fase_ya_empezo(p_league_id, v_clave) THEN
      v_bloqueadas := v_bloqueadas || v_clave;
    END IF;
  END LOOP;

  IF array_length(v_bloqueadas, 1) > 0 THEN
    RAISE EXCEPTION
      'Esa fase ya empezó y su cupo no se puede cambiar: %. '
      'Para cambiarlo, propone el cambio y el grupo lo vota.',
      array_to_string(v_bloqueadas, ', ');
  END IF;

  UPDATE public.leagues SET powerup_limits = p_limits WHERE id = p_league_id;
END; $$;

-- `fase_ya_empezo` es un ayudante INTERNO: la llama `set_powerup_limits`, que
-- es SECURITY DEFINER y la ejecuta como su dueño. El editor NO la llama —
-- recibe la columna `empezo` de `fases_del_torneo`—, así que no necesita
-- EXECUTE para nadie y NO va en el inventario de la 61 (mismo caso que
-- `es_admin_global`, migración 66). PostgreSQL la abre a PUBLIC al crearla.
REVOKE ALL ON FUNCTION public.fase_ya_empezo(uuid, text) FROM PUBLIC, anon, authenticated;

DO $verificar$
DECLARE v_anon boolean; v_auth boolean; v_cols text;
BEGIN
  SELECT has_function_privilege('anon', 'public.fases_del_torneo(uuid)', 'EXECUTE') INTO v_anon;
  SELECT has_function_privilege('authenticated', 'public.fases_del_torneo(uuid)', 'EXECUTE') INTO v_auth;
  IF v_anon THEN RAISE EXCEPTION 'fases_del_torneo quedo ejecutable por anon'; END IF;
  IF NOT v_auth THEN RAISE EXCEPTION 'fases_del_torneo perdio EXECUTE para authenticated'; END IF;

  SELECT has_function_privilege('anon', 'public.fase_ya_empezo(uuid,text)', 'EXECUTE') INTO v_anon;
  IF v_anon THEN RAISE EXCEPTION 'fase_ya_empezo quedo ejecutable por anon'; END IF;

  SELECT pg_get_function_result(p.oid) INTO v_cols
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'fases_del_torneo';
  IF v_cols NOT LIKE '%empezo boolean%' THEN
    RAISE EXCEPTION 'fases_del_torneo no devuelve la columna empezo';
  END IF;

  RAISE NOTICE 'Candado por fase. Ninguna fila modificada.';
END $verificar$;

COMMIT;

NOTIFY pgrst, 'reload schema';
