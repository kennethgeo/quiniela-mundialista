# Aplicar migraciones en Supabase — Quiniela Mundialista

**Proyecto:** `wifjwtbzstbuiistcxkf` — Quiniela Mundialista 2026.

Las migraciones 61–69 ya forman parte del estado esperado. No se inventan ni
reparan filas en `supabase_migrations`: si el historial difiere de los objetos
reales, se reporta. El inventario canónico de solo lectura es
`database/verificar_estado.sql`.

## Migración pendiente de este cambio

`database/70_endurecer_avatares_y_search_path.sql`

Aplicarla completa, sin modificarla y únicamente después de que el frontend que
comprime avatares a WebP esté desplegado. Es idempotente y no altera perfiles,
predicciones, puntos ni archivos existentes.

Hace cuatro cosas:

1. Limita nuevas subidas a `avatars` a 1 MB y a JPEG, PNG o WebP.
2. Agrega `WITH CHECK` a la política de actualización de avatares.
3. Fija `search_path` en los cinco helpers señalados por el asesor.
4. Revoca escritura directa de `anon` sobre tablas de `public`; el alta de
   usuarios sigue ocurriendo mediante Supabase Auth y su trigger.

Debe terminar con estos avisos, sin excepciones:

```text
NOTICE: Avatares: máximo 1 MB, solo JPEG/PNG/WebP y UPDATE con WITH CHECK.
NOTICE: Search path fijo en los cinco helpers auditados.
NOTICE: anon no conserva escritura directa sobre tablas del esquema public.
```

## Antes de aplicar

Guardar y reportar los conteos, sin exponer datos personales:

```sql
select 'users' objeto, count(*) cantidad from public.users
union all select 'leagues', count(*) from public.leagues
union all select 'league_members', count(*) from public.league_members
union all select 'predictions', count(*) from public.predictions
union all select 'tournament_predictions', count(*) from public.tournament_predictions
union all select 'matches', count(*) from public.matches
union all select 'storage.objects/avatars', count(*) from storage.objects where bucket_id='avatars';
```

## Verificación final

```sql
-- 1. Debe ser público, 1048576 y tres MIME types.
select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id='avatars';

-- 2. UPDATE debe tener USING y WITH CHECK con bucket_id + auth.uid/owner.
select policyname, cmd, qual, with_check
from pg_policies
where schemaname='storage' and tablename='objects'
  and policyname='Users can update their own avatar.';

-- 3. Cinco filas con search_path=pg_catalog, public.
select p.oid::regprocedure as funcion, p.proconfig
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('update_updated_at','log_prediction_changes',
                    'congelar_campos_sensibles_users','clave_fase',
                    'powerup_limits_valido')
order by 1;

-- 4. Debe salir vacío.
select c.relname
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r'
  and (has_table_privilege('anon',c.oid,'INSERT')
    or has_table_privilege('anon',c.oid,'UPDATE')
    or has_table_privilege('anon',c.oid,'DELETE'));

-- 5. Inventario completo.
\i database/verificar_estado.sql
```

Repetir los conteos previos: deben ser idénticos. Luego ejecutar los asesores de
seguridad y rendimiento y probar login, Hub, guardado de predicción, Tabla,
Histórico, Jornadas, Pozo, Medallas, perfil por quiniela, detalle de partido y
marcador en vivo.

Si cualquier comprobación no coincide, detenerse y reportar el texto exacto. No
otorgar permisos sueltos ni compensar una falla con cambios manuales.
