-- =============================================================================
-- 39_fix_tournament_predictions_lock.sql  ·  Bloqueo de campeón/goleador POR TORNEO
-- =============================================================================
-- Bug: la política RLS bloqueaba si now() < MIN(kickoff_at) de TODOS los partidos
-- (sin filtrar por torneo). Como el Mundial ya se jugó, ese MIN global quedó en el
-- pasado y bloqueaba guardar campeón/goleador de cualquier torneo (p.ej. Liga CR).
-- Fix: helper por-torneo (y si el torneo aún no tiene partidos, queda abierto).
-- Idempotente.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.tournament_predictions_open(p_tid int)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT COALESCE((SELECT is_locked FROM public.tournament_settings WHERE id = 1), false) = false
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
