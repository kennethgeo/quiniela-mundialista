-- =============================================================================
-- 40_tournament_lock_per_tournament.sql  ·  Candado de campeón/goleador POR TORNEO
-- =============================================================================
-- La migración 39 seguía mirando el flag GLOBAL tournament_settings.is_locked, que
-- suele quedar en true (p.ej. tras el Mundial) y bloqueaba TODOS los torneos.
-- Ahora usa el candado propio de cada torneo (tournaments.predictions_locked).
-- Self-contained e idempotente (recrea el helper y las políticas).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.tournament_predictions_open(p_tid int)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT COALESCE((SELECT predictions_locked FROM public.tournaments WHERE id = p_tid), false) = false
     AND now() < COALESCE(
           (SELECT MIN(kickoff_at) FROM public.matches WHERE tournament_id = p_tid),
           'infinity'::timestamptz);
$$;
GRANT EXECUTE ON FUNCTION public.tournament_predictions_open(int) TO authenticated;

DROP POLICY IF EXISTS "predictions_insert" ON public.tournament_predictions;
CREATE POLICY "predictions_insert"
  ON public.tournament_predictions FOR INSERT
  WITH CHECK (auth.uid() = user_id AND public.tournament_predictions_open(tournament_id));

DROP POLICY IF EXISTS "predictions_update" ON public.tournament_predictions;
CREATE POLICY "predictions_update"
  ON public.tournament_predictions FOR UPDATE
  USING (auth.uid() = user_id AND public.tournament_predictions_open(tournament_id))
  WITH CHECK (auth.uid() = user_id AND public.tournament_predictions_open(tournament_id));

NOTIFY pgrst, 'reload schema';
