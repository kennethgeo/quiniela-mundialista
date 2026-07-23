-- =============================================================================
-- 43_rule_votes_live.sql  ·  Votación: plazo + realtime + aviso en el Hub
-- =============================================================================
-- Sobre la migración 42 agrega:
--   1) Realtime: políticas SELECT para miembros + tablas en la publicación, para
--      que el conteo de votos se actualice solo en el celular de todos.
--   2) Plazo: cada propuesta expira a las 48 h. Al vencer se resuelve por mayoría
--      simple de los votos emitidos (empate = rechazada). Se resuelve "en lectura"
--      (sin cron): al listar/votar/proponer se cierran las vencidas.
--   3) Aviso en el Hub: my_groups devuelve open_proposal y my_pending_vote.
-- Idempotente.
-- =============================================================================

-- 1) Plazo -------------------------------------------------------------------
ALTER TABLE public.rule_proposals ADD COLUMN IF NOT EXISTS expires_at timestamptz;
-- Backfill de propuestas abiertas sin plazo: 48 h desde su creación.
UPDATE public.rule_proposals
   SET expires_at = created_at + interval '48 hours'
 WHERE expires_at IS NULL AND status = 'open';

-- Cierra las propuestas vencidas de una quiniela (mayoría simple de lo votado).
CREATE OR REPLACE FUNCTION public._resolve_expired_proposals(p_league_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_yes int; v_no int;
BEGIN
  FOR r IN
    SELECT id FROM public.rule_proposals
    WHERE league_id = p_league_id AND status = 'open'
      AND expires_at IS NOT NULL AND expires_at <= now()
  LOOP
    SELECT count(*) FILTER (WHERE vote), count(*) FILTER (WHERE NOT vote)
      INTO v_yes, v_no FROM public.rule_votes WHERE proposal_id = r.id;
    IF v_yes > v_no THEN
      PERFORM public._apply_rule_proposal(r.id);
      UPDATE public.rule_proposals SET status = 'approved', closed_at = now() WHERE id = r.id;
    ELSE
      UPDATE public.rule_proposals SET status = 'rejected', closed_at = now() WHERE id = r.id;
    END IF;
  END LOOP;
END; $$;
GRANT EXECUTE ON FUNCTION public._resolve_expired_proposals(uuid) TO authenticated;

-- 2) propose_rule_change: fija el plazo y cierra vencidas antes de abrir otra.
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
  IF p_kind NOT IN ('scoring','rules') THEN RAISE EXCEPTION 'Tipo de propuesta inválido'; END IF;
  PERFORM public._resolve_expired_proposals(p_league_id);
  IF EXISTS (SELECT 1 FROM public.rule_proposals WHERE league_id = p_league_id AND status = 'open') THEN
    RAISE EXCEPTION 'Ya hay una propuesta abierta en esta quiniela';
  END IF;
  INSERT INTO public.rule_proposals (league_id, proposed_by, kind, payload, note, expires_at)
  VALUES (p_league_id, v_uid, p_kind, p_payload, NULLIF(btrim(COALESCE(p_note,'')), ''), now() + interval '48 hours')
  RETURNING id INTO v_id;
  INSERT INTO public.rule_votes (proposal_id, user_id, vote) VALUES (v_id, v_uid, true);
  PERFORM public._tally_rule_proposal(v_id);
  RETURN v_id;
END; $$;

-- 3) cast_rule_vote: cierra vencidas primero (no se vota una propuesta expirada).
CREATE OR REPLACE FUNCTION public.cast_rule_vote(p_proposal_id uuid, p_vote boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_league uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT league_id INTO v_league FROM public.rule_proposals WHERE id = p_proposal_id;
  IF v_league IS NULL THEN RAISE EXCEPTION 'Propuesta inexistente'; END IF;
  PERFORM public._resolve_expired_proposals(v_league);
  IF NOT EXISTS (SELECT 1 FROM public.rule_proposals WHERE id = p_proposal_id AND status = 'open') THEN
    RAISE EXCEPTION 'La propuesta ya no está abierta';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.league_members WHERE league_id = v_league AND user_id = v_uid) THEN
    RAISE EXCEPTION 'No sos miembro de esta quiniela';
  END IF;
  INSERT INTO public.rule_votes (proposal_id, user_id, vote)
  VALUES (p_proposal_id, v_uid, p_vote)
  ON CONFLICT (proposal_id, user_id) DO UPDATE SET vote = EXCLUDED.vote, created_at = now();
  PERFORM public._tally_rule_proposal(p_proposal_id);
END; $$;

-- 4) league_proposals: resuelve vencidas y devuelve también expires_at.
-- Se elimina primero porque cambia el tipo de retorno (agrega expires_at).
DROP FUNCTION IF EXISTS public.league_proposals(uuid);
CREATE OR REPLACE FUNCTION public.league_proposals(p_league_id uuid)
RETURNS TABLE (
  id uuid, kind text, payload jsonb, note text, status text,
  created_at timestamptz, closed_at timestamptz, expires_at timestamptz,
  proposed_by uuid, proposer_name text,
  members int, yes_count int, no_count int, my_vote boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.league_members
                 WHERE league_id = p_league_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'No sos miembro de esta quiniela';
  END IF;
  PERFORM public._resolve_expired_proposals(p_league_id);
  RETURN QUERY
    SELECT p.id, p.kind, p.payload, p.note, p.status, p.created_at, p.closed_at, p.expires_at,
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
GRANT EXECUTE ON FUNCTION public.league_proposals(uuid) TO authenticated;

-- 5) Realtime: los miembros pueden LEER propuestas/votos de sus quinielas.
--    (Necesario para que Supabase Realtime entregue los eventos; respeta RLS.)
DROP POLICY IF EXISTS "rule_proposals_select_members" ON public.rule_proposals;
CREATE POLICY "rule_proposals_select_members" ON public.rule_proposals
  FOR SELECT TO authenticated USING (public.is_league_member(league_id));

DROP POLICY IF EXISTS "rule_votes_select_members" ON public.rule_votes;
CREATE POLICY "rule_votes_select_members" ON public.rule_votes
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.rule_proposals p
            WHERE p.id = proposal_id AND public.is_league_member(p.league_id)));

-- Agregar las tablas a la publicación de realtime (idempotente).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'rule_proposals') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rule_proposals;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'rule_votes') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rule_votes;
  END IF;
EXCEPTION WHEN undefined_object THEN
  -- La publicación supabase_realtime no existe en este entorno; se ignora.
  NULL;
END $$;

-- 6) my_groups: agregar aviso de votación (open_proposal, my_pending_vote).
DROP FUNCTION IF EXISTS public.my_groups();
CREATE OR REPLACE FUNCTION public.my_groups()
RETURNS TABLE (
  id uuid, name text, description text, invitation_code text, admin_id uuid,
  tournament_id int, tournament_name text, tournament_kind text, tournament_status text,
  members int, my_points numeric, my_rank int,
  rules text, is_admin boolean, rules_accepted boolean,
  points_exact int, points_correct int, champion_points int, scorer_points int, powerup_limit int,
  open_proposal boolean, my_pending_vote boolean
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
