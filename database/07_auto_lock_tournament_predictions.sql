-- =============================================================================
-- Migración: Bloqueo automático de predicciones globales (campeón / goleador)
-- Ejecutar en el SQL Editor de Supabase
--
-- Problema: las predicciones globales solo se bloqueaban con el flag manual
-- tournament_settings.is_locked. Si el admin no lo activaba, seguían editables
-- aunque ya hubiera iniciado el torneo.
--
-- Solución: además del flag manual, bloquear automáticamente en cuanto inicia
-- el primer partido del torneo (kickoff más temprano <= ahora).
-- =============================================================================

-- INSERT: solo si no está bloqueado manualmente Y el torneo aún no inició
DROP POLICY IF EXISTS "predictions_insert" ON public.tournament_predictions;
CREATE POLICY "predictions_insert"
  ON public.tournament_predictions FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND (SELECT is_locked FROM public.tournament_settings WHERE id = 1) = false
    AND now() < (SELECT MIN(kickoff_at) FROM public.matches)
  );

-- UPDATE: misma condición
DROP POLICY IF EXISTS "predictions_update" ON public.tournament_predictions;
CREATE POLICY "predictions_update"
  ON public.tournament_predictions FOR UPDATE
  USING (
    auth.uid() = user_id
    AND (SELECT is_locked FROM public.tournament_settings WHERE id = 1) = false
    AND now() < (SELECT MIN(kickoff_at) FROM public.matches)
  )
  WITH CHECK (
    auth.uid() = user_id
    AND (SELECT is_locked FROM public.tournament_settings WHERE id = 1) = false
    AND now() < (SELECT MIN(kickoff_at) FROM public.matches)
  );

-- Nota: si MIN(kickoff_at) es NULL (no hay partidos), la comparación es NULL y
-- el WITH CHECK/USING evalúa a falso, bloqueando por seguridad.
