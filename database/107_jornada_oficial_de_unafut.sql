-- =============================================================================
-- 107_jornada_oficial_de_unafut.sql
-- 28 sep 2026, a pedido del dueño: «que tome la jornada de UNAFUT y avise si
-- no coincide». Solo columnas nuevas, que nacen en NULL: no toca ninguna fila.
-- Idempotente.
-- =============================================================================
--
-- · `matches.jornada_oficial`: la jornada del calendario de UNAFUT. La llena
--   el backend (`jornadas_unafut.refrescar_jornadas_oficiales`) cada 6 h y el
--   sync la usa en vez de la calculada por fechas, cuando es seguro (partido
--   sin empezar y sin ningún ×2).
-- · `tournaments.unafut_jornadas_at`: cuándo se bajaron por última vez.
-- · `tournaments.unafut_aviso_firma`: qué diferencias ya se le avisaron al
--   admin, para no repetir el mismo aviso en cada pasada.
-- El cliente no las escribe: `matches` solo tiene UPDATE de 12 columnas (105)
-- y `tournaments` no tiene política de escritura.
-- =============================================================================

BEGIN;

ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS jornada_oficial integer;
COMMENT ON COLUMN public.matches.jornada_oficial IS
  'Jornada según el calendario oficial de UNAFUT (migración 107). Manda sobre la calculada por fechas cuando el partido no empezó y no tiene ×2.';

ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS unafut_jornadas_at timestamptz;
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS unafut_aviso_firma text;

DO $comprobar$
BEGIN
  IF has_column_privilege('authenticated', 'public.matches', 'jornada_oficial', 'UPDATE') THEN
    RAISE EXCEPTION '107: el cliente puede escribir jornada_oficial'; END IF;
  IF has_table_privilege('authenticated', 'public.tournaments', 'UPDATE')
     AND EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tournaments' AND cmd IN ('UPDATE', 'ALL')
                 AND NOT ('service_role' = ANY (roles))) THEN
    RAISE EXCEPTION '107: el cliente puede escribir tournaments'; END IF;
END
$comprobar$;

COMMIT;
