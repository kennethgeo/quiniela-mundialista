-- =============================================================================
-- 49_group_extras.sql  ·  Premios y WhatsApp por quiniela (reemplaza "Ajustes
-- Globales de la App", que era un panel único para todo el sitio sin ningún
-- consumidor real: sus campos no se mostraban en ninguna pantalla).
-- =============================================================================
-- leagues.prizes_text / whatsapp_link: cada quiniela define sus propios
-- premios y su propio grupo de WhatsApp (tiene más sentido que un valor único
-- para toda la app, ya que la app es 100% por quiniela). set_group_extras las
-- edita (solo el admin de esa quiniela); my_groups las devuelve.
-- Idempotente.
-- =============================================================================

ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS prizes_text text;
ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS whatsapp_link text;

CREATE OR REPLACE FUNCTION public.set_group_extras(
  p_league_id uuid, p_prizes_text text, p_whatsapp_link text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leagues WHERE id = p_league_id AND admin_id = v_uid) THEN
    RAISE EXCEPTION 'Solo el administrador puede editar esto';
  END IF;
  UPDATE public.leagues SET
    prizes_text   = NULLIF(btrim(COALESCE(p_prizes_text, '')), ''),
    whatsapp_link = NULLIF(btrim(COALESCE(p_whatsapp_link, '')), '')
  WHERE id = p_league_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.set_group_extras(uuid, text, text) TO authenticated;

DROP FUNCTION IF EXISTS public.my_groups();
CREATE OR REPLACE FUNCTION public.my_groups()
RETURNS TABLE (
  id uuid, name text, description text, invitation_code text, admin_id uuid,
  tournament_id int, tournament_name text, tournament_kind text, tournament_status text,
  members int, my_points numeric, my_rank int,
  rules text, is_admin boolean, rules_accepted boolean,
  points_exact int, points_correct int, champion_points int, scorer_points int, powerup_limit int,
  assist_points int, open_proposal boolean, my_pending_vote boolean,
  prizes_text text, whatsapp_link text
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
                              WHERE rv.proposal_id = rp.id AND rv.user_id = auth.uid())) AS my_pending_vote,
    l.prizes_text, l.whatsapp_link
  FROM public.leagues l
  JOIN public.league_members m ON m.league_id = l.id AND m.user_id = auth.uid()
  JOIN public.tournaments t ON t.id = l.tournament_id
  ORDER BY (t.status = 'active') DESC, l.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.my_groups() TO authenticated;

NOTIFY pgrst, 'reload schema';
