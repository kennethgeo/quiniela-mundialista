-- =============================================================================
-- 102_el_cliente_no_vacia_tablas.sql
-- Decimoséptima auditoría (Claude, 27 sep 2026). Solo PERMISOS: no toca ni
-- una fila. Idempotente.
-- =============================================================================
--
-- `authenticated` tenía TRUNCATE sobre 17 tablas de `public` —entre ellas
-- `users`, `matches`, `tournaments`, `powerup_credits`, `rule_votes`— además
-- de TRIGGER y REFERENCES sobre 22. Son los permisos que Supabase otorga por
-- defecto a las tablas nuevas, y ninguna migración los había quitado.
--
-- TRUNCATE NO PASA POR LA RLS: las políticas filtran filas y TRUNCATE no mira
-- filas, vacía la tabla entera. Hoy NO es alcanzable desde la app —PostgREST
-- no ofrece TRUNCATE y ninguna función ejecuta SQL armado a mano (comprobado:
-- cero funciones con EXECUTE dinámico o TRUNCATE en `public`)—, así que es un
-- permiso latente, no un agujero abierto. Pero es exactamente el permiso que
-- borra todo de un saque, y no lo usa nadie: la app nunca vacía una tabla, y
-- TRIGGER/REFERENCES solo sirven para cambiar la estructura (crear triggers o
-- claves foráneas), cosa que el cliente no hace.
--
-- Se quitan de las tablas actuales y de las que se creen de acá en adelante
-- (privilegios por defecto del rol que corre las migraciones). SELECT,
-- INSERT, UPDATE y DELETE no se tocan: esos siguen gobernados por la RLS y
-- por los privilegios por columna de las migraciones 61/85/87.
-- =============================================================================

BEGIN;

REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon, authenticated;

DO $comprobar$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
     AND privilege_type IN ('TRUNCATE', 'TRIGGER', 'REFERENCES');
  IF n > 0 THEN RAISE EXCEPTION '102: quedan % permisos de TRUNCATE/TRIGGER/REFERENCES para el cliente', n; END IF;
  -- Lo que la app SÍ usa sigue en pie.
  IF NOT has_any_column_privilege('authenticated', 'public.predictions', 'INSERT')
     OR NOT has_any_column_privilege('authenticated', 'public.predictions', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.push_subscriptions', 'DELETE') THEN
    RAISE EXCEPTION '102: se tocó un permiso que la app necesita';
  END IF;
END
$comprobar$;

COMMIT;
