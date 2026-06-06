-- =============================================================================
-- Migración: Tabla de configuración global (Global Settings)
-- Ejecutar en el SQL Editor de Supabase
-- =============================================================================

-- 1. Crear tabla global_settings (Singleton)
CREATE TABLE public.global_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  
  -- Premios
  enable_prizes BOOLEAN DEFAULT false,
  prize_1st TEXT DEFAULT '',
  prize_2nd TEXT DEFAULT '',
  prize_3rd TEXT DEFAULT '',
  prize_4th TEXT DEFAULT '',
  
  -- Poderes y extras
  enable_powers BOOLEAN DEFAULT false,
  enable_champion_prediction BOOLEAN DEFAULT false,
  champion_prediction_points INTEGER DEFAULT 0,
  
  -- Links externos
  whatsapp_link TEXT DEFAULT '',
  telegram_link TEXT DEFAULT '',
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Insertar fila por defecto
INSERT INTO public.global_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 3. Políticas de seguridad (RLS)
ALTER TABLE public.global_settings ENABLE ROW LEVEL SECURITY;

-- Todos pueden leer la configuración global
CREATE POLICY "Todos pueden ver la configuración global"
ON public.global_settings FOR SELECT
USING (true);

-- Solo los administradores pueden actualizar la configuración
CREATE POLICY "Solo administradores pueden editar configuración"
ON public.global_settings FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.users 
    WHERE users.id = auth.uid() AND users.is_admin = true
  )
);
