-- Respaldo semanal de Tico Games: DOS consultas de SOLO LECTURA.
-- Se mandan por separado con la herramienta de Supabase (execute_sql).
-- El `repeat(' ', 120000)` fuerza que la respuesta, grande, se guarde en un
-- archivo en vez de entrar a la conversación; generar.py lo lee de ahí.
-- NO incluye correos ni llaves de push (ver README).
--
-- ES UNA FOTO DE DATOS, NO UN DUMP: no trae esquema, funciones, políticas,
-- triggers, Auth ni Storage, y no se restaura sola. Ver «Qué NO es» en el README.
--
-- Desde el 20 oct 2026 la consulta 2 es DINÁMICA: recorre todas las tablas de
-- `public` y saca TODAS sus columnas menos las excluidas abajo. Antes nombraba
-- columnas a mano y se fue quedando atrás: a `matches` le faltaban
-- `destapado_at` y `jornada_oficial`, a `tournaments` `unafut_jornadas_at`,
-- `unafut_aviso_firma` y `logo_url`, y `live_sync_state` no estaba ni contada.
-- Con la 109, `historial_pagos` habría quedado afuera sin aviso.
-- `query_to_xml` ejecuta la lectura de cada tabla por nombre (solo SELECT); el
-- JSON viaja en base64 para que el XML no altere ningún carácter.

-- === CONSULTA 1: predicciones ===
select json_build_object(
 'predictions', (select json_agg(x order by x.league_id, x.match_id, x.user_id) from predictions x)
)::text || repeat(' ', 120000) as datos;

-- === CONSULTA 2: todo lo demás ===
with
-- Tablas que NO van, a propósito (solo se cuentan). `predictions` va en la 1.
excluidas(t) as (values
  ('predictions'), ('banned_emails'), ('push_subscriptions'), ('prediction_logs'),
  ('players'), ('match_details_cache'), ('notification_deliveries'), ('powerup_limits')),
-- Columnas que no van. Todo lo demás de la tabla va, también lo que se agregue.
sin_columnas(t, cols) as (values
  ('users',   array['email']),
  ('matches', array['events_json', 'minute', 'home_flag_url', 'away_flag_url'])),
tablas as (
  select c.relname::text as t
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p'))
select json_build_object(
 'generado_at', now(),
 'tablas_publicas', (select json_agg(t order by t) from tablas),
 'excluidas', (select json_agg(t order by t) from excluidas),
 'datos', (
   select json_object_agg(tb.t, convert_from(decode(
     (xpath('/row/j/text()', query_to_xml(format(
       'select encode(convert_to(coalesce(json_agg(r order by r::text)::text, ''[]''), ''UTF8''), ''base64'') as j '
       'from (select to_jsonb(x) - %L::text[] as r from public.%I x) s',
       coalesce(sc.cols, '{}'::text[]), tb.t), false, true, '')))[1]::text,
     'base64'), 'UTF8')::json)
   from tablas tb left join sin_columnas sc on sc.t = tb.t
   where tb.t not in (select t from excluidas)),
 'conteos_excluidos', (
   select json_object_agg(tb.t, (xpath('/row/n/text()', query_to_xml(format(
       'select count(*) as n from public.%I', tb.t), false, true, '')))[1]::text::bigint)
   from tablas tb where tb.t in (select t from excluidas) and tb.t <> 'predictions')
)::text || repeat(' ', 120000) as datos;
