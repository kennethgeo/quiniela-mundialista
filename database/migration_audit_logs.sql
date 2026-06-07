-- =============================================================================
-- MIGRACIÓN: HISTORIAL DE PREDICCIONES (AUDIT LOGS)
-- Ejecuta todo este script en el SQL Editor de Supabase
-- =============================================================================

-- 1. Crear tabla para almacenar el historial de cambios
CREATE TABLE IF NOT EXISTS public.prediction_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    prediction_id UUID NOT NULL REFERENCES public.predictions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    match_id INTEGER NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE')),
    old_data JSONB,
    new_data JSONB,
    changed_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.prediction_logs IS 'Bitácora inalterable de cada cambio hecho a una predicción por el usuario';

-- 2. Habilitar Seguridad por Fila (RLS) en la nueva tabla
ALTER TABLE public.prediction_logs ENABLE ROW LEVEL SECURITY;

-- 3. Políticas de RLS para el historial (Solo lectura, y solo el propio usuario o admin)
DROP POLICY IF EXISTS "Usuarios ven sus propios logs" ON public.prediction_logs;
CREATE POLICY "Usuarios ven sus propios logs" 
ON public.prediction_logs FOR SELECT 
USING (auth.uid() = user_id OR (SELECT is_admin FROM public.users WHERE id = auth.uid()) = true);

-- 4. Crear la función del Trigger que registra la acción automáticamente
CREATE OR REPLACE FUNCTION public.log_prediction_changes()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.prediction_logs (prediction_id, user_id, match_id, action, new_data)
    VALUES (NEW.id, NEW.user_id, NEW.match_id, 'INSERT', row_to_json(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Solo guardar log si realmente cambió algún dato relevante de la predicción
    IF NEW.home_goals_pred IS DISTINCT FROM OLD.home_goals_pred OR
       NEW.away_goals_pred IS DISTINCT FROM OLD.away_goals_pred OR
       NEW.use_powerup_x2 IS DISTINCT FROM OLD.use_powerup_x2 OR
       NEW.penalties_winner_pred IS DISTINCT FROM OLD.penalties_winner_pred OR
       NEW.prediction_type IS DISTINCT FROM OLD.prediction_type THEN
       
       INSERT INTO public.prediction_logs (prediction_id, user_id, match_id, action, old_data, new_data)
       VALUES (NEW.id, NEW.user_id, NEW.match_id, 'UPDATE', row_to_json(OLD), row_to_json(NEW));
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Vincular el Trigger a la tabla de predictions
DROP TRIGGER IF EXISTS prediction_audit_trigger ON public.predictions;
CREATE TRIGGER prediction_audit_trigger
AFTER INSERT OR UPDATE ON public.predictions
FOR EACH ROW EXECUTE FUNCTION public.log_prediction_changes();
