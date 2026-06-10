-- =============================================================================
-- Migración: Predicciones Globales (Campeón y Goleador)
-- Ejecutar en el SQL Editor de Supabase
-- =============================================================================

-- 1. Crear tabla tournament_predictions
CREATE TABLE IF NOT EXISTS public.tournament_predictions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  champion_team TEXT,
  top_scorer_name TEXT,
  champion_points INTEGER DEFAULT 0,
  top_scorer_points INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Crear tabla tournament_settings (Singleton) si no queremos usar global_settings
-- Usaremos una tabla dedicada para los resultados reales
CREATE TABLE IF NOT EXISTS public.tournament_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  is_locked BOOLEAN DEFAULT false,
  actual_champion TEXT,
  actual_top_scorer TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO public.tournament_settings (id, is_locked) VALUES (1, false) ON CONFLICT (id) DO NOTHING;

-- 3. Políticas de seguridad (RLS)
ALTER TABLE public.tournament_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_settings ENABLE ROW LEVEL SECURITY;

-- Políticas para tournament_settings
CREATE POLICY "Todos pueden leer tournament_settings"
  ON public.tournament_settings FOR SELECT
  USING (true);

CREATE POLICY "Solo administradores pueden actualizar tournament_settings"
  ON public.tournament_settings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE users.id = auth.uid() AND users.is_admin = true
    )
  );

-- Políticas para tournament_predictions
-- El usuario puede ver su propia predicción siempre
-- Puede ver las predicciones de los demás solo si el torneo está bloqueado
CREATE POLICY "predictions_select"
  ON public.tournament_predictions FOR SELECT
  USING (
    auth.uid() = user_id OR 
    (SELECT is_locked FROM public.tournament_settings WHERE id = 1) = true
  );

-- El usuario puede insertar o actualizar su predicción si no está bloqueado
CREATE POLICY "predictions_insert"
  ON public.tournament_predictions FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND 
    (SELECT is_locked FROM public.tournament_settings WHERE id = 1) = false
  );

CREATE POLICY "predictions_update"
  ON public.tournament_predictions FOR UPDATE
  USING (
    auth.uid() = user_id AND 
    (SELECT is_locked FROM public.tournament_settings WHERE id = 1) = false
  )
  WITH CHECK (
    auth.uid() = user_id AND 
    (SELECT is_locked FROM public.tournament_settings WHERE id = 1) = false
  );

-- Trigger para updated_at
CREATE OR REPLACE TRIGGER tournament_predictions_updated_at
  BEFORE UPDATE ON public.tournament_predictions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- Suscripción realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.tournament_predictions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tournament_settings;
