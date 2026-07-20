-- =============================================================================
-- 33_matches_stage.sql
-- =============================================================================
-- Guarda la FASE real de cada partido (según ESPN), para respetar el formato de
-- cada torneo: "Fase de liga", "Octavos", "Semifinal · Ida", "Liguilla",
-- "Jornada N" (ligas), etc. La UI agrupa por esto.
-- =============================================================================

ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS stage TEXT;

NOTIFY pgrst, 'reload schema';
