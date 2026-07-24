-- =============================================================================
-- 45_match_status_cancelled.sql  ·  Estado 'cancelled' + fase 'knockout'
-- =============================================================================
-- · matches.status admite 'cancelled'/'postponed' (partido no disputado →
--   no cuenta para el puntaje; el scoring anula sus predicciones).
-- · matches.phase admite 'knockout' (postemporada de liga, migración del sync).
--   El CHECK original solo listaba las fases del Mundial y habría rechazado el
--   'knockout' que el sync setea para semis/final de una liga.
-- Idempotente.
-- =============================================================================

ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_status_check;
ALTER TABLE public.matches ADD  CONSTRAINT matches_status_check
  CHECK (status IN ('pending','in_progress','finished','cancelled','postponed'));

ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_phase_check;
ALTER TABLE public.matches ADD  CONSTRAINT matches_phase_check
  CHECK (phase IN ('groups','knockout','round_of_32','round_of_16',
                   'quarter_finals','semi_finals','third_place','final'));

NOTIFY pgrst, 'reload schema';
