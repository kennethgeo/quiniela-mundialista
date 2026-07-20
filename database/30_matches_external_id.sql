-- =============================================================================
-- 30_matches_external_id.sql
-- =============================================================================
-- Prepara la tabla matches para el sync GENÉRICO de ESPN (torneos nuevos):
--   · external_id: id del evento de ESPN → clave estable para upsert (crear/
--     actualizar sin emparejar por nombre).
--   · minute: minuto en vivo (best-effort; el live-sync ya lo escribía).
-- El Mundial (torneo #1) no usa external_id (sigue con su sync propio), por eso
-- la única es (tournament_id, external_id), que permite varios NULL.
-- Idempotente.
-- =============================================================================

ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS minute TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.matches'::regclass
      AND conname = 'matches_tournament_external_key'
  ) THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT matches_tournament_external_key UNIQUE (tournament_id, external_id);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
