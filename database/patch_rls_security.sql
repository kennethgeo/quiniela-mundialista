-- =============================================================================
-- PARCHE DE SEGURIDAD PARA PREDICCIONES
-- Evita que se puedan ver predicciones ajenas vía API antes del límite de tiempo.
-- =============================================================================

-- 1. Eliminar la política anterior que era menos estricta
DROP POLICY IF EXISTS "predictions_select_others_not_pending" ON public.predictions;

-- 2. Crear nueva política estricta
-- Un usuario puede ver las predicciones de otros SOLO si faltan 15 minutos o menos para el partido
-- O si es su propia predicción.
CREATE POLICY "predictions_select_others_strict"
  ON public.predictions FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR 
    (
      SELECT kickoff_at - interval '15 minutes' <= now()
      FROM public.matches
      WHERE id = match_id
    )
  );

-- Comentario descriptivo
COMMENT ON POLICY "predictions_select_others_strict" ON public.predictions 
IS 'Protege el Modo Incógnito asegurando que la DB no revele predicciones hasta faltar 15 mins';
