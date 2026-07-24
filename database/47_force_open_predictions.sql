-- =============================================================================
-- 47_force_open_predictions.sql  ·  Reabrir predicciones globales tras el inicio
-- =============================================================================
-- Hasta ahora tournament_predictions_open exigía predictions_locked=false Y que
-- fuera ANTES del primer partido. El admin no tenía forma de reabrir las
-- predicciones (campeón/goleador/asistidor) una vez iniciado el torneo, para que
-- la gente que faltó pueda cargarlas. Se agrega un override por torneo.
-- Idempotente.
-- =============================================================================

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS predictions_force_open boolean NOT NULL DEFAULT false;

-- Abierto = no bloqueado, Y (override manual del admin O aún no arrancó).
CREATE OR REPLACE FUNCTION public.tournament_predictions_open(p_tid int)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT COALESCE((SELECT predictions_locked FROM public.tournaments WHERE id = p_tid), false) = false
     AND (
       COALESCE((SELECT predictions_force_open FROM public.tournaments WHERE id = p_tid), false)
       OR now() < COALESCE(
            (SELECT MIN(kickoff_at) FROM public.matches WHERE tournament_id = p_tid),
            'infinity'::timestamptz)
     );
$$;
GRANT EXECUTE ON FUNCTION public.tournament_predictions_open(int) TO authenticated;

NOTIFY pgrst, 'reload schema';
