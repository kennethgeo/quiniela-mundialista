-- =============================================================================
-- MIGRACIÓN A CHAT GLOBAL
-- Convierte el chat de partidos en una sala global desplegable.
-- =============================================================================

-- 1. Renombrar la tabla
ALTER TABLE public.match_comments RENAME TO global_chat;

-- 2. Eliminar la dependencia del partido
-- Primero quitamos la restricción de llave foránea (el nombre puede variar según cómo la creó Supabase, 
-- pero usualmente podemos simplemente eliminar la columna que borra la restricción).
ALTER TABLE public.global_chat DROP COLUMN match_id CASCADE;

-- 3. Actualizar comentarios de la tabla
COMMENT ON TABLE public.global_chat IS 'Chat global de la liga';

-- Las políticas RLS y la configuración de Realtime se mantienen 
-- (aunque cambie el nombre de la tabla internamente en Postgres).
-- Sin embargo, para estar seguros de que Realtime lo toma con el nuevo nombre:
ALTER PUBLICATION supabase_realtime ADD TABLE public.global_chat;
