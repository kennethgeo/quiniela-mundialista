-- SOLO LECTURA. No es una migración ni autoriza eliminación de objetos.
-- La ausencia de referencia en users no demuestra ausencia de enlaces
-- compartidos, cachés o referencias fuera de la app.
WITH objetos AS (
  SELECT o.id, o.name, o.owner, o.owner_id, o.updated_at,
         COALESCE((o.metadata->>'size')::bigint, 0) AS bytes,
         ARRAY(SELECT u.id FROM public.users u
               WHERE split_part(u.avatar_url, '?', 1) =
                 'https://wifjwtbzstbuiistcxkf.supabase.co/storage/v1/object/public/avatars/' || o.name
               ORDER BY u.id) AS referencias_exactas,
         EXISTS(SELECT 1 FROM public.users u
                WHERE position(o.name IN COALESCE(u.avatar_url, '')) > 0) AS referencia_amplia,
         EXISTS(SELECT 1 FROM auth.users a
                WHERE position(o.name IN COALESCE(a.raw_user_meta_data::text, '')) > 0
                   OR position(o.name IN COALESCE(a.raw_app_meta_data::text, '')) > 0) AS referencia_auth,
         EXISTS(SELECT 1 FROM auth.identities a
                WHERE position(o.name IN COALESCE(a.identity_data::text, '')) > 0) AS referencia_identidad
  FROM storage.objects o WHERE o.bucket_id = 'avatars'
)
SELECT *,
  CASE
    WHEN cardinality(referencias_exactas) > 1 THEN 'conservar: referencia compartida'
    WHEN cardinality(referencias_exactas) = 1 THEN
      CASE
        WHEN owner IS NULL AND owner_id IS NULL
          AND left(name, 37) = referencias_exactas[1]::text || '-'
          AND EXISTS(SELECT 1 FROM auth.users a WHERE a.id = referencias_exactas[1])
          THEN 'conservar: renovar mediante carga autenticada del usuario'
        WHEN owner_id = referencias_exactas[1]::text
          AND (owner IS NULL OR owner = referencias_exactas[1])
          THEN 'conservar: propietario coincide'
        ELSE 'conservar: revisar discrepancia de propietario'
      END
    WHEN referencia_amplia OR referencia_auth OR referencia_identidad THEN 'conservar: referencia alternativa'
    ELSE 'candidato a revisión: sin referencias comprobadas; NO borrar automáticamente'
  END AS decision
FROM objetos
ORDER BY decision, name;
