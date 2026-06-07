-- =============================================================================
-- MIGRACIÓN PARA EL MINI-CHAT SOCIAL DE PARTIDOS
-- Crea la tabla de comentarios y habilita la transmisión en tiempo real.
-- =============================================================================

-- 1. Crear tabla de comentarios
CREATE TABLE IF NOT EXISTS public.match_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  match_id INTEGER REFERENCES public.matches(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL CHECK (char_length(content) > 0 AND char_length(content) <= 500),
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.match_comments IS 'Mini-chat social (banter) para cada partido';

-- 2. Habilitar Seguridad por Fila (RLS)
ALTER TABLE public.match_comments ENABLE ROW LEVEL SECURITY;

-- 3. Políticas
-- Cualquier usuario autenticado puede ver los comentarios de cualquier partido
CREATE POLICY "comments_select_all"
  ON public.match_comments FOR SELECT
  TO authenticated
  USING (true);

-- Un usuario solo puede insertar comentarios a su propio nombre
CREATE POLICY "comments_insert_own"
  ON public.match_comments FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Opcional: Un usuario puede borrar sus propios comentarios
CREATE POLICY "comments_delete_own"
  ON public.match_comments FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- 4. Habilitar Realtime para esta tabla
-- Esto permite que el chat se actualice en vivo sin recargar la página
ALTER PUBLICATION supabase_realtime ADD TABLE public.match_comments;
