-- =============================================================================
-- 29_fix_group_standings.sql
-- =============================================================================
-- BUG: group_standings mostraba "Sin miembros todavía" aunque el grupo tiene
-- miembros. Causa: en PL/pgSQL los nombres de las columnas de RETURNS TABLE
-- (user_id, ...) son variables; el chequeo de membresía usaba `user_id` y
-- `league_id` SIN CALIFICAR, chocando con esas variables (ambiguo/NULL) → la
-- función fallaba. Se califican todas las columnas.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.group_standings(p_league_id uuid)
RETURNS TABLE (user_id uuid, display_name text, avatar_url text, points numeric, is_me boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tid int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.league_members lm
    WHERE lm.league_id = p_league_id AND lm.user_id = auth.uid()
  ) THEN
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

GRANT EXECUTE ON FUNCTION public.group_standings(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
