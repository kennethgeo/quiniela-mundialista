-- =============================================================================
-- 70_endurecer_avatares_y_search_path.sql
-- Límites de subida para avatares + search_path fijo en helpers señalados.
-- =============================================================================
-- No cambia perfiles ni objetos existentes. El bucket sigue siendo público para
-- que rankings y perfiles puedan mostrar fotos; solo se restringen las subidas.
-- Idempotente.

UPDATE storage.buckets
SET file_size_limit = 1048576,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
WHERE id = 'avatars';

DO $bucket$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'avatars') THEN
    RAISE EXCEPTION 'No existe el bucket avatars; ejecutar primero 04_setup_avatars_bucket.sql';
  END IF;
END $bucket$;

-- UPDATE necesita validar tanto la fila anterior como la nueva. Sin WITH CHECK,
-- una actualización autorizada por la fila vieja no vuelve a comprobar que el
-- objeto permanezca en avatars y conserve al mismo dueño.
DROP POLICY IF EXISTS "Users can update their own avatar." ON storage.objects;
CREATE POLICY "Users can update their own avatar."
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND auth.uid() = owner)
  WITH CHECK (bucket_id = 'avatars' AND auth.uid() = owner);

-- Fijar el camino de resolución evita que un objeto con nombre malicioso en un
-- esquema anterior suplante tablas o funciones usadas por estos helpers.
ALTER FUNCTION public.update_updated_at()                  SET search_path TO pg_catalog, public;
ALTER FUNCTION public.log_prediction_changes()             SET search_path TO pg_catalog, public;
ALTER FUNCTION public.congelar_campos_sensibles_users()     SET search_path TO pg_catalog, public;
ALTER FUNCTION public.clave_fase(text, text)                SET search_path TO pg_catalog, public;
ALTER FUNCTION public.powerup_limits_valido(jsonb)          SET search_path TO pg_catalog, public;

-- La app no escribe tablas públicas antes de iniciar sesión. RLS ya cerraba
-- estas operaciones, pero retirar el privilegio base evita depender de que
-- cada política presente y futura sea perfecta.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon;

DO $verify$
DECLARE
  v_bucket_ok boolean;
  v_policy_ok boolean;
  v_mutables text[];
  v_anon_writable text[];
BEGIN
  SELECT file_size_limit = 1048576
     AND allowed_mime_types @> ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
     AND cardinality(allowed_mime_types) = 3
  INTO v_bucket_ok
  FROM storage.buckets WHERE id = 'avatars';

  SELECT with_check IS NOT NULL
     AND with_check LIKE '%bucket_id%avatars%'
     AND with_check LIKE '%auth.uid()%owner%'
  INTO v_policy_ok
  FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'Users can update their own avatar.' AND cmd = 'UPDATE';

  SELECT array_agg(p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text)
  INTO v_mutables
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = ANY (ARRAY['update_updated_at', 'log_prediction_changes',
                               'congelar_campos_sensibles_users', 'clave_fase',
                               'powerup_limits_valido'])
    AND NOT ('search_path=pg_catalog, public' = ANY (COALESCE(p.proconfig, ARRAY[]::text[])));

  SELECT array_agg(c.relname ORDER BY c.relname)
  INTO v_anon_writable
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND (has_table_privilege('anon', c.oid, 'INSERT')
      OR has_table_privilege('anon', c.oid, 'UPDATE')
      OR has_table_privilege('anon', c.oid, 'DELETE'));

  IF COALESCE(v_bucket_ok, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'El bucket avatars no quedó limitado a 1 MB y tres tipos de imagen';
  END IF;
  IF COALESCE(v_policy_ok, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'La política UPDATE de avatars no quedó con WITH CHECK';
  END IF;
  IF v_mutables IS NOT NULL THEN
    RAISE EXCEPTION 'Funciones que siguen con search_path mutable: %', v_mutables;
  END IF;
  IF v_anon_writable IS NOT NULL THEN
    RAISE EXCEPTION 'Tablas públicas que anon todavía puede escribir: %', v_anon_writable;
  END IF;

  RAISE NOTICE 'Avatares: máximo 1 MB, solo JPEG/PNG/WebP y UPDATE con WITH CHECK.';
  RAISE NOTICE 'Search path fijo en los cinco helpers auditados.';
  RAISE NOTICE 'anon no conserva escritura directa sobre tablas del esquema public.';
END $verify$;

NOTIFY pgrst, 'reload schema';
