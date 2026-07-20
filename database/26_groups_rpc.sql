-- =============================================================================
-- 26_groups_rpc.sql  ·  Fase 2: Hub de grupos (capa de acceso)
-- =============================================================================
-- Funciones SECURITY DEFINER para operar grupos sin chocar con RLS:
--   · user_tournament_points  — vista: puntos por (usuario, torneo)
--   · create_group            — crear grupo con código único + unir al creador
--   · join_group_by_code      — unirse por código (resuelve código→grupo)
--   · my_groups               — mis grupos con torneo, miembros, mis pts y rank
--   · group_standings         — tabla de un grupo (solo si sos miembro)
-- Idempotente.
-- =============================================================================

-- Puntos por (usuario, torneo) — consistente con el ranking global existente.
CREATE OR REPLACE VIEW public.user_tournament_points AS
SELECT u.id AS user_id, t.id AS tournament_id,
  COALESCE((
    SELECT SUM(COALESCE(pr.points_earned,0))
    FROM public.predictions pr JOIN public.matches m ON m.id = pr.match_id
    WHERE pr.user_id = u.id AND m.tournament_id = t.id), 0)
  + COALESCE((
    SELECT SUM(COALESCE(tp.champion_points,0) + COALESCE(tp.top_scorer_points,0))
    FROM public.tournament_predictions tp
    WHERE tp.user_id = u.id AND tp.tournament_id = t.id), 0) AS points
FROM public.users u CROSS JOIN public.tournaments t;
GRANT SELECT ON public.user_tournament_points TO authenticated;

-- Crear grupo (código único de 6 chars) + unir al creador
CREATE OR REPLACE FUNCTION public.create_group(p_name text, p_tournament_id int)
RETURNS public.leagues
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code text; v_row public.leagues; v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF btrim(COALESCE(p_name,'')) = '' THEN RAISE EXCEPTION 'El nombre es obligatorio'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tournaments WHERE id = p_tournament_id) THEN
    RAISE EXCEPTION 'Torneo inválido';
  END IF;
  LOOP
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.leagues WHERE invitation_code = v_code);
  END LOOP;
  INSERT INTO public.leagues (name, invitation_code, admin_id, tournament_id)
  VALUES (btrim(p_name), v_code, v_uid, p_tournament_id)
  RETURNING * INTO v_row;
  INSERT INTO public.league_members (league_id, user_id)
  VALUES (v_row.id, v_uid) ON CONFLICT DO NOTHING;
  RETURN v_row;
END; $$;

-- Unirse por código
CREATE OR REPLACE FUNCTION public.join_group_by_code(p_code text)
RETURNS public.leagues
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.leagues; v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT * INTO v_row FROM public.leagues WHERE invitation_code = upper(btrim(p_code));
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Código inválido'; END IF;
  INSERT INTO public.league_members (league_id, user_id)
  VALUES (v_row.id, v_uid) ON CONFLICT DO NOTHING;
  RETURN v_row;
END; $$;

-- Mis grupos con resumen (torneo, miembros, mis puntos, mi posición)
CREATE OR REPLACE FUNCTION public.my_groups()
RETURNS TABLE (
  id uuid, name text, description text, invitation_code text, admin_id uuid,
  tournament_id int, tournament_name text, tournament_kind text, tournament_status text,
  members int, my_points numeric, my_rank int
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT l.id, l.name, l.description, l.invitation_code, l.admin_id,
    l.tournament_id, t.name, t.kind, t.status,
    (SELECT count(*)::int FROM public.league_members lm WHERE lm.league_id = l.id) AS members,
    COALESCE(utp.points, 0) AS my_points,
    (SELECT count(*)::int + 1 FROM public.league_members lm2
       JOIN public.user_tournament_points u2
         ON u2.user_id = lm2.user_id AND u2.tournament_id = l.tournament_id
       WHERE lm2.league_id = l.id AND u2.points > COALESCE(utp.points, 0)) AS my_rank
  FROM public.leagues l
  JOIN public.league_members m ON m.league_id = l.id AND m.user_id = auth.uid()
  JOIN public.tournaments t ON t.id = l.tournament_id
  LEFT JOIN public.user_tournament_points utp
    ON utp.user_id = auth.uid() AND utp.tournament_id = l.tournament_id
  ORDER BY (t.status = 'active') DESC, l.created_at DESC;
$$;

-- Tabla de posiciones de un grupo (solo miembros)
CREATE OR REPLACE FUNCTION public.group_standings(p_league_id uuid)
RETURNS TABLE (user_id uuid, display_name text, avatar_url text, points numeric, is_me boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tid int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.league_members lm
                 WHERE lm.league_id = p_league_id AND lm.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'No sos miembro de este grupo';
  END IF;
  SELECT l.tournament_id INTO v_tid FROM public.leagues l WHERE l.id = p_league_id;
  RETURN QUERY
    SELECT u.id, u.display_name, u.avatar_url, COALESCE(utp.points, 0)::numeric, (u.id = auth.uid())
    FROM public.league_members lm
    JOIN public.users u ON u.id = lm.user_id
    LEFT JOIN public.user_tournament_points utp
      ON utp.user_id = u.id AND utp.tournament_id = v_tid
    WHERE lm.league_id = p_league_id
    ORDER BY COALESCE(utp.points, 0) DESC, u.created_at ASC;
END; $$;

GRANT EXECUTE ON FUNCTION public.create_group(text,int)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_group_by_code(text)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_groups()                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.group_standings(uuid)         TO authenticated;

NOTIFY pgrst, 'reload schema';
