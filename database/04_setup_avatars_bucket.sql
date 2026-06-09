-- Crear el bucket de almacenamiento (storage)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Borrar políticas previas (si existen)
DROP POLICY IF EXISTS "Avatar images are publicly accessible." ON storage.objects;
DROP POLICY IF EXISTS "Users can upload an avatar." ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own avatar." ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own avatar." ON storage.objects;

-- 1. Política de LECTURA: Cualquiera puede ver las fotos (necesario para el Ranking)
CREATE POLICY "Avatar images are publicly accessible."
  ON storage.objects FOR SELECT
  USING ( bucket_id = 'avatars' );

-- 2. Política de INSERCIÓN: Sólo los dueños (usuarios autenticados) pueden subir su avatar
CREATE POLICY "Users can upload an avatar."
  ON storage.objects FOR INSERT
  WITH CHECK ( bucket_id = 'avatars' AND auth.uid() = owner );

-- 3. Política de ACTUALIZACIÓN: Sólo los dueños pueden cambiar su foto
CREATE POLICY "Users can update their own avatar."
  ON storage.objects FOR UPDATE
  USING ( bucket_id = 'avatars' AND auth.uid() = owner );

-- 4. Política de BORRADO: Sólo los dueños pueden borrar su foto
CREATE POLICY "Users can delete their own avatar."
  ON storage.objects FOR DELETE
  USING ( bucket_id = 'avatars' AND auth.uid() = owner );
