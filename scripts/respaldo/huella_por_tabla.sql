-- Huella por tabla: SOLO LECTURA y sin datos de personas.
--
-- Para comprobar que una copia restaurada es IGUAL a producción: se corre en
-- las dos bases y las filas tienen que coincidir una por una (filas y md5).
-- Una restauración «que no dio error» no es una restauración verificada.
--
-- El md5 es de todas las filas de la tabla como jsonb, ordenadas por su texto,
-- así que no depende del orden físico ni de los índices. Devuelve solo números
-- y hashes: se puede pegar en un informe.
--
-- Fuera de `public` se cuentan las filas de lo que la app necesita de Auth y
-- Storage, y las tareas de pg_cron: en una COPIA, `cron_job` tiene que dar 0
-- (ver docs/RESPALDO_RESTAURABLE_2026-10-20.md: una copia con el cron activo
-- llama al backend de producción cada minuto).
with tablas as (
  select c.relname::text as t
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p'))
select 'public.' || t as tabla,
       (xpath('/row/n/text()', query_to_xml(format(
          'select count(*) as n from public.%I', t), false, true, '')))[1]::text::bigint as filas,
       (xpath('/row/h/text()', query_to_xml(format(
          'select coalesce(md5(string_agg(r, chr(10) order by r)), ''vacia'') as h '
          'from (select to_jsonb(x)::text as r from public.%I x) s', t), false, true, '')))[1]::text as md5
from tablas
union all select 'auth.users', (select count(*) from auth.users), null
union all select 'auth.identities', (select count(*) from auth.identities), null
union all select 'storage.objects', (select count(*) from storage.objects), null
union all select 'cron.job', (select count(*) from cron.job), null
order by 1;
