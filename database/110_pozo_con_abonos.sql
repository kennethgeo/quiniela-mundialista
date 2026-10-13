-- =============================================================================
-- 110_pozo_con_abonos.sql
-- Pedido del dueño (13 oct 2026): un tab propio para el pozo, donde el grupo
-- vea quién pagó y quién no, y donde se pueda avisar que se pagó solo una
-- parte —la mitad, o un monto cualquiera— para que un admin de la quiniela lo
-- confirme.
--
-- REQUIERE LA 109 (historial de pagos). Se aplica DESPUÉS de ella.
-- No modifica ni borra ninguna fila existente: una columna nueva que nace en
-- NULL, dos funciones nuevas, tres redefinidas con la MISMA firma (conservan
-- sus permisos) y el registro del historial. El bloque final compara una
-- huella de `league_members` y la cantidad de filas del historial tomadas al
-- empezar. Idempotente: corre dos veces seguidas.
-- =============================================================================
--
-- EL MODELO, y por qué este y no otro
--   · El total confirmado de cada persona sigue viviendo en
--     `league_members.pago_confirmado_monto`. Hasta acá era la cuota del día en
--     que se confirmó; ahora ACUMULA abonos. Así no cambia ni una de las
--     protecciones que miran «hay un pago confirmado» (no salir, no borrar la
--     quiniela, no borrar la cuenta, el candado de la cuota, el historial):
--     todas siguen mirando `pago_confirmado_at`, que se pone con el PRIMER
--     abono confirmado.
--   · Lo que el miembro AVISA va aparte: `pago_avisado_at` (como siempre) y
--     `pago_avisado_monto` (nuevo). NULL en el monto es un aviso de antes de
--     esta migración, o el botón de siempre: «lo que me falta».
--   · Un abono confirmado SUMA. El historial (109) lo anota como 'abono' con
--     el monto de ese abono y el total que queda; quitar un pago sigue
--     quitando TODO (y queda en el historial con lo que había).
--   · Una tabla de abonos aparte habría sido una segunda fuente de verdad de
--     «cuánto pagó cada quien» al lado de `pago_confirmado_monto`, que es la
--     que usan el pozo y todas las protecciones. Este repo ya pagó caro tener
--     una cuenta escrita dos veces.
--
-- QUÉ SE ESTADO TIENE CADA PERSONA (lo calcula `league_pozo`, una sola vez)
--   · pagado  : confirmado y el total llega a la cuota vigente.
--   · parcial : confirmado y el total no llega (pagó la mitad, por ejemplo).
--   · pendiente: nada confirmado.
--   El aviso es aparte y se puede combinar con «parcial»: pagó la mitad
--   (confirmada) y avisó la otra mitad (falta confirmar).
--   Si la cuota sube después, quien estaba al día pasa a «parcial»: debe la
--   diferencia. Es lo correcto, y la 88 ya impide que subir la cuota reescriba
--   lo recaudado.
--
-- CONFIRMAR UN ABONO (`confirmar_abono`)
--   · Solo un admin de la quiniela (`es_admin_liga`), nunca el propio pago.
--   · El total no puede pasar la cuota: un dedo de más (₡100.000 en vez de
--     ₡10.000) se rechaza con el número, no se guarda.
--   · `p_total_visto`: el total que el admin VIO al tocar. Si cambió en el
--     medio —otro admin confirmó el mismo aviso, o un doble toque—, se
--     rechaza en vez de sumar dos veces. Es el mismo criterio que el
--     `esperado` del reparto de globales (auditoría 20).
--   · Orden de candados de la 91: la quiniela FOR SHARE primero, después la
--     fila del miembro FOR UPDATE.
--
-- AVISAR (`avisar_abono`)
--   · Solo el propio miembro, con un monto > 0 que no pase lo que le falta.
--   · `avisar_pago(…, false)` (retirar el aviso) ahora borra también el monto.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '10s';

DO $requiere$
BEGIN
  IF to_regclass('public.historial_pagos') IS NULL THEN
    RAISE EXCEPTION '110: aplicá antes la 109 (historial de pagos)';
  END IF;
END
$requiere$;

-- Huella de lo que NO se puede tocar (columnas explícitas: la columna nueva
-- cambiaría `lm::text` aunque no se escriba nada).
SELECT set_config('m110.huella_miembros',
         COALESCE((SELECT md5(string_agg(concat_ws('|', lm.league_id, lm.user_id, lm.joined_at,
                     lm.rules_accepted_at, lm.pago_avisado_at, lm.pago_confirmado_at,
                     lm.pago_confirmado_por, lm.es_admin, lm.pago_confirmado_monto,
                     lm.pago_confirmado_moneda), '#' ORDER BY lm.league_id, lm.user_id))
                     FROM public.league_members lm), 'vacia'), true),
       set_config('m110.historial', (SELECT count(*) FROM public.historial_pagos)::text, true);

-- 1. Lo que el miembro avisa ----------------------------------------------------
ALTER TABLE public.league_members ADD COLUMN IF NOT EXISTS pago_avisado_monto numeric;
COMMENT ON COLUMN public.league_members.pago_avisado_monto IS
  'Cuánto avisó el miembro que pagó, pendiente de confirmar. NULL con aviso = «lo que me falta» (migración 110).';
DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pago_avisado_monto_positivo') THEN
    ALTER TABLE public.league_members ADD CONSTRAINT pago_avisado_monto_positivo
      CHECK (pago_avisado_monto IS NULL OR (pago_avisado_monto > 0 AND pago_avisado_monto <= 100000000));
  END IF;
END
$chk$;

-- 2. El historial distingue un abono de una confirmación nueva -----------------
ALTER TABLE public.historial_pagos ADD COLUMN IF NOT EXISTS monto_total numeric;
COMMENT ON COLUMN public.historial_pagos.monto_total IS
  'Total confirmado de esa persona DESPUÉS del movimiento (migración 110). En un abono, `monto` es lo que se sumó.';
DO $acciones$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.historial_pagos'::regclass
                    AND conname = 'historial_pagos_accion_check'
                    AND pg_get_constraintdef(oid) LIKE '%abono%') THEN
    ALTER TABLE public.historial_pagos DROP CONSTRAINT IF EXISTS historial_pagos_accion_check;
    ALTER TABLE public.historial_pagos ADD CONSTRAINT historial_pagos_accion_check
      CHECK (accion IN ('confirmado', 'quitado', 'borrado', 'abono'));
  END IF;
END
$acciones$;

CREATE OR REPLACE FUNCTION public.registrar_historial_pago()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_por uuid := auth.uid();
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.historial_pagos
      (league_id, user_id, accion, monto, moneda, por, confirmado_at_original, confirmado_por_original, monto_total)
    VALUES (OLD.league_id, OLD.user_id, 'borrado', OLD.pago_confirmado_monto, OLD.pago_confirmado_moneda,
            v_por, OLD.pago_confirmado_at, OLD.pago_confirmado_por, OLD.pago_confirmado_monto);
    RETURN OLD;
  END IF;

  -- Un ABONO: la misma confirmación (misma fecha, autor y moneda) con un
  -- total mayor. Se anota lo que se sumó, no un «quitado» + «confirmado».
  IF OLD.pago_confirmado_at IS NOT NULL
     AND NEW.pago_confirmado_at IS NOT DISTINCT FROM OLD.pago_confirmado_at
     AND NEW.pago_confirmado_por IS NOT DISTINCT FROM OLD.pago_confirmado_por
     AND NEW.pago_confirmado_moneda IS NOT DISTINCT FROM OLD.pago_confirmado_moneda
     AND COALESCE(NEW.pago_confirmado_monto, 0) > COALESCE(OLD.pago_confirmado_monto, 0) THEN
    INSERT INTO public.historial_pagos
      (league_id, user_id, accion, monto, moneda, por, confirmado_at_original, confirmado_por_original, monto_total)
    VALUES (NEW.league_id, NEW.user_id, 'abono',
            COALESCE(NEW.pago_confirmado_monto, 0) - COALESCE(OLD.pago_confirmado_monto, 0),
            NEW.pago_confirmado_moneda, v_por, NEW.pago_confirmado_at, NEW.pago_confirmado_por,
            NEW.pago_confirmado_monto);
    RETURN NEW;
  END IF;

  -- Cualquier otro cambio: lo que había deja de valer tal como estaba.
  IF OLD.pago_confirmado_at IS NOT NULL THEN
    INSERT INTO public.historial_pagos
      (league_id, user_id, accion, monto, moneda, por, confirmado_at_original, confirmado_por_original, monto_total)
    VALUES (OLD.league_id, OLD.user_id, 'quitado', OLD.pago_confirmado_monto, OLD.pago_confirmado_moneda,
            v_por, OLD.pago_confirmado_at, OLD.pago_confirmado_por,
            CASE WHEN NEW.pago_confirmado_at IS NULL THEN 0 END);
  END IF;
  IF NEW.pago_confirmado_at IS NOT NULL THEN
    INSERT INTO public.historial_pagos
      (league_id, user_id, accion, monto, moneda, por, confirmado_at_original, confirmado_por_original, monto_total)
    VALUES (NEW.league_id, NEW.user_id, 'confirmado', NEW.pago_confirmado_monto, NEW.pago_confirmado_moneda,
            v_por, NEW.pago_confirmado_at, NEW.pago_confirmado_por, NEW.pago_confirmado_monto);
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.registrar_historial_pago() FROM PUBLIC, anon, authenticated;

-- 3. Avisar un abono -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.avisar_abono(p_league_id uuid, p_monto numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_cuota numeric;
  v_m record;
  v_monto numeric := round(p_monto, 2);
  v_pagado numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT cuota INTO v_cuota FROM public.leagues WHERE id = p_league_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esa quiniela no existe'; END IF;
  SELECT * INTO v_m FROM public.league_members
   WHERE league_id = p_league_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No sos miembro de esta quiniela'; END IF;
  IF COALESCE(v_cuota, 0) <= 0 THEN RAISE EXCEPTION 'Esta quiniela no tiene cuota configurada'; END IF;
  IF v_monto IS NULL OR v_monto <= 0 THEN RAISE EXCEPTION 'El monto tiene que ser mayor que cero'; END IF;
  v_pagado := CASE WHEN v_m.pago_confirmado_at IS NULL THEN 0
                   ELSE COALESCE(v_m.pago_confirmado_monto, v_cuota) END;
  IF v_pagado >= v_cuota THEN
    RAISE EXCEPTION 'Ya tenés la cuota completa confirmada';
  END IF;
  IF v_pagado + v_monto > v_cuota THEN
    RAISE EXCEPTION 'Con ese monto pagarías % y la cuota es %: te faltan %', v_pagado + v_monto, v_cuota, v_cuota - v_pagado;
  END IF;
  UPDATE public.league_members
     SET pago_avisado_at = now(), pago_avisado_monto = v_monto
   WHERE league_id = p_league_id AND user_id = v_uid;
END;
$function$;

-- Retirar el aviso borra también el monto; avisar sin monto es «lo que falta».
CREATE OR REPLACE FUNCTION public.avisar_pago(p_league_id uuid, p_avisar boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.league_members
                 WHERE league_id = p_league_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'No sos miembro de esta quiniela';
  END IF;
  UPDATE public.league_members
  SET pago_avisado_at = CASE WHEN p_avisar THEN now() ELSE NULL END,
      pago_avisado_monto = NULL
  WHERE league_id = p_league_id AND user_id = v_uid;
END; $function$;

-- 4. Confirmar un abono ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirmar_abono(p_league_id uuid, p_user_id uuid,
                                                  p_monto numeric, p_total_visto numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_cuota numeric;
  v_moneda text;
  v_m record;
  v_monto numeric := round(p_monto, 2);
  v_antes numeric;
  v_total numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT public.es_admin_liga(p_league_id, v_uid) THEN
    RAISE EXCEPTION 'Solo un administrador puede confirmar pagos';
  END IF;
  IF p_user_id = v_uid THEN RAISE EXCEPTION 'No podés confirmar tu propio pago'; END IF;
  IF v_monto IS NULL OR v_monto <= 0 THEN RAISE EXCEPTION 'El monto tiene que ser mayor que cero'; END IF;

  -- Orden de la 91: primero la quiniela (choca con borrarla y con cambiar la
  -- cuota o la moneda), después la fila del miembro.
  SELECT cuota, COALESCE(moneda, 'CRC') INTO v_cuota, v_moneda
    FROM public.leagues WHERE id = p_league_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esa quiniela no existe'; END IF;
  IF COALESCE(v_cuota, 0) <= 0 THEN RAISE EXCEPTION 'Esta quiniela no tiene cuota configurada'; END IF;

  SELECT * INTO v_m FROM public.league_members
   WHERE league_id = p_league_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esa persona no está en la quiniela'; END IF;

  v_antes := CASE WHEN v_m.pago_confirmado_at IS NULL THEN 0
                  ELSE COALESCE(v_m.pago_confirmado_monto, v_cuota) END;
  -- Lo que el admin vio tiene que seguir siendo cierto: si otro admin ya
  -- confirmó este aviso (o fue un doble toque), sumar otra vez lo duplicaría.
  IF p_total_visto IS NULL OR round(p_total_visto, 2) <> v_antes THEN
    RAISE EXCEPTION 'El pago de esta persona cambió mientras tanto (ahora tiene % confirmado). Actualizá y volvé a intentar.', v_antes;
  END IF;
  v_total := v_antes + v_monto;
  IF v_total > v_cuota THEN
    RAISE EXCEPTION 'Con ese monto el pago quedaría en % y la cuota es %: le faltan %', v_total, v_cuota, v_cuota - v_antes;
  END IF;

  IF v_m.pago_confirmado_at IS NULL THEN
    UPDATE public.league_members SET
      pago_confirmado_at = now(), pago_confirmado_por = v_uid,
      pago_confirmado_monto = v_total, pago_confirmado_moneda = v_moneda,
      pago_avisado_at = NULL, pago_avisado_monto = NULL
    WHERE league_id = p_league_id AND user_id = p_user_id;
  ELSE
    -- Suma: la fecha, el autor y la moneda de la primera confirmación quedan;
    -- quién confirmó ESTE abono lo guarda el historial.
    UPDATE public.league_members SET
      pago_confirmado_monto = v_total,
      pago_avisado_at = NULL, pago_avisado_monto = NULL
    WHERE league_id = p_league_id AND user_id = p_user_id;
  END IF;

  RETURN jsonb_build_object('monto_total', v_total, 'al_dia', v_total >= v_cuota);
END;
$function$;

-- 5. El pozo dice, por persona, cuánto lleva y cuánto le falta -----------------
CREATE OR REPLACE FUNCTION public.league_pozo(p_league_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_l record; v_cuota numeric; v_r record;
BEGIN
  IF NOT public.puede_ver_quiniela(p_league_id) THEN
    RAISE EXCEPTION 'No sos miembro de esta quiniela';
  END IF;
  SELECT id, admin_id, cuota, moneda, premios_reparto INTO v_l FROM public.leagues WHERE id = p_league_id;
  v_cuota := COALESCE(v_l.cuota, 0);

  -- UNA cuenta por persona (`f`), y los totales salen de esa misma cuenta.
  WITH base AS (
    SELECT u.id AS user_id, u.display_name, u.avatar_url,
           (u.id = v_l.admin_id OR lm.es_admin) AS es_admin,
           (u.id = v_uid) AS soy_yo,
           lm.pago_avisado_at IS NOT NULL AS avisado,
           lm.pago_avisado_monto AS avisado_monto,
           lm.pago_confirmado_at IS NOT NULL AS confirmado,
           -- Lo que se confirmó, no lo que la cuota dice HOY. Un pago de antes
           -- de la 88 no tiene monto y cae a la cuota vigente, como siempre.
           CASE WHEN lm.pago_confirmado_at IS NOT NULL
                THEN COALESCE(lm.pago_confirmado_monto, v_cuota) END AS monto
      FROM public.league_members lm JOIN public.users u ON u.id = lm.user_id
     WHERE lm.league_id = p_league_id
  ), f AS (
    SELECT b.*,
           GREATEST(v_cuota - COALESCE(b.monto, 0), 0) AS falta,
           (b.confirmado AND COALESCE(b.monto, 0) >= v_cuota) AS al_dia
      FROM base b
  )
  SELECT count(*) AS miembros,
         count(*) FILTER (WHERE confirmado) AS pagados,
         count(*) FILTER (WHERE al_dia) AS al_dia,
         COALESCE(SUM(monto), 0) AS recaudado,
         COALESCE(SUM(falta), 0) AS faltan,
         COALESCE(jsonb_agg(jsonb_build_object(
           'user_id', user_id, 'display_name', display_name, 'avatar_url', avatar_url,
           'es_admin', es_admin, 'soy_yo', soy_yo,
           -- Un aviso de alguien que ya está al día es viejo (se confirmó con
           -- el botón de antes, que no lo borraba): no se muestra.
           'aviso', avisado AND NOT al_dia,
           'aviso_monto', CASE WHEN avisado AND NOT al_dia THEN avisado_monto END,
           'confirmado', confirmado, 'monto', monto, 'falta', falta, 'al_dia', al_dia,
           'estado', CASE WHEN al_dia THEN 'pagado' WHEN confirmado THEN 'parcial' ELSE 'pendiente' END
         ) ORDER BY display_name), '[]'::jsonb) AS gente
    INTO v_r
    FROM f;

  RETURN jsonb_build_object(
    'cuota', v_l.cuota, 'moneda', v_l.moneda, 'reparto', v_l.premios_reparto,
    'soy_admin', public.es_admin_liga(p_league_id, v_uid),
    'miembros', v_r.miembros,
    -- `pagados` = con algo confirmado (lo de antes); `al_dia` = con la cuota completa.
    'pagados', v_r.pagados, 'al_dia', v_r.al_dia,
    'pozo_total', v_cuota * v_r.miembros,
    'recaudado', v_r.recaudado,
    'faltan', v_r.faltan,
    'gente', v_r.gente
  );
END; $function$;

-- 6. Permisos: lo nuevo nace cerrado (109); se otorga lo que la app llama. ------
REVOKE ALL ON FUNCTION public.avisar_abono(uuid, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirmar_abono(uuid, uuid, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.avisar_abono(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_abono(uuid, uuid, numeric, numeric) TO authenticated;

-- Comprobaciones ---------------------------------------------------------------
DO $comprobar$
DECLARE v_liga uuid; v_persona uuid; v_cuota numeric; v_antes int; b boolean;
BEGIN
  IF COALESCE((SELECT md5(string_agg(concat_ws('|', lm.league_id, lm.user_id, lm.joined_at,
                 lm.rules_accepted_at, lm.pago_avisado_at, lm.pago_confirmado_at,
                 lm.pago_confirmado_por, lm.es_admin, lm.pago_confirmado_monto,
                 lm.pago_confirmado_moneda), '#' ORDER BY lm.league_id, lm.user_id))
                 FROM public.league_members lm), 'vacia') <> current_setting('m110.huella_miembros') THEN
    RAISE EXCEPTION '110: league_members cambió'; END IF;
  IF (SELECT count(*) FROM public.historial_pagos)::text <> current_setting('m110.historial') THEN
    RAISE EXCEPTION '110: el historial cambió'; END IF;
  IF EXISTS (SELECT 1 FROM public.league_members WHERE pago_avisado_monto IS NOT NULL) THEN
    RAISE EXCEPTION '110: la columna nueva nació con datos'; END IF;

  -- Permisos: el cliente llama las dos nuevas; anon ninguna; el trigger nadie.
  IF NOT has_function_privilege('authenticated', 'public.avisar_abono(uuid,numeric)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.confirmar_abono(uuid,uuid,numeric,numeric)', 'EXECUTE') THEN
    RAISE EXCEPTION '110: el cliente no puede avisar ni confirmar abonos'; END IF;
  IF has_function_privilege('anon', 'public.avisar_abono(uuid,numeric)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.confirmar_abono(uuid,uuid,numeric,numeric)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.registrar_historial_pago()', 'EXECUTE') THEN
    RAISE EXCEPTION '110: quedó algo abierto de más'; END IF;
  -- Las redefinidas conservan su permiso (CREATE OR REPLACE).
  IF NOT has_function_privilege('authenticated', 'public.avisar_pago(uuid,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.league_pozo(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '110: avisar_pago o league_pozo perdieron el permiso del cliente'; END IF;
  -- El cliente no escribe la columna nueva (la 85 le quitó toda escritura).
  IF has_column_privilege('authenticated', 'public.league_members', 'pago_avisado_monto', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.league_members', 'pago_avisado_monto', 'INSERT') THEN
    RAISE EXCEPTION '110: el cliente puede escribir el monto avisado sin pasar por la RPC'; END IF;

  -- El historial anota un abono como 'abono' (sobre un pago real, en un
  -- sub-bloque que se revierte entero: no queda ni el cambio ni la fila).
  SELECT lm.league_id, lm.user_id, l.cuota INTO v_liga, v_persona, v_cuota
    FROM public.league_members lm JOIN public.leagues l ON l.id = lm.league_id
   WHERE lm.pago_confirmado_at IS NOT NULL ORDER BY lm.league_id, lm.user_id LIMIT 1;
  IF v_liga IS NOT NULL THEN
    BEGIN
      SELECT count(*) INTO v_antes FROM public.historial_pagos;
      UPDATE public.league_members SET pago_confirmado_monto = 1
       WHERE league_id = v_liga AND user_id = v_persona;
      UPDATE public.league_members SET pago_confirmado_monto = 3
       WHERE league_id = v_liga AND user_id = v_persona;
      IF NOT EXISTS (SELECT 1 FROM public.historial_pagos
                      WHERE league_id = v_liga AND user_id = v_persona AND accion = 'abono'
                        AND monto = 2 AND monto_total = 3) THEN
        RAISE EXCEPTION '110: un abono no quedó en el historial como abono'; END IF;
      RAISE EXCEPTION 'M110_OK';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'M110_OK' THEN RAISE; END IF;
    END;
  END IF;
END
$comprobar$;

COMMIT;
