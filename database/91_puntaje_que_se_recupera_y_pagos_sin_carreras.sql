-- =============================================================================
-- 91 · El puntaje se recupera aunque la fuente calle, la firma solo certifica
--      lotes completos, y confirmar un pago no se cruza con salir ni borrar
-- =============================================================================
-- Hallazgos 1, 2 y 3 de la quinta auditoría (Astra, 24 sep 2026). Ninguno había
-- hecho daño: las 795 predicciones terminadas coinciden con el motor y los 13
-- pagos siguen sumando ₡130.000.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- A) Un puntaje fallido podía quedar fuera de TODOS los reintentos
-- ─────────────────────────────────────────────────────────────────────────────
-- El reintento por firma (88) vivía dentro del sync de ESPN, y a ese sync solo
-- se llega por dos puertas del cron: `sync-en-vivo` (saques entre -4 h y +15
-- min) y `rescate-de-resultados` (partidos `pending`/`in_progress`). Un partido
-- YA `finished` cuyo puntaje falló no abre ninguna de las dos: si era el último
-- partido en curso, nada volvía a llamar al backend. Y aunque se llamara, el
-- sync de ESPN sale antes de mirar la base si la fuente devuelve 0 eventos.
-- Medido: desde el 21 de septiembre ningún partido terminado recibió firma,
-- porque nadie volvió a llamar al sync.
--
-- Ahora:
--   · `puntuado_con` se BORRA sola cuando cambia el resultado (trigger
--     `resultado_cambiado_invalida_firma`). Así la base sabe, sin conocer la
--     fórmula de la firma —que vive solo en Python—, qué partidos terminados
--     esperan puntaje: los que no tienen firma.
--   · `hay_puntajes_pendientes()` abre la puerta del rescate con esos
--     partidos. Sin filtrar por torneo terminado: el último partido de un
--     torneo es justo el que más fácil se queda afuera.
--   · El backend recorre esos partidos desde la BASE (`puntuar_pendientes`),
--     no desde lo que devuelva ESPN.
-- Ventana: los mismos 3 días de `DIAS_HACIA_ATRAS`. Más atrás es trabajo del
-- admin (`recalc-scores`), igual que en el rescate de resultados. Eso además
-- deja fuera los 189 partidos viejos sin firma —anteriores a la 88 y con los
-- puntos correctos—: esta migración no escribe en ninguno.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- B) `aplicar_puntaje` firmaba lotes incompletos
-- ─────────────────────────────────────────────────────────────────────────────
-- Firmaba cualquier lote: vacío, con una sola de dos predicciones, con ids de
-- otro partido, o con un id repetido (y ahí ganaba el orden: 3 o 999). Una
-- firma que dice «completo» con puntos sin calcular apaga el reintento.
-- Ahora, antes de escribir nada, exige ids únicos, puntos enteros no
-- negativos y EXACTAMENTE las predicciones del partido. Si no, responde
-- `incompleto` sin tocar puntos ni firma. El backend además lee las
-- predicciones paginadas: con más de 1.000 el lote venía cortado.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- C) Confirmar un pago no estaba coordinado con salir ni con borrar
-- ─────────────────────────────────────────────────────────────────────────────
-- `salir_de_quiniela` y `delete_group` leían «no hay pago» y borraban DESPUÉS,
-- sin volver a mirar. Una confirmación que entrara en medio desaparecía con la
-- membresía. Protocolo de bloqueos, siempre en el mismo orden:
--   · confirmar/desconfirmar: `leagues` FOR SHARE, después la fila del miembro.
--   · salir: la fila del miembro FOR UPDATE, y el pago se lee en ESE select.
--   · borrar la quiniela: `leagues` FOR UPDATE, después se cuentan los pagos.
--   · cambiar la moneda: el UPDATE de `leagues` ya choca con el FOR SHARE, y el
--     trigger `cuota_no_reescribe_pagos` cuenta después del bloqueo.
-- La expulsión sigue borrando pagos: es la excepción consciente B10.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- D) El anuncio global no se podía guardar NUNCA
-- ─────────────────────────────────────────────────────────────────────────────
-- No venía en la auditoría: lo destapó la versión 3 de la prueba de humo, la
-- primera que prueba las escrituras directas del admin global. El panel guarda
-- el anuncio con `.upsert({ id: 1, … })`, y un INSERT … ON CONFLICT exige
-- pasar una política de INSERT aunque la fila ya exista. `global_settings`
-- solo tenía políticas de SELECT y UPDATE: el botón daba error de RLS siempre.
-- Medido: el anuncio de producción está vacío. Se agrega la política de
-- INSERT, con el mismo criterio que la de UPDATE (solo el admin global).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- A) Firma que se invalida sola + puerta del cron
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resultado_cambiado_invalida_firma()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF (NEW.home_goals_actual, NEW.away_goals_actual,
      COALESCE(NEW.goes_to_penalties, false), NEW.penalties_winner_real)
     IS DISTINCT FROM
     (OLD.home_goals_actual, OLD.away_goals_actual,
      COALESCE(OLD.goes_to_penalties, false), OLD.penalties_winner_real) THEN
    NEW.puntuado_con := NULL;
  END IF;
  RETURN NEW;
END; $function$;
REVOKE ALL ON FUNCTION public.resultado_cambiado_invalida_firma() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS resultado_cambiado_invalida_firma ON public.matches;
CREATE TRIGGER resultado_cambiado_invalida_firma
  BEFORE UPDATE OF home_goals_actual, away_goals_actual, goes_to_penalties, penalties_winner_real
  ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.resultado_cambiado_invalida_firma();

CREATE OR REPLACE FUNCTION public.hay_puntajes_pendientes()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.matches m
    WHERE m.status = 'finished'
      AND m.puntuado_con IS NULL
      -- Los mismos 3 días que DIAS_HACIA_ATRAS (backend) y que el rescate.
      AND m.kickoff_at BETWEEN now() - interval '3 days' AND now()
      AND EXISTS (SELECT 1 FROM public.leagues l WHERE l.tournament_id = m.tournament_id)
  );
$$;
REVOKE ALL ON FUNCTION public.hay_puntajes_pendientes() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cron_rescate_resultados()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF public.hay_resultados_sin_escribir('4 hours', '3 days')
     OR public.hay_puntajes_pendientes() THEN
    PERFORM public.llamar_backend('/api/matches/sync-live');
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- B) Solo se firma un lote completo
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aplicar_puntaje(
  p_match_id integer, p_home integer, p_away integer, p_penales boolean,
  p_ganador_penales text, p_firma text, p_puntos jsonb)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE m record; n int; v_lote jsonb := COALESCE(p_puntos, '[]'::jsonb);
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
    RETURN 'desactualizado';
  END IF;

  -- El lote tiene que ser EXACTAMENTE las predicciones del partido: ids únicos,
  -- puntos enteros no negativos, ni una de más ni una de menos. Si no, no se
  -- escribe nada: una firma sobre un lote parcial apagaría el reintento.
  IF jsonb_typeof(v_lote) <> 'array' THEN RETURN 'incompleto'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_lote) e
              WHERE jsonb_typeof(e) <> 'object'
                 OR jsonb_typeof(e -> 'puntos') IS DISTINCT FROM 'number'
                 OR (e ->> 'puntos')::numeric < 0
                 OR (e ->> 'puntos')::numeric <> trunc((e ->> 'puntos')::numeric)
                 OR (e ->> 'id') IS NULL
                 OR (e ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
    RETURN 'incompleto';
  END IF;
  IF (SELECT count(*) <> count(DISTINCT (e ->> 'id')::uuid) FROM jsonb_array_elements(v_lote) e) THEN
    RETURN 'incompleto';
  END IF;
  IF EXISTS (
       SELECT 1 FROM public.predictions p
        WHERE p.match_id = p_match_id
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_lote) e WHERE (e ->> 'id')::uuid = p.id))
  OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_lote) e
        WHERE NOT EXISTS (SELECT 1 FROM public.predictions p
                           WHERE p.id = (e ->> 'id')::uuid AND p.match_id = p_match_id)) THEN
    RETURN 'incompleto';
  END IF;

  UPDATE public.predictions p
     SET points_earned = x.puntos
    FROM jsonb_to_recordset(v_lote) AS x(id uuid, puntos integer)
   WHERE p.id = x.id AND p.match_id = p_match_id
     AND p.points_earned IS DISTINCT FROM x.puntos;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE public.matches SET puntuado_con = p_firma WHERE id = p_match_id;
  RETURN 'ok:' || n;
END; $function$;

-- -----------------------------------------------------------------------------
-- C) Pagos: un solo orden de bloqueos
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
  -- Primero la quiniela (choca con borrarla y con cambiar la moneda), y la
  -- cuota se lee DESPUÉS del bloqueo.
  SELECT cuota, COALESCE(moneda, 'CRC') INTO v_cuota, v_moneda
    FROM public.leagues WHERE id = p_league_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esa quiniela no existe'; END IF;
  IF p_confirmado THEN
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

CREATE OR REPLACE FUNCTION public.salir_de_quiniela(p_league_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- FOR UPDATE: si un admin está confirmando este pago, se espera a que
  -- termine y se lee el pago YA confirmado (migración 91).
  SELECT pago_confirmado_at INTO v_pagado
    FROM public.league_members
   WHERE league_id = p_league_id AND user_id = v_uid
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No sos miembro de esta quiniela';
  END IF;

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
$function$;

CREATE OR REPLACE FUNCTION public.delete_group(p_league_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_pagos int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  -- FOR UPDATE: espera a cualquier confirmación en curso (que toma la quiniela
  -- FOR SHARE) y los pagos se cuentan DESPUÉS (migración 91).
  PERFORM 1 FROM public.leagues WHERE id = p_league_id AND admin_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solo el administrador puede eliminar la quiniela';
  END IF;
  SELECT count(*) INTO v_pagos FROM public.league_members
   WHERE league_id = p_league_id AND pago_confirmado_at IS NOT NULL;
  IF v_pagos > 0 THEN
    RAISE EXCEPTION 'No se puede eliminar: hay % pago(s) confirmado(s) y borrar la quiniela borraría esa constancia. Desconfirmalos primero desde el pozo.', v_pagos;
  END IF;
  DELETE FROM public.leagues WHERE id = p_league_id;
END; $function$;

-- -----------------------------------------------------------------------------
-- D) El admin global puede guardar el anuncio (upsert)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS global_settings_insert_admin ON public.global_settings;
CREATE POLICY global_settings_insert_admin ON public.global_settings
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_admin = true));

-- -----------------------------------------------------------------------------
-- Comprobaciones (estado final: una segunda corrida pasa igual)
-- -----------------------------------------------------------------------------
DO $$
DECLARE f text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'resultado_cambiado_invalida_firma'
                  AND tgrelid = 'public.matches'::regclass) THEN
    RAISE EXCEPTION 'falta el trigger que invalida la firma al cambiar el resultado';
  END IF;
  IF pg_get_functiondef('public.cron_rescate_resultados()'::regprocedure)
     NOT LIKE '%hay_puntajes_pendientes%' THEN
    RAISE EXCEPTION 'la puerta del rescate no mira los puntajes pendientes';
  END IF;
  IF pg_get_functiondef('public.aplicar_puntaje(integer,integer,integer,boolean,text,text,jsonb)'::regprocedure)
     NOT LIKE '%incompleto%' THEN
    RAISE EXCEPTION 'aplicar_puntaje vuelve a firmar lotes incompletos';
  END IF;
  IF pg_get_functiondef('public.salir_de_quiniela(uuid)'::regprocedure) NOT LIKE '%FOR UPDATE%'
  OR pg_get_functiondef('public.delete_group(uuid)'::regprocedure) NOT LIKE '%FOR UPDATE%'
  OR pg_get_functiondef('public.confirmar_pago(uuid,uuid,boolean)'::regprocedure) NOT LIKE '%FOR SHARE%' THEN
    RAISE EXCEPTION 'falta el protocolo de bloqueos de pagos';
  END IF;
  FOREACH f IN ARRAY ARRAY[
    'public.hay_puntajes_pendientes()',
    'public.cron_rescate_resultados()',
    'public.resultado_cambiado_invalida_firma()',
    'public.aplicar_puntaje(integer,integer,integer,boolean,text,text,jsonb)'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE')
       OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION '% quedó ejecutable desde el cliente', f;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role','public.aplicar_puntaje(integer,integer,integer,boolean,text,text,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'el backend no puede escribir puntajes';
  END IF;
  -- Las RPC del cliente siguen abiertas para quien las usa.
  FOREACH f IN ARRAY ARRAY[
    'public.confirmar_pago(uuid,uuid,boolean)',
    'public.salir_de_quiniela(uuid)',
    'public.delete_group(uuid)'] LOOP
    IF NOT has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION '% perdió el EXECUTE de authenticated', f;
    END IF;
    IF has_function_privilege('anon', f, 'EXECUTE') THEN
      RAISE EXCEPTION '% quedó abierta a anon', f;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'global_settings' AND cmd = 'INSERT') THEN
    RAISE EXCEPTION 'el anuncio global sigue sin poder guardarse';
  END IF;
  RAISE NOTICE '91 OK';
END $$;

COMMIT;
