-- Huella por tabla: SOLO LECTURA y sin datos de personas.
--
-- Para comprobar que una copia restaurada es IGUAL a la captura: se corre en
-- la copia y DENTRO DE LA MISMA INSTANTÁNEA que usó el volcado (ver
-- docs/RESPALDO_RESTAURABLE_2026-10-20.md, «Captura consistente»), y las
-- filas tienen que coincidir una por una (filas y md5). Una huella tomada
-- antes o después del volcado, con la base viva, no prueba nada.
--
-- El md5 es de todas las filas de la tabla como jsonb, ordenadas por su texto,
-- así que no depende del orden físico ni de los índices. Devuelve solo números
-- y hashes: se puede pegar en un informe.
--
-- Fuera de `public` van Auth y Storage (lo que la app necesita) y `cron.job`.
-- Una tabla que no existe sale con md5 `no-existe` y filas NULL: en la COPIA,
-- `cron.job` tiene que salir así (el destino no lleva pg_cron).
with tablas as (
  select n.nspname::text as esq, c.relname::text as t
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
  union all
  select split_part(x, '.', 1), split_part(x, '.', 2)
  from unnest(array['auth.users', 'auth.identities', 'storage.buckets',
                    'storage.objects', 'cron.job']) x)
select esq || '.' || t as tabla,
       case when to_regclass(format('%I.%I', esq, t)) is not null then
         (xpath('/row/n/text()', query_to_xml(format(
            'select count(*) as n from %I.%I', esq, t), false, true, '')))[1]::text::bigint
       end as filas,
       case when to_regclass(format('%I.%I', esq, t)) is null then 'no-existe' else
         (xpath('/row/h/text()', query_to_xml(format(
            'select coalesce(md5(string_agg(r, chr(10) order by r)), ''vacia'') as h '
            'from (select to_jsonb(x)::text as r from %I.%I x) s', esq, t), false, true, '')))[1]::text
       end as md5
from tablas
order by 1;
