-- =============================================================================
-- 44_assist_prediction.sql  ·  Predicción de ASISTIDOR (máximo asistente)
-- =============================================================================
-- Nueva predicción global por quiniela, análoga al goleador:
--   · tournament_predictions.top_assist_name / top_assist_points
--   · tournaments.actual_top_assist (lo fija el admin)
--   · leagues.assist_points (config por quiniela, default 12)
-- Actualiza league_points, set_group_scoring (+ candado de torneo) y my_groups.
-- Idempotente.
-- =============================================================================

-- 1) Columnas ----------------------------------------------------------------
ALTER TABLE public.tournament_predictions ADD COLUMN IF NOT EXISTS top_assist_name text;
ALTER TABLE public.tournament_predictions ADD COLUMN IF NOT EXISTS top_assist_points int DEFAULT 0;
ALTER TABLE public.tournaments            ADD COLUMN IF NOT EXISTS actual_top_assist text;
ALTER TABLE public.leagues                ADD COLUMN IF NOT EXISTS assist_points int NOT NULL DEFAULT 12;

-- 2) league_points: sumar también los puntos de asistidor ---------------------
CREATE OR REPLACE FUNCTION public.league_points(p_league_id uuid, p_user_id uuid)
RETURNS numeric
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT SUM(COALESCE(pr.points_earned,0)) FROM public.predictions pr
                   WHERE pr.user_id = p_user_id AND pr.league_id = p_league_id), 0)
       + COALESCE((SELECT SUM(COALESCE(tp.champion_points,0)
                             + COALESCE(tp.top_scorer_points,0)
                             + COALESCE(tp.top_assist_points,0))
                   FROM public.tournament_predictions tp
                   WHERE tp.user_id = p_user_id AND tp.league_id = p_league_id), 0);
$$;

-- 3) set_group_scoring: agregar p_assist_points (mantiene el candado de torneo)
DROP FUNCTION IF EXISTS public.set_group_scoring(uuid,int,int,int,int,int);
CREATE OR REPLACE FUNCTION public.set_group_scoring(
  p_league_id uuid, p_points_exact int, p_points_correct int,
  p_champion_points int, p_scorer_points int, p_powerup_limit int,
  p_assist_points int DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leagues WHERE id = p_league_id AND admin_id = v_uid) THEN
    RAISE EXCEPTION 'Solo el administrador puede editar las reglas';
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
    powerup_limit   = GREATEST(0, COALESCE(p_powerup_limit, powerup_limit))
  WHERE id = p_league_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.set_group_scoring(uuid,int,int,int,int,int,int) TO authenticated;

-- 4) _apply_rule_proposal: aplicar también assist_points en propuestas 'scoring'
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
      assist_points   = GREATEST(0, COALESCE((r.payload->>'assist_points')::int,   assist_points)),
      powerup_limit   = GREATEST(0, COALESCE((r.payload->>'powerup_limit')::int,   powerup_limit))
    WHERE id = r.league_id;
  ELSIF r.kind = 'rules' THEN
    UPDATE public.leagues SET rules = btrim(COALESCE(r.payload->>'rules','')) WHERE id = r.league_id;
    UPDATE public.league_members SET rules_accepted_at = NULL
    WHERE league_id = r.league_id AND user_id <> r.proposed_by;
  END IF;
END; $$;

-- 5) my_groups: devolver assist_points (conserva open_proposal / my_pending_vote)
DROP FUNCTION IF EXISTS public.my_groups();
CREATE OR REPLACE FUNCTION public.my_groups()
RETURNS TABLE (
  id uuid, name text, description text, invitation_code text, admin_id uuid,
  tournament_id int, tournament_name text, tournament_kind text, tournament_status text,
  members int, my_points numeric, my_rank int,
  rules text, is_admin boolean, rules_accepted boolean,
  points_exact int, points_correct int, champion_points int, scorer_points int, powerup_limit int,
  assist_points int, open_proposal boolean, my_pending_vote boolean
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT l.id, l.name, l.description, l.invitation_code, l.admin_id,
    l.tournament_id, t.name, t.kind, t.status,
    (SELECT count(*)::int FROM public.league_members lm WHERE lm.league_id = l.id) AS members,
    public.league_points(l.id, auth.uid()) AS my_points,
    (SELECT count(*)::int + 1 FROM public.league_members lm2
       WHERE lm2.league_id = l.id
         AND public.league_points(l.id, lm2.user_id) > public.league_points(l.id, auth.uid())) AS my_rank,
    l.rules,
    (l.admin_id = auth.uid()) AS is_admin,
    (m.rules_accepted_at IS NOT NULL) AS rules_accepted,
    l.points_exact, l.points_correct, l.champion_points, l.scorer_points, l.powerup_limit,
    l.assist_points,
    EXISTS (SELECT 1 FROM public.rule_proposals rp
            WHERE rp.league_id = l.id AND rp.status = 'open'
              AND (rp.expires_at IS NULL OR rp.expires_at > now())) AS open_proposal,
    EXISTS (SELECT 1 FROM public.rule_proposals rp
            WHERE rp.league_id = l.id AND rp.status = 'open'
              AND (rp.expires_at IS NULL OR rp.expires_at > now())
              AND NOT EXISTS (SELECT 1 FROM public.rule_votes rv
                              WHERE rv.proposal_id = rp.id AND rv.user_id = auth.uid())) AS my_pending_vote
  FROM public.leagues l
  JOIN public.league_members m ON m.league_id = l.id AND m.user_id = auth.uid()
  JOIN public.tournaments t ON t.id = l.tournament_id
  ORDER BY (t.status = 'active') DESC, l.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.my_groups() TO authenticated;

NOTIFY pgrst, 'reload schema';
