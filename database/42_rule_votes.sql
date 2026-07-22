-- =============================================================================
-- 42_rule_votes.sql  ·  Votación de cambios de reglas DURANTE el torneo
-- =============================================================================
-- Una vez iniciado el torneo, el puntaje y las reglas quedan bloqueados
-- (migración 41). Si el admin quiere cambiar algo, abre una PROPUESTA y el
-- grupo la vota. Reglas de la votación:
--   · Propone: solo el admin de la quiniela.
--   · Aprueba: mayoría de TODOS los miembros (yes*2 > total_miembros).
--   · Rechaza: cuando ya es imposible llegar a esa mayoría (no*2 >= total).
--   · Al aprobarse se aplica el cambio de una (de aquí en adelante; si querés
--     re-puntuar lo ya jugado, corré "Recalcular puntajes" en el panel admin).
-- Idempotente.
-- =============================================================================

-- 1) Tablas -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rule_proposals (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  league_id   uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  proposed_by uuid NOT NULL REFERENCES public.users(id)  ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('scoring','rules')),
  payload     jsonb NOT NULL,
  note        text,
  status      text NOT NULL DEFAULT 'open'
              CHECK (status IN ('open','approved','rejected','cancelled')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  closed_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_rule_proposals_league ON public.rule_proposals(league_id);
-- Como mucho UNA propuesta abierta por quiniela a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rule_proposals_one_open
  ON public.rule_proposals(league_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS public.rule_votes (
  proposal_id uuid NOT NULL REFERENCES public.rule_proposals(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  vote        boolean NOT NULL,        -- true = a favor, false = en contra
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (proposal_id, user_id)
);

ALTER TABLE public.rule_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rule_votes     ENABLE ROW LEVEL SECURITY;
-- Todo el acceso va por RPCs SECURITY DEFINER; sin políticas la tabla queda
-- cerrada al rol authenticated (solo el service_role la lee directo).

-- 2) Aplicar una propuesta aprobada (interna) --------------------------------
-- Escribe directo en leagues (los set_group_* están bloqueados post-inicio).
CREATE OR REPLACE FUNCTION public._apply_rule_proposal(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.rule_proposals;
BEGIN
  SELECT * INTO r FROM public.rule_proposals WHERE id = p_id;
  IF r.kind = 'scoring' THEN
    UPDATE public.leagues SET
      points_exact    = GREATEST(0, COALESCE((r.payload->>'points_exact')::int,    points_exact)),
      points_correct  = GREATEST(0, COALESCE((r.payload->>'points_correct')::int,  points_correct)),
      champion_points = GREATEST(0, COALESCE((r.payload->>'champion_points')::int, champion_points)),
      scorer_points   = GREATEST(0, COALESCE((r.payload->>'scorer_points')::int,   scorer_points)),
      powerup_limit   = GREATEST(0, COALESCE((r.payload->>'powerup_limit')::int,   powerup_limit))
    WHERE id = r.league_id;
  ELSIF r.kind = 'rules' THEN
    UPDATE public.leagues SET rules = btrim(COALESCE(r.payload->>'rules','')) WHERE id = r.league_id;
    -- Los demás miembros deben volver a aceptar las reglas nuevas.
    UPDATE public.league_members SET rules_accepted_at = NULL
    WHERE league_id = r.league_id AND user_id <> r.proposed_by;
  END IF;
END; $$;

-- 3) Contar votos y cerrar si ya se decidió (interna) ------------------------
CREATE OR REPLACE FUNCTION public._tally_rule_proposal(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_league uuid;
  v_members int;
  v_yes int;
  v_no int;
BEGIN
  SELECT league_id INTO v_league FROM public.rule_proposals WHERE id = p_id AND status = 'open';
  IF v_league IS NULL THEN RETURN; END IF;   -- ya cerrada o inexistente

  SELECT count(*) INTO v_members FROM public.league_members WHERE league_id = v_league;
  SELECT count(*) FILTER (WHERE vote), count(*) FILTER (WHERE NOT vote)
    INTO v_yes, v_no FROM public.rule_votes WHERE proposal_id = p_id;

  IF v_yes * 2 > v_members THEN
    PERFORM public._apply_rule_proposal(p_id);
    UPDATE public.rule_proposals SET status = 'approved', closed_at = now() WHERE id = p_id;
  ELSIF v_no * 2 >= v_members THEN
    UPDATE public.rule_proposals SET status = 'rejected', closed_at = now() WHERE id = p_id;
  END IF;
END; $$;

-- 4) Proponer un cambio (solo admin, torneo iniciado) ------------------------
CREATE OR REPLACE FUNCTION public.propose_rule_change(
  p_league_id uuid, p_kind text, p_payload jsonb, p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leagues WHERE id = p_league_id AND admin_id = v_uid) THEN
    RAISE EXCEPTION 'Solo el administrador puede proponer cambios';
  END IF;
  IF p_kind NOT IN ('scoring','rules') THEN
    RAISE EXCEPTION 'Tipo de propuesta inválido';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rule_proposals WHERE league_id = p_league_id AND status = 'open') THEN
    RAISE EXCEPTION 'Ya hay una propuesta abierta en esta quiniela';
  END IF;

  INSERT INTO public.rule_proposals (league_id, proposed_by, kind, payload, note)
  VALUES (p_league_id, v_uid, p_kind, p_payload, NULLIF(btrim(COALESCE(p_note,'')), ''))
  RETURNING id INTO v_id;

  -- El proponente vota a favor automáticamente; puede decidir la votación.
  INSERT INTO public.rule_votes (proposal_id, user_id, vote) VALUES (v_id, v_uid, true);
  PERFORM public._tally_rule_proposal(v_id);
  RETURN v_id;
END; $$;

-- 5) Votar (cualquier miembro) -----------------------------------------------
CREATE OR REPLACE FUNCTION public.cast_rule_vote(p_proposal_id uuid, p_vote boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_league uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT league_id INTO v_league FROM public.rule_proposals WHERE id = p_proposal_id AND status = 'open';
  IF v_league IS NULL THEN RAISE EXCEPTION 'La propuesta no está abierta'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.league_members WHERE league_id = v_league AND user_id = v_uid) THEN
    RAISE EXCEPTION 'No sos miembro de esta quiniela';
  END IF;

  INSERT INTO public.rule_votes (proposal_id, user_id, vote)
  VALUES (p_proposal_id, v_uid, p_vote)
  ON CONFLICT (proposal_id, user_id) DO UPDATE SET vote = EXCLUDED.vote, created_at = now();

  PERFORM public._tally_rule_proposal(p_proposal_id);
END; $$;

-- 6) Cancelar una propuesta abierta (solo admin) -----------------------------
CREATE OR REPLACE FUNCTION public.cancel_rule_proposal(p_proposal_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.rule_proposals p JOIN public.leagues l ON l.id = p.league_id
    WHERE p.id = p_proposal_id AND p.status = 'open' AND l.admin_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Solo el administrador puede cancelar la propuesta abierta';
  END IF;
  UPDATE public.rule_proposals SET status = 'cancelled', closed_at = now() WHERE id = p_proposal_id;
END; $$;

-- 7) Listar propuestas de una quiniela (abierta + historial) -----------------
CREATE OR REPLACE FUNCTION public.league_proposals(p_league_id uuid)
RETURNS TABLE (
  id uuid, kind text, payload jsonb, note text, status text,
  created_at timestamptz, closed_at timestamptz,
  proposed_by uuid, proposer_name text,
  members int, yes_count int, no_count int, my_vote boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.league_members
                 WHERE league_id = p_league_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'No sos miembro de esta quiniela';
  END IF;
  RETURN QUERY
    SELECT p.id, p.kind, p.payload, p.note, p.status, p.created_at, p.closed_at,
      p.proposed_by, u.display_name,
      (SELECT count(*)::int FROM public.league_members lm WHERE lm.league_id = p.league_id),
      (SELECT count(*)::int FROM public.rule_votes v WHERE v.proposal_id = p.id AND v.vote),
      (SELECT count(*)::int FROM public.rule_votes v WHERE v.proposal_id = p.id AND NOT v.vote),
      (SELECT v.vote FROM public.rule_votes v WHERE v.proposal_id = p.id AND v.user_id = auth.uid())
    FROM public.rule_proposals p
    JOIN public.users u ON u.id = p.proposed_by
    WHERE p.league_id = p_league_id
    ORDER BY (p.status = 'open') DESC, p.created_at DESC
    LIMIT 20;
END; $$;

GRANT EXECUTE ON FUNCTION public.propose_rule_change(uuid,text,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cast_rule_vote(uuid,boolean)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_rule_proposal(uuid)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.league_proposals(uuid)                   TO authenticated;

NOTIFY pgrst, 'reload schema';
