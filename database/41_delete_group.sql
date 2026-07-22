-- =============================================================================
-- 41_delete_group.sql  ·  Eliminar quiniela + bloquear edición de reglas al iniciar
-- =============================================================================
-- · delete_group(league)           — el admin elimina la quiniela (cascada)
-- · group_tournament_started(league) — true si el torneo ya arrancó (1er partido)
-- · set_group_rules / set_group_scoring — ahora RECHAZAN si el torneo ya inició
--   (los cambios durante el torneo irán por votación, en una migración posterior).
-- Idempotente.
-- =============================================================================

-- Eliminar quiniela (solo su admin). Las FK ON DELETE CASCADE limpian
-- league_members / predictions / tournament_predictions.
CREATE OR REPLACE FUNCTION public.delete_group(p_league_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leagues WHERE id = p_league_id AND admin_id = v_uid) THEN
    RAISE EXCEPTION 'Solo el administrador puede eliminar la quiniela';
  END IF;
  DELETE FROM public.leagues WHERE id = p_league_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.delete_group(uuid) TO authenticated;

-- ¿El torneo de la quiniela ya inició? (primer partido con kickoff <= ahora)
CREATE OR REPLACE FUNCTION public.group_tournament_started(p_league_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT COALESCE(
    (SELECT MIN(m.kickoff_at) <= now()
     FROM public.matches m
     JOIN public.leagues l ON l.id = p_league_id
     WHERE m.tournament_id = l.tournament_id),
    false);
$$;
GRANT EXECUTE ON FUNCTION public.group_tournament_started(uuid) TO authenticated;

-- Reglas de texto: bloquear edición si el torneo ya inició.
CREATE OR REPLACE FUNCTION public.set_group_rules(p_league_id uuid, p_rules text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leagues WHERE id = p_league_id AND admin_id = v_uid) THEN
    RAISE EXCEPTION 'Solo el administrador puede editar las reglas';
  END IF;
  IF public.group_tournament_started(p_league_id) THEN
    RAISE EXCEPTION 'El torneo ya inició: las reglas quedan bloqueadas (los cambios se someten a votación).';
  END IF;
  UPDATE public.leagues SET rules = btrim(COALESCE(p_rules,'')) WHERE id = p_league_id;
  UPDATE public.league_members SET rules_accepted_at = NULL
  WHERE league_id = p_league_id AND user_id <> v_uid;
END; $$;

-- Config de puntaje: bloquear edición si el torneo ya inició.
CREATE OR REPLACE FUNCTION public.set_group_scoring(
  p_league_id uuid, p_points_exact int, p_points_correct int,
  p_champion_points int, p_scorer_points int, p_powerup_limit int)
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
    powerup_limit   = GREATEST(0, COALESCE(p_powerup_limit, powerup_limit))
  WHERE id = p_league_id;
END; $$;

NOTIFY pgrst, 'reload schema';
