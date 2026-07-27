-- =============================================================================
-- 50_powerup_credit_pending_fix.sql  ·  Arreglo: crédito de arrastre "perdido"
-- =============================================================================
-- Bug real: void_cancelled_match calculaba la "próxima jornada" en el momento
-- exacto de la cancelación. Si esa jornada TODAVÍA no estaba cargada en la BD
-- (el sync trae partidos por ventanas, no toda la temporada de una), la
-- función no encontraba ninguna jornada futura y NO otorgaba ningún crédito —
-- en silencio, sin avisar. Resultado: la gente que usó el ×2 en un partido
-- cancelado se quedaba sin el crédito que le correspondía.
--
-- Fix: si no hay jornada siguiente todavía, se otorga un crédito PENDIENTE
-- (phase/matchday NULL). Un resolver le asigna la jornada en cuanto ESPN la
-- carga; se llama automáticamente después de cada sync de torneo y también
-- de forma perezosa cada vez que el front pide sus créditos.
-- Idempotente.
-- =============================================================================

ALTER TABLE public.powerup_credits ALTER COLUMN phase DROP NOT NULL;

-- void_cancelled_match: otorgar SIEMPRE el crédito (pendiente si hace falta).
CREATE OR REPLACE FUNCTION public.void_cancelled_match(p_match_id integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status text; v_tid int; v_kickoff timestamptz;
  v_next_phase text; v_next_matchday integer;
  r record; v_zeroed int := 0; v_refunded int := 0;
BEGIN
  IF auth.uid() IS NOT NULL
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

  -- Próximo partido cronológico YA CARGADO (puede no existir todavía).
  SELECT m.phase, m.matchday INTO v_next_phase, v_next_matchday
  FROM public.matches m
  WHERE m.tournament_id = v_tid
    AND m.kickoff_at > v_kickoff
    AND m.status NOT IN ('cancelled', 'postponed')
  ORDER BY m.kickoff_at ASC
  LIMIT 1;

  FOR r IN
    SELECT id, user_id, league_id, points_earned, use_powerup_x2
    FROM public.predictions WHERE match_id = p_match_id
  LOOP
    IF COALESCE(r.points_earned, 0) <> 0 THEN v_zeroed := v_zeroed + 1; END IF;
    IF r.use_powerup_x2 THEN v_refunded := v_refunded + 1; END IF;

    IF COALESCE(r.points_earned, 0) <> 0 OR r.use_powerup_x2 THEN
      UPDATE public.predictions SET points_earned = 0, use_powerup_x2 = false WHERE id = r.id;
    END IF;

    -- Siempre se otorga: con jornada asignada si ya se conoce, o pendiente
    -- (NULL) si todavía no hay fixtures futuros cargados.
    IF r.use_powerup_x2 THEN
      INSERT INTO public.powerup_credits (user_id, league_id, phase, matchday, source_match_id)
      VALUES (r.user_id, r.league_id, v_next_phase, v_next_matchday, p_match_id)
      ON CONFLICT (user_id, league_id, source_match_id) DO NOTHING;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'ok', 'zeroed', v_zeroed, 'refunded', v_refunded,
    'next_phase', v_next_phase, 'next_matchday', v_next_matchday, 'pending', v_next_phase IS NULL
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.void_cancelled_match(integer) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Resolver: le asigna jornada/fase a los créditos pendientes de un torneo, en
-- cuanto haya fixtures futuros cargados después del partido que los originó.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_pending_powerup_credits(p_tournament_id integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_next_phase text; v_next_matchday integer; v_resolved int := 0;
BEGIN
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
    ORDER BY m.kickoff_at ASC
    LIMIT 1;

    IF v_next_phase IS NOT NULL THEN
      UPDATE public.powerup_credits SET phase = v_next_phase, matchday = v_next_matchday WHERE id = r.id;
      v_resolved := v_resolved + 1;
    END IF;
  END LOOP;
  RETURN v_resolved;
END;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_pending_powerup_credits(integer) TO authenticated, service_role;

-- Lectura: resuelve pendientes de paso (self-heal perezoso) y solo devuelve
-- los ya asignados (los pendientes no se pueden usar todavía de todas formas).
CREATE OR REPLACE FUNCTION public.my_powerup_credits(p_league_id uuid)
RETURNS TABLE (phase text, matchday integer, credits integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tid integer;
BEGIN
  SELECT tournament_id INTO v_tid FROM public.leagues WHERE id = p_league_id;
  IF v_tid IS NOT NULL THEN
    PERFORM public.resolve_pending_powerup_credits(v_tid);
  END IF;
  RETURN QUERY
    SELECT pc.phase, pc.matchday, count(*)::int
    FROM public.powerup_credits pc
    WHERE pc.user_id = auth.uid() AND pc.league_id = p_league_id
      AND pc.consumed_at IS NULL AND pc.phase IS NOT NULL
    GROUP BY pc.phase, pc.matchday;
END;
$$;
GRANT EXECUTE ON FUNCTION public.my_powerup_credits(uuid) TO authenticated;

-- Resolver los pendientes que ya existan ahora mismo (backfill).
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT DISTINCT tournament_id FROM public.leagues LOOP
    PERFORM public.resolve_pending_powerup_credits(t.tournament_id);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
