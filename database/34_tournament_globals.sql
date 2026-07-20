-- =============================================================================
-- 34_tournament_globals.sql
-- =============================================================================
-- Campeón/goleador y bloqueo AHORA son POR TORNEO (antes un singleton global del
-- Mundial en tournament_settings). Se agregan a la tabla tournaments y se migra
-- el valor actual del Mundial (torneo #1).
-- =============================================================================

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS predictions_locked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS actual_champion   TEXT,
  ADD COLUMN IF NOT EXISTS actual_top_scorer TEXT;

-- Migrar lo del Mundial (si existe tournament_settings singleton).
UPDATE public.tournaments t SET
  predictions_locked = COALESCE((SELECT is_locked        FROM public.tournament_settings WHERE id = 1), false),
  actual_champion    = (SELECT actual_champion    FROM public.tournament_settings WHERE id = 1),
  actual_top_scorer  = (SELECT actual_top_scorer  FROM public.tournament_settings WHERE id = 1)
WHERE t.id = 1;

NOTIFY pgrst, 'reload schema';
