-- =============================================================================
-- 78_cache_detalle_partido.sql
-- Caché del detalle que ESPN da de un partido (alineaciones, estadísticas,
-- forma reciente, historial). Tabla nueva, vacía: no toca ningún dato.
-- Idempotente.
-- =============================================================================
--
-- POR QUÉ HACE FALTA CACHÉ: el detalle sale de un `summary` de ESPN de ~200 KB
-- por partido. La pantalla de detalle se refresca cada 30 s mientras el partido
-- está en curso, así que sin caché cada persona mirando dispara dos llamadas
-- por minuto a ESPN. Con diez mirando son veinte por minuto para traer lo
-- mismo.
--
-- POR QUÉ UNA TABLA APARTE Y NO DOS COLUMNAS EN `matches`: `GroupPage` hace
-- `select('*')` sobre los partidos del torneo —144 en la Champions— así que un
-- jsonb pegado ahí viajaría entero al navegador de todos, en cada carga, para
-- una pantalla que ni lo usa.
--
-- NADIE LA LEE DESDE EL CLIENTE. La escribe y la lee el backend, que corre con
-- service_role; el navegador pide el detalle por el endpoint, nunca la tabla.
-- Por eso queda con RLS activa y SIN una sola política: `anon` y
-- `authenticated` no pueden ni mirarla.

BEGIN;

CREATE TABLE IF NOT EXISTS public.match_details_cache (
  match_id    integer PRIMARY KEY REFERENCES public.matches(id) ON DELETE CASCADE,
  payload     jsonb       NOT NULL,
  fetched_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.match_details_cache IS
  'Detalle de ESPN por partido, ya recortado. Lo llena el backend; el cliente '
  'lo pide por /api/matches/{id}/detalle y NUNCA lee esta tabla. Se puede '
  'vaciar entera sin perder nada: se vuelve a llenar sola.';

-- Para barrer lo viejo sin recorrer toda la tabla.
CREATE INDEX IF NOT EXISTS match_details_cache_fetched_idx
  ON public.match_details_cache (fetched_at);

ALTER TABLE public.match_details_cache ENABLE ROW LEVEL SECURITY;

-- Sin políticas = nadie pasa salvo service_role, que las saltea por diseño.
-- Se revocan igual los privilegios de tabla: RLS sin GRANT es cinturón y
-- tirantes, y este repo ya vio nacer objetos abiertos a `anon` por omisión.
REVOKE ALL ON public.match_details_cache FROM PUBLIC, anon, authenticated;

DO $verificar$
DECLARE v_rls boolean; v_pol integer; v_anon boolean; v_auth boolean;
BEGIN
  SELECT relrowsecurity INTO v_rls
  FROM pg_class WHERE oid = 'public.match_details_cache'::regclass;
  IF NOT v_rls THEN RAISE EXCEPTION 'match_details_cache quedo sin RLS'; END IF;

  SELECT count(*) INTO v_pol FROM pg_policy
  WHERE polrelid = 'public.match_details_cache'::regclass;
  IF v_pol > 0 THEN
    RAISE EXCEPTION 'match_details_cache tiene % politicas: deberia no tener ninguna', v_pol;
  END IF;

  SELECT has_table_privilege('anon', 'public.match_details_cache', 'SELECT') INTO v_anon;
  SELECT has_table_privilege('authenticated', 'public.match_details_cache', 'SELECT') INTO v_auth;
  IF v_anon OR v_auth THEN
    RAISE EXCEPTION 'match_details_cache es legible desde el cliente';
  END IF;

  RAISE NOTICE 'Cache del detalle lista, vacia y cerrada al cliente. Ninguna fila modificada.';
END $verificar$;

COMMIT;

NOTIFY pgrst, 'reload schema';
