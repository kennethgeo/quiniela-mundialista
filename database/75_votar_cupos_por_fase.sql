-- =============================================================================
-- 75_votar_cupos_por_fase.sql
-- Que una votación aprobada CAMBIE de verdad los cupos de ×2. Hasta ahora
-- decía "aprobada" y no cambiaba nada. Solo funciones: no toca ninguna fila.
-- Idempotente.
-- =============================================================================
--
-- DOS HUECOS EN `_apply_rule_proposal`, LOS DOS SILENCIOSOS.
--
-- 1) `powerup_por_partidos` ("1 comodín cada N partidos", migración 67) SE
--    MANDA en el payload de la propuesta —ScoringConfig lo incluye— pero
--    `_apply_rule_proposal` nunca lo aplicaba. El grupo votaba, la propuesta
--    quedaba 'approved' y la razón seguía igual. Nadie lo habría notado hasta
--    contar comodines.
--
-- 2) `powerup_limits` (cupo por fase, migraciones 68/72/73) no estaba
--    contemplado. Peor todavía: la migración 74 rechaza cambiar el cupo de una
--    fase YA EMPEZADA con el mensaje "propone el cambio y el grupo lo vota"
--    …y esa vía no existía. El mensaje prometía algo imposible.
--
-- ES EL MISMO FALLO POR EL QUE SE QUITÓ LA TABLA `powerup_limits` EN LA
-- MIGRACIÓN 48: guarda, dice "listo" y no cambia el límite aplicado. CLAUDE.md
-- lo tiene anotado como "antecedente que no hay que repetir".
--
-- POR QUÉ LA VOTACIÓN SÍ PUEDE TOCAR UNA FASE EMPEZADA Y EL ADMIN NO: la regla
-- del grupo no es "esto no se cambia nunca", es "esto no lo cambia una persona
-- sola con el torneo en marcha". Una mayoría del grupo sí puede.

BEGIN;

CREATE OR REPLACE FUNCTION public._apply_rule_proposal(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public
AS $$
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
      powerup_limit   = GREATEST(0, COALESCE((r.payload->>'powerup_limit')::int,   powerup_limit)),

      -- NUEVO. Se distingue "no venía en la propuesta" de "venía en null".
      -- `powerup_por_partidos` en null significa "cupo fijo", así que un
      -- COALESCE contra el valor viejo impediría DESACTIVAR la razón por
      -- votación — el mismo cuidado que ya tiene `set_group_scoring`.
      powerup_por_partidos = CASE
        WHEN r.payload ? 'powerup_por_partidos'
          THEN NULLIF((r.payload->>'powerup_por_partidos'), '')::int
        ELSE powerup_por_partidos END,

      -- Cupo por fase. Solo se toca si la propuesta lo trae y es un objeto:
      -- un payload viejo (sin la clave) no debe borrar los cupos guardados.
      -- El contenido lo valida la restricción `powerup_limits_valido` de la
      -- tabla; acá no se repite la regla.
      powerup_limits = CASE
        WHEN r.payload ? 'powerup_limits'
             AND jsonb_typeof(r.payload -> 'powerup_limits') = 'object'
          THEN r.payload -> 'powerup_limits'
        ELSE powerup_limits END
    WHERE id = r.league_id;

  ELSIF r.kind = 'rules' THEN
    UPDATE public.leagues SET rules = btrim(COALESCE(r.payload->>'rules','')) WHERE id = r.league_id;
    UPDATE public.league_members SET rules_accepted_at = NULL
    WHERE league_id = r.league_id AND user_id <> r.proposed_by;
  END IF;
END; $$;

DO $verificar$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = '_apply_rule_proposal';

  IF v_def NOT LIKE '%powerup_limits%' THEN
    RAISE EXCEPTION 'la votacion sigue sin aplicar los cupos por fase';
  END IF;
  IF v_def NOT LIKE '%powerup_por_partidos%' THEN
    RAISE EXCEPTION 'la votacion sigue sin aplicar la razon de comodines';
  END IF;

  -- `_apply_rule_proposal` es INTERNA: la llama `_tally_rule_proposal`, que es
  -- SECURITY DEFINER. Ningún cliente la invoca y no debe poder hacerlo: quien
  -- pudiera llamarla aplicaría una propuesta sin contar los votos.
  IF has_function_privilege('anon', 'public._apply_rule_proposal(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._apply_rule_proposal(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '_apply_rule_proposal quedo ejecutable desde el cliente';
  END IF;

  RAISE NOTICE 'La votacion ya aplica los cupos por fase. Ninguna fila modificada.';
END $verificar$;

COMMIT;

NOTIFY pgrst, 'reload schema';
