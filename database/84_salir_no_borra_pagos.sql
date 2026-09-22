-- =============================================================================
-- 84_salir_no_borra_pagos.sql
-- Salirse de una quiniela no puede borrar la prueba de que pagaste.
-- Solo redefine una función. No toca ninguna fila de datos. Idempotente.
-- =============================================================================
--
-- LO QUE ABRIÓ LA MIGRACIÓN 83, UN DÍA ANTES. El control de pagos vive en
-- COLUMNAS de `league_members` (`pago_avisado_at`, `pago_confirmado_at`, y
-- quién confirmó — migración 58). Así que borrar la membresía borra también el
-- registro del pago.
--
-- Eso ya pasaba al expulsar, pero era una acción de admin y poco frecuente. La
-- 83 lo convirtió en autoservicio: desde ayer cualquiera puede borrar su propio
-- comprobante con un botón. Medido hoy: **13 pagos confirmados** en una quiniela
-- con cuota de ₡10.000 y 17 miembros.
--
-- En una quiniela por plata, que desaparezca la constancia de un pago es el
-- peor dato que se puede perder: deja la palabra de uno contra la del otro.
--
-- QUÉ SE HACE Y QUÉ NO. Esto NO es el arreglo de fondo — el de fondo es separar
-- el historial de pagos de la membresía activa (un registro aparte, o una
-- membresía inactiva), y está anotado en PLAN_ADMIN_Y_MEJORAS.md. Esto cierra
-- hoy la puerta que se abrió ayer, sin inventar una contabilidad nueva.
--
-- SE BLOQUEA POR `pago_confirmado_at`, NO POR `pago_avisado_at`, y la
-- diferencia importa:
--   · confirmado = un admin dio fe de que la plata se movió. Es un HECHO y no
--     puede evaporarse porque alguien pulse un botón.
--   · avisado = la persona dice que pagó y nadie lo confirmó todavía. Eso no
--     prueba nada, y además `avisar_pago` es autoservicio: bloquear por el
--     aviso dejaría que cualquiera se encierre solo en la quiniela sin poder
--     salir nunca.
--
-- LA EXPULSIÓN SE DEJA COMO ESTÁ, a propósito. Impedir que un admin expulse a
-- alguien que pagó lo dejaría sin salida para un caso real (pagó y después se
-- portó mal). Ese camino espera al registro histórico.

BEGIN;

CREATE OR REPLACE FUNCTION public.salir_de_quiniela(p_league_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_creador uuid;
  v_pagado timestamptz;
  v_predicciones integer;
  v_globales integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT admin_id INTO v_creador FROM public.leagues WHERE id = p_league_id;
  IF v_creador IS NULL THEN
    RAISE EXCEPTION 'Esa quiniela no existe';
  END IF;

  IF v_uid = v_creador THEN
    RAISE EXCEPTION 'Creaste esta quiniela, así que no podés salirte: o la dejás activa, o la borrás desde el panel de administración';
  END IF;

  SELECT pago_confirmado_at INTO v_pagado
    FROM public.league_members
   WHERE league_id = p_league_id AND user_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No sos miembro de esta quiniela';
  END IF;

  -- El portero nuevo. Mientras el pago viva en la fila de membresía, salirse
  -- sería borrar el comprobante.
  IF v_pagado IS NOT NULL THEN
    RAISE EXCEPTION 'Tenés un pago confirmado en esta quiniela: si salís se borraría ese registro. Hablá con un administrador antes de salir.';
  END IF;

  SELECT count(*) INTO v_predicciones FROM public.predictions
   WHERE league_id = p_league_id AND user_id = v_uid;
  SELECT count(*) INTO v_globales FROM public.tournament_predictions
   WHERE league_id = p_league_id AND user_id = v_uid;

  DELETE FROM public.predictions
   WHERE league_id = p_league_id AND user_id = v_uid;
  DELETE FROM public.tournament_predictions
   WHERE league_id = p_league_id AND user_id = v_uid;
  DELETE FROM public.league_members
   WHERE league_id = p_league_id AND user_id = v_uid;

  RETURN jsonb_build_object(
    'predicciones_borradas', v_predicciones,
    'globales_borradas', v_globales);
END;
$$;

COMMENT ON FUNCTION public.salir_de_quiniela(uuid) IS
  'Salida voluntaria. Borra predicciones y membresía propias; conserva los votos. '
  'Se niega si hay un pago confirmado: ese registro vive en league_members.';

-- `CREATE OR REPLACE` conserva el ACL, pero se reafirma por si acaso.
REVOKE ALL ON FUNCTION public.salir_de_quiniela(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salir_de_quiniela(uuid) TO authenticated;

DO $verificar$
DECLARE v_def text := pg_get_functiondef('public.salir_de_quiniela(uuid)'::regprocedure);
BEGIN
  IF v_def NOT LIKE '%pago_confirmado_at%' THEN
    RAISE EXCEPTION 'salir_de_quiniela dejó de mirar el pago confirmado';
  END IF;
  -- Y que NO se haya endurecido de más: bloquear por el aviso dejaría a alguien
  -- encerrado en su propia quiniela, porque `avisar_pago` es autoservicio.
  IF v_def LIKE '%pago_avisado_at%' THEN
    RAISE EXCEPTION 'salir_de_quiniela bloquea por el AVISO de pago, no solo por el confirmado';
  END IF;
  IF has_function_privilege('anon', 'public.salir_de_quiniela(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'salir_de_quiniela quedó alcanzable por anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.salir_de_quiniela(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'salir_de_quiniela no es ejecutable por authenticated';
  END IF;

  RAISE NOTICE 'Salir ya no puede borrar un pago confirmado. Ninguna fila modificada.';
END $verificar$;

NOTIFY pgrst, 'reload schema';
COMMIT;
