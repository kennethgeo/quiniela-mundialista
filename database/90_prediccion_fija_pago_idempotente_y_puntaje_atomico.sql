-- =============================================================================
-- 90 · Una predicción no se muda, un pago no se reescribe al reconfirmarlo,
--      y el puntaje se escribe entero o no se escribe
-- =============================================================================
-- Hallazgos 1, 2 y 3 de la cuarta auditoría (Astra, 23 sep 2026). Los dos
-- primeros se confirmaron en producción con el JWT de personas reales, en
-- transacciones revertidas; el tercero, leyendo el motor. Ninguno había hecho
-- daño: 0 predicciones mudadas, los 13 pagos suman ₡130.000 y las 795
-- predicciones terminadas coinciden con el motor.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- A) Se podía MUDAR una predicción cerrada a otro partido, con sus puntos
-- ─────────────────────────────────────────────────────────────────────────────
-- La política de UPDATE de la 87 comprueba que la fila sea tuya (USING) y que el
-- DESTINO esté abierto (WITH CHECK), pero nada impedía cambiar `match_id` o
-- `league_id`. Medido revertido: una predicción del partido 251, terminado y
-- con 3 puntos, pasó al 300, abierto, CONSERVANDO los 3 puntos. El puntaje no
-- se escribía, se trasladaba.
--
-- La 87 devolvió el UPDATE de esas columnas porque PostgREST las reescribe en
-- cada upsert. Así que no se quita el privilegio otra vez —eso rompió el
-- guardado en la 85—: un trigger rechaza que CAMBIEN. Reescribirlas al mismo
-- valor, que es lo que hace el upsert, pasa. Vale igual para
-- `tournament_predictions` (persona, quiniela y torneo).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- B) Reconfirmar un pago lo reescribía con la cuota NUEVA
-- ─────────────────────────────────────────────────────────────────────────────
-- La 88 hizo que cada pago guarde su monto, y el trigger impide que cambiar la
-- cuota reescriba lo recaudado. Pero `confirmar_pago(..., true)` sobre un pago
-- YA confirmado volvía a escribir monto, moneda y fecha. Medido revertido:
-- cuota a ₡20.000, reconfirmar → ese pago queda en ₡20.000 y lo recaudado en
-- ₡140.000. Basta que otro admin tenga la pantalla vieja abierta.
--
-- Ahora confirmar un pago ya confirmado no hace nada: conserva monto, moneda,
-- fecha y quién lo confirmó. Para corregir un monto se desconfirma y se vuelve
-- a confirmar, dos acciones que el grupo ve en el pozo.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- C) Dos recálculos cruzados dejaban puntos viejos con una firma nueva
-- ─────────────────────────────────────────────────────────────────────────────
-- El motor escribía los puntos (un UPDATE por predicción) y DESPUÉS la firma, en
-- pasos sueltos. Si el resultado cambiaba entre dos recálculos, uno podía
-- escribir puntos calculados con el resultado viejo y el otro firmar con el
-- nuevo: la firma certificaba una mezcla y el reintento dejaba de verla.
--
-- `aplicar_puntaje` hace las dos cosas en UNA transacción, con el partido
-- bloqueado (`FOR UPDATE`), y SOLO si el resultado que el motor usó sigue
-- siendo el del partido. Si cambió, no escribe nada y responde
-- `desactualizado`: el partido queda sin firmar y la pasada siguiente lo
-- recalcula con el resultado nuevo. Compara COLUMNAS, no la firma: la firma se
-- arma solo en Python, para no escribir la misma fórmula dos veces.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- A) La identidad de una predicción no cambia
-- -----------------------------------------------------------------------------
-- Una sola función para las dos tablas: las columnas llegan como argumentos.
CREATE OR REPLACE FUNCTION public.identidad_de_prediccion_fija()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE c text;
BEGIN
  FOREACH c IN ARRAY TG_ARGV LOOP
    IF (to_jsonb(NEW) -> c) IS DISTINCT FROM (to_jsonb(OLD) -> c) THEN
      RAISE EXCEPTION 'Una predicción no cambia de persona, quiniela, partido ni torneo (%). Se borra y se hace otra.', c;
    END IF;
  END LOOP;
  RETURN NEW;
END; $function$;
REVOKE ALL ON FUNCTION public.identidad_de_prediccion_fija() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS identidad_de_prediccion_fija ON public.predictions;
CREATE TRIGGER identidad_de_prediccion_fija
  BEFORE UPDATE OF user_id, league_id, match_id ON public.predictions
  FOR EACH ROW EXECUTE FUNCTION public.identidad_de_prediccion_fija('user_id', 'league_id', 'match_id');

DROP TRIGGER IF EXISTS identidad_de_prediccion_fija ON public.tournament_predictions;
CREATE TRIGGER identidad_de_prediccion_fija
  BEFORE UPDATE OF user_id, league_id, tournament_id ON public.tournament_predictions
  FOR EACH ROW EXECUTE FUNCTION public.identidad_de_prediccion_fija('user_id', 'league_id', 'tournament_id');

-- -----------------------------------------------------------------------------
-- B) Confirmar un pago ya confirmado no lo reescribe
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirmar_pago(p_league_id uuid, p_user_id uuid, p_confirmado boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_uid uuid := auth.uid(); v_cuota numeric; v_moneda text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT public.es_admin_liga(p_league_id, v_uid) THEN
    RAISE EXCEPTION 'Solo un administrador puede confirmar pagos';
  END IF;
  IF p_user_id = v_uid THEN RAISE EXCEPTION 'No podés confirmar tu propio pago'; END IF;
  IF p_confirmado THEN
    SELECT cuota, COALESCE(moneda, 'CRC') INTO v_cuota, v_moneda FROM public.leagues WHERE id = p_league_id;
    -- Solo si NO estaba confirmado: reconfirmar no toca monto, moneda, fecha ni autor.
    UPDATE public.league_members SET
      pago_confirmado_at     = now(),
      pago_confirmado_por    = v_uid,
      pago_confirmado_monto  = v_cuota,
      pago_confirmado_moneda = v_moneda
    WHERE league_id = p_league_id AND user_id = p_user_id AND pago_confirmado_at IS NULL;
  ELSE
    UPDATE public.league_members SET
      pago_confirmado_at = NULL, pago_confirmado_por = NULL,
      pago_confirmado_monto = NULL, pago_confirmado_moneda = NULL
    WHERE league_id = p_league_id AND user_id = p_user_id;
  END IF;
END; $function$;

-- -----------------------------------------------------------------------------
-- C) El puntaje se escribe entero, con el resultado que se usó, o no se escribe
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aplicar_puntaje(
  p_match_id integer, p_home integer, p_away integer, p_penales boolean,
  p_ganador_penales text, p_firma text, p_puntos jsonb)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE m record; n int;
BEGIN
  IF NOT public.es_backend() THEN
    RAISE EXCEPTION 'Solo el backend escribe puntajes';
  END IF;
  -- El bloqueo ordena dos recálculos del mismo partido: el segundo espera.
  SELECT home_goals_actual, away_goals_actual, COALESCE(goes_to_penalties, false) AS pen,
         penalties_winner_real, status
    INTO m FROM public.matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'sin-partido'; END IF;
  IF m.status <> 'finished'
     OR (m.home_goals_actual, m.away_goals_actual, m.pen, m.penalties_winner_real)
        IS DISTINCT FROM (p_home, p_away, COALESCE(p_penales, false), p_ganador_penales) THEN
    -- El motor calculó con un resultado que ya no es el del partido: no se
    -- escribe NADA. Sin firma, la pasada siguiente lo recalcula.
    RETURN 'desactualizado';
  END IF;
  UPDATE public.predictions p
     SET points_earned = x.puntos
    FROM jsonb_to_recordset(COALESCE(p_puntos, '[]'::jsonb)) AS x(id uuid, puntos integer)
   WHERE p.id = x.id AND p.match_id = p_match_id
     AND p.points_earned IS DISTINCT FROM x.puntos;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE public.matches SET puntuado_con = p_firma WHERE id = p_match_id;
  RETURN 'ok:' || n;
END; $function$;
REVOKE ALL ON FUNCTION public.aplicar_puntaje(integer, integer, integer, boolean, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aplicar_puntaje(integer, integer, integer, boolean, text, text, jsonb) TO service_role;

-- -----------------------------------------------------------------------------
-- Comprobaciones (estado final: una segunda corrida pasa igual)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'identidad_de_prediccion_fija'
                  AND tgrelid = 'public.predictions'::regclass)
  OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'identidad_de_prediccion_fija'
                  AND tgrelid = 'public.tournament_predictions'::regclass) THEN
    RAISE EXCEPTION 'falta el candado de identidad de las predicciones';
  END IF;
  -- La 87 NO se deshace: el upsert sigue necesitando UPDATE sobre esas columnas.
  IF NOT has_column_privilege('authenticated','public.predictions','match_id','UPDATE')
  OR NOT has_column_privilege('authenticated','public.predictions','league_id','UPDATE') THEN
    RAISE EXCEPTION 'se quitó el UPDATE que necesita el upsert: vuelve el fallo de la 85';
  END IF;
  IF pg_get_functiondef('public.confirmar_pago(uuid,uuid,boolean)'::regprocedure)
     NOT LIKE '%pago_confirmado_at IS NULL%' THEN
    RAISE EXCEPTION 'confirmar_pago vuelve a reescribir pagos ya confirmados';
  END IF;
  IF has_function_privilege('authenticated','public.aplicar_puntaje(integer,integer,integer,boolean,text,text,jsonb)','EXECUTE')
  OR has_function_privilege('anon','public.aplicar_puntaje(integer,integer,integer,boolean,text,text,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'aplicar_puntaje quedó abierta al cliente';
  END IF;
  IF NOT has_function_privilege('service_role','public.aplicar_puntaje(integer,integer,integer,boolean,text,text,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'el backend no puede escribir puntajes';
  END IF;
  RAISE NOTICE '90 OK';
END $$;

COMMIT;
