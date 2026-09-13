-- =============================================================================
-- 80_leer_creditos_no_puede_escribir.sql
-- `my_powerup_credits` devolvía HTTP 400 a casi todo el grupo: una LECTURA que
-- llamaba por dentro a una función reservada para el admin. Quita esa llamada.
-- Idempotente y sin tocar una sola fila de datos.
-- =============================================================================
--
-- QUÉ PASABA (medido en producción el 12 sep 2026, no supuesto):
--   · `my_powerup_credits(league)` la llama GroupPage en CADA carga de una
--     quiniela, para pintar los créditos de ×2 arrastrados de un partido
--     cancelado.
--   · Desde la migración 50 arrastraba un "self-heal perezoso":
--         PERFORM public.resolve_pending_powerup_credits(v_tid);
--   · La migración 61 le puso portero a ESA función —«Solo un administrador
--     puede resolver créditos pendientes»— porque antes no comprobaba nada.
--     Nadie se acordó de que la llamaba una lectura que hace cualquiera.
--   · `RAISE EXCEPTION` en plpgsql sale como SQLSTATE **P0001**, y PostgREST
--     lo traduce a **HTTP 400**. No es un error de permisos que se vea como
--     tal: es la consulta entera que falla.
--   · Hay **1 admin global y 23 usuarios que no lo son**: 23 de cada 24
--     cargas de quiniela recibían 400. `edge_logs` tenía **77 respuestas 400**
--     de esa RPC desde muchos dispositivos distintos, con algún 200 suelto
--     —el del admin—. En `postgres_logs` no aparece ningún ERROR, que es justo
--     lo que se espera de un P0001 traducido por PostgREST.
--   · El frontend lo descarta en silencio (`data = {}` por defecto), así que
--     el síntoma visible no era un error sino un número de menos: hoy hay
--     **3 créditos sin consumir** (Bundestica, fase regular, jornada 2) que
--     sus dueños no ven. Un crédito que no se ve es un comodín que no se usa.
--
-- POR QUÉ SE QUITA Y NO SE ARREGLA EL PORTERO: una lectura no escribe. El
-- portero de `resolve_pending_powerup_credits` está bien puesto —esa función
-- ESCRIBE sobre los créditos de todo un torneo— y aflojarlo para que pase
-- cualquier jugador sería abrir de verdad lo que hoy solo parece roto.
--
-- QUIÉN RESUELVE LOS PENDIENTES AHORA: los syncs del backend, que corren con
-- `service_role` y por lo tanto pasan `es_backend()`:
--   · `espn_tournament_sync.py` lo llama con el torneo que acaba de sincronizar,
--     cada vez que escribe fixtures (pg_cron, cada minuto si hay algo que hacer).
--   · `live_sync.py` lo llama con el Mundial (tid=1), que es SU torneo.
-- Comprobado además que hoy hay **0 créditos pendientes** (`phase IS NULL`):
-- nadie depende de que una lectura los resuelva de paso.
--
-- DE PASO QUEDA `STABLE`: ya no escribe nada, y así lo dice la firma. Es el
-- cambio de volatilidad el que la vuelve imposible de usar para escribir sin
-- que Postgres avise.
--
-- CREATE OR REPLACE, NUNCA DROP + CREATE: `DROP` reabre el ACL a PUBLIC
-- (comprobado, migración 66) y esta función solo debe poder ejecutarla
-- `authenticated`. La firma y el tipo de retorno quedan idénticos, así que
-- `CREATE OR REPLACE` es legal y el permiso se conserva tal cual.

BEGIN;

CREATE OR REPLACE FUNCTION public.my_powerup_credits(p_league_id uuid)
RETURNS TABLE (phase text, matchday integer, credits integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  -- Solo LEE. Los créditos pendientes (phase IS NULL) los resuelve el backend
  -- desde los syncs; acá ni se muestran ni se podrían usar todavía.
  RETURN QUERY
    SELECT pc.phase, pc.matchday, count(*)::int
    FROM public.powerup_credits pc
    WHERE pc.user_id = auth.uid() AND pc.league_id = p_league_id
      AND pc.consumed_at IS NULL AND pc.phase IS NOT NULL
    GROUP BY pc.phase, pc.matchday;
END;
$$;

COMMENT ON FUNCTION public.my_powerup_credits(uuid) IS
  'Créditos de ×2 sin consumir del usuario en una quiniela. Solo lectura: '
  'llamar acá a resolve_pending_powerup_credits daba HTTP 400 a quien no es '
  'admin global (migración 80).';

DO $verificar$
DECLARE
  v_src   text;
  v_acl   text;
BEGIN
  SELECT p.prosrc INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'my_powerup_credits';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'my_powerup_credits no existe';
  END IF;

  -- Lo que de verdad hay que impedir que vuelva: una lectura que llame al
  -- resolver. Se mide el CUERPO, no que la pantalla funcione hoy.
  IF v_src ILIKE '%resolve_pending_powerup_credits%' THEN
    RAISE EXCEPTION 'my_powerup_credits sigue llamando al resolver: devolvera 400 a quien no sea admin';
  END IF;

  SELECT array_to_string(p.proacl, ',') INTO v_acl
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'my_powerup_credits';

  -- El ACL tiene que haber sobrevivido al REPLACE: la pantalla la llama
  -- `authenticated`, y `anon`/PUBLIC no pintan nada acá.
  IF v_acl IS NULL OR v_acl NOT LIKE '%authenticated=X%' THEN
    RAISE EXCEPTION 'my_powerup_credits perdio el EXECUTE de authenticated (acl: %)', COALESCE(v_acl, 'ninguno');
  END IF;
  -- PUBLIC se escribe con el beneficiario VACÍO ('=X/postgres'), así que se
  -- busca al principio de la cadena y después de cualquier coma.
  IF v_acl LIKE '%anon=X%' OR v_acl LIKE '%,=X%' OR v_acl LIKE '=X%' THEN
    RAISE EXCEPTION 'my_powerup_credits quedo abierta a anon/PUBLIC (acl: %)', v_acl;
  END IF;

  -- El portero del resolver NO se toca: sigue siendo solo para el backend o
  -- el admin global. Si esto deja de ser cierto, el arreglo de arriba estaría
  -- tapando un agujero en vez de cerrarlo.
  SELECT p.prosrc INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'resolve_pending_powerup_credits';

  IF v_src IS NULL OR v_src NOT ILIKE '%es_backend()%' THEN
    RAISE EXCEPTION 'resolve_pending_powerup_credits perdio su comprobacion de quien llama';
  END IF;

  RAISE NOTICE 'my_powerup_credits ya solo lee. Ninguna fila modificada.';
END $verificar$;

COMMIT;

NOTIFY pgrst, 'reload schema';
