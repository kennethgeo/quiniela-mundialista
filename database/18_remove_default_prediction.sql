-- =============================================================================
-- 18_remove_default_prediction.sql
-- =============================================================================
-- Revierte la regla "sin predicción = 0-0" de aquí en adelante: elimina el
-- trigger y las funciones que sembraban predicciones 0-0 al arrancar/terminar
-- un partido. Los 0-0 ya creados para partidos pasados NO se tocan (si se
-- quisieran limpiar, sería un borrado aparte).
-- =============================================================================

DROP TRIGGER IF EXISTS matches_seed_default_predictions ON public.matches;
DROP FUNCTION IF EXISTS public.trg_seed_default_predictions();
DROP FUNCTION IF EXISTS public.seed_default_predictions(integer);

NOTIFY pgrst, 'reload schema';
