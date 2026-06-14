-- =============================================================================
-- Migración: goleadores en vivo (events_json)
-- Ejecutar en el SQL Editor de Supabase
-- =============================================================================

-- Lista de goles del partido (desde ESPN): jugador, minuto, lado, penal/autogol.
-- Ej: [{"side":"home","player":"...","minute":"27'","penalty":false,"own_goal":false}]
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS events_json JSONB;

NOTIFY pgrst, 'reload schema';
