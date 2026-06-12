-- =============================================================================
-- Migración: soporte de marcador en vivo (minuto + throttle de refresco)
-- Ejecutar en el SQL Editor de Supabase
-- =============================================================================

-- Minuto/estado del reloj del partido (ej. "45", "HT", "90+2"). Null si no aplica.
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS minute TEXT;

-- Estado de la última sincronización en vivo, para limitar la frecuencia del
-- endpoint público de refresco (lo usa el backend con service_role).
CREATE TABLE IF NOT EXISTS public.live_sync_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_sync TIMESTAMPTZ
);
INSERT INTO public.live_sync_state (id, last_sync) VALUES (1, NULL) ON CONFLICT (id) DO NOTHING;

-- No exponer esta tabla al cliente (el backend la maneja con service_role).
ALTER TABLE public.live_sync_state ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
