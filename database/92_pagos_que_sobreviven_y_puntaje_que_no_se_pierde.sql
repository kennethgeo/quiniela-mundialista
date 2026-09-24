-- =============================================================================
-- 92 · Un pago confirmado no se borra por ninguna puerta, y un puntaje
--      pendiente no se pierde por anular, corregir o esperar
-- =============================================================================
-- Sexta auditoría (Astra, 24 sep 2026). Seis hallazgos; los cinco de la base se
-- confirmaron leyendo producción (FK, triggers y funciones reales). Ninguno había
-- hecho daño: 13 pagos (₡130.000), 795 predicciones terminadas iguales al motor.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- A) Borrar una CUENTA borraba sus pagos
-- ─────────────────────────────────────────────────────────────────────────────
-- auth.users → public.users → league_members, todo ON DELETE CASCADE, y ningún
-- trigger en league_members. El endpoint de admin `delete-user` no miraba
-- pagos: la cascada se llevaba la constancia que la 84 y la 89 protegen en
-- salir y en borrar la quiniela. Una puerta más al mismo cuarto.
-- El candado se pone en la TABLA, no en cada puerta: un trigger BEFORE DELETE
-- sobre league_members rechaza borrar una fila con pago confirmado, venga de
-- donde venga (cascada de cuenta, de quiniela, o un DELETE nuevo que alguien
-- escriba mañana). En una cascada, el trigger ve la versión vigente de la fila,
-- así que también cubre una confirmación que entra en medio.
-- La ÚNICA excepción es la expulsión (B10, decisión consciente): la marca
-- `expulsar_miembro` con una variable local de su propia transacción.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- B) Anular y restaurar dejaba puntos en cero con una firma válida
-- ─────────────────────────────────────────────────────────────────────────────
-- El trigger de la 91 miraba goles y penales, no el ESTADO. Terminado 2-1 →
-- cancelado (void pone ceros) → terminado 2-1 otra vez: la firma «2-1|0|»
-- seguía ahí y la recuperación no veía nada. Ahora el cambio de estado también
-- borra la firma, `void_cancelled_match` firma «anulado» al terminar (y bloquea
-- el partido como `aplicar_puntaje`), y la recuperación busca también los
-- cancelados/pospuestos sin esa firma.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- C) Una predicción añadida o corregida después del puntaje no se veía
-- ─────────────────────────────────────────────────────────────────────────────
-- Las políticas de admin permiten escribir en partidos cerrados, y nada
-- invalidaba la firma. NO se resuelve con un trigger en predictions que
-- actualice matches: un admin corrigiendo una predicción (fila bloqueada) que
-- quiere la fila del partido, contra `aplicar_puntaje` que tiene el partido y
-- quiere esa predicción, es un deadlock de manual.
-- En su lugar:
--   · `predictions.modificada_at` (su propio trigger, sin tocar otra tabla) se
--     pone al insertar o al cambiar lo que decide los puntos. `updated_at` no
--     sirve: también cambia cuando se escriben los puntos.
--   · `matches.puntuado_at` es cuándo se escribió la firma.
--   · Pendiente = alguna predicción modificada DESPUÉS de puntuar.
--   · `aplicar_puntaje` bloquea las predicciones del partido y exige que cada
--     una siga teniendo el marcador con el que se calculó (como ya hacía con el
--     resultado del partido); si no, `desactualizado`.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- D) La ventana de 3 días se contaba desde el SAQUE
-- ─────────────────────────────────────────────────────────────────────────────
-- Una corrección hecha hoy sobre un partido de la semana pasada nacía fuera de
-- la ventana. Ahora cuenta desde que el partido QUEDÓ PENDIENTE
-- (`matches.puntaje_pendiente_desde`, lo pone el trigger al invalidar). Los 189
-- partidos viejos sin firma siguen fuera: no tienen esa marca y su saque es
-- viejo, así que esta migración no provoca ningún re-puntaje histórico.
-- Y la lista de pendientes vive en UNA función (`partidos_pendientes_de_puntaje`),
-- que usan la puerta del cron y el backend: antes eran dos definiciones.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- E) Salir y expulsar tomaban los mismos recursos en orden inverso
-- ─────────────────────────────────────────────────────────────────────────────
-- salir: miembro → predicciones. expulsar: predicciones → miembro. Deadlock
-- posible. Ahora expulsar bloquea primero la fila del miembro, como salir.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- A) Un pago confirmado no se borra (salvo la expulsión, B10)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pago_confirmado_no_se_borra()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF OLD.pago_confirmado_at IS NOT NULL
     AND current_setting('quiniela.expulsion_con_pago', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Esta membresía tiene un pago confirmado: borrarla borraría la constancia del pago. Desconfirmalo antes desde el pozo.';
  END IF;
  RETURN OLD;
END; $function$;
REVOKE ALL ON FUNCTION public.pago_confirmado_no_se_borra() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS pago_confirmado_no_se_borra ON public.league_members;
CREATE TRIGGER pago_confirmado_no_se_borra
  BEFORE DELETE ON public.league_members
  FOR EACH ROW EXECUTE FUNCTION public.pago_confirmado_no_se_borra();

-- E) + la excepción: expulsar bloquea primero al miembro (mismo orden que salir)
CREATE OR REPLACE FUNCTION public.expulsar_miembro(p_league_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_creador uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT public.es_admin_liga(p_league_id, v_uid) THEN
    RAISE EXCEPTION 'Solo un administrador puede expulsar miembros';
  END IF;
  SELECT admin_id INTO v_creador FROM public.leagues WHERE id = p_league_id;
  IF p_user_id = v_creador THEN
    RAISE EXCEPTION 'No se puede expulsar a quien creó la quiniela';
  END IF;
  IF p_user_id = v_uid THEN
    RAISE EXCEPTION 'No podés expulsarte a vos mismo';
  END IF;

  -- Primero la fila del miembro, como salir_de_quiniela (migración 92): el
  -- orden inverso era un deadlock posible.
  PERFORM 1 FROM public.league_members
   WHERE league_id = p_league_id AND user_id = p_user_id FOR UPDATE;

  DELETE FROM public.predictions WHERE league_id = p_league_id AND user_id = p_user_id;
  DELETE FROM public.tournament_predictions WHERE league_id = p_league_id AND user_id = p_user_id;
  -- B10: la expulsión es la única puerta que puede borrar un pago confirmado.
  -- La marca vive solo en esta transacción y se apaga enseguida.
  PERFORM set_config('quiniela.expulsion_con_pago', 'on', true);
  DELETE FROM public.league_members WHERE league_id = p_league_id AND user_id = p_user_id;
  PERFORM set_config('quiniela.expulsion_con_pago', 'off', true);
END; $function$;

-- -----------------------------------------------------------------------------
-- B/C/D) Columnas de seguimiento del puntaje
-- -----------------------------------------------------------------------------
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS puntuado_at timestamptz;
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS puntaje_pendiente_desde timestamptz;
ALTER TABLE public.predictions ADD COLUMN IF NOT EXISTS modificada_at timestamptz;

-- B/D) El resultado O el estado cambian → la firma deja de valer, y el partido
-- queda pendiente DESDE AHORA (no desde su saque).
CREATE OR REPLACE FUNCTION public.resultado_cambiado_invalida_firma()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF (NEW.home_goals_actual, NEW.away_goals_actual,
      COALESCE(NEW.goes_to_penalties, false), NEW.penalties_winner_real, NEW.status)
     IS DISTINCT FROM
     (OLD.home_goals_actual, OLD.away_goals_actual,
      COALESCE(OLD.goes_to_penalties, false), OLD.penalties_winner_real, OLD.status) THEN
    NEW.puntuado_con := NULL;
    NEW.puntaje_pendiente_desde := now();
  END IF;
  RETURN NEW;
END; $function$;
REVOKE ALL ON FUNCTION public.resultado_cambiado_invalida_firma() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS resultado_cambiado_invalida_firma ON public.matches;
CREATE TRIGGER resultado_cambiado_invalida_firma
  BEFORE UPDATE OF home_goals_actual, away_goals_actual, goes_to_penalties, penalties_winner_real, status
  ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.resultado_cambiado_invalida_firma();

-- C) Cuándo cambió por última vez lo que decide los puntos de una predicción.
-- Solo toca SU fila: nada de bloquear el partido desde acá.
CREATE OR REPLACE FUNCTION public.prediccion_modificada()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF TG_OP = 'INSERT'
     OR (NEW.home_goals_pred, NEW.away_goals_pred, NEW.penalties_winner_pred,
         COALESCE(NEW.use_powerup_x2, false))
        IS DISTINCT FROM
        (OLD.home_goals_pred, OLD.away_goals_pred, OLD.penalties_winner_pred,
         COALESCE(OLD.use_powerup_x2, false)) THEN
    NEW.modificada_at := clock_timestamp();
  END IF;
  RETURN NEW;
END; $function$;
REVOKE ALL ON FUNCTION public.prediccion_modificada() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS prediccion_modificada ON public.predictions;
CREATE TRIGGER prediccion_modificada
  BEFORE INSERT OR UPDATE OF home_goals_pred, away_goals_pred, penalties_winner_pred, use_powerup_x2
  ON public.predictions
  FOR EACH ROW EXECUTE FUNCTION public.prediccion_modificada();

-- -----------------------------------------------------------------------------
-- D) La lista de pendientes, en UN solo sitio
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partidos_pendientes_de_puntaje()
RETURNS SETOF integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT m.id
  FROM public.matches m
  WHERE m.status IN ('finished', 'cancelled', 'postponed')
    AND EXISTS (SELECT 1 FROM public.leagues l WHERE l.tournament_id = m.tournament_id)
    AND (
      -- Sin la firma que le corresponde a su estado, desde hace menos de 3 días
      -- (los mismos 3 de DIAS_HACIA_ATRAS), contados desde que quedó pendiente.
      ( CASE WHEN m.status = 'finished' THEN m.puntuado_con IS NULL
             ELSE m.puntuado_con IS DISTINCT FROM 'anulado' END
        AND COALESCE(m.puntaje_pendiente_desde, m.kickoff_at) BETWEEN now() - interval '3 days' AND now() )
      -- O con una predicción agregada/corregida DESPUÉS de firmar.
      OR EXISTS (SELECT 1 FROM public.predictions p
                  WHERE p.match_id = m.id
                    AND p.modificada_at > m.puntuado_at
                    AND p.modificada_at > now() - interval '3 days')
    )
  ORDER BY m.id;
$$;
REVOKE ALL ON FUNCTION public.partidos_pendientes_de_puntaje() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partidos_pendientes_de_puntaje() TO service_role;

CREATE OR REPLACE FUNCTION public.hay_puntajes_pendientes()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.partidos_pendientes_de_puntaje());
$$;
REVOKE ALL ON FUNCTION public.hay_puntajes_pendientes() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- B/C) Escribir el puntaje: también comprueba el marcador de cada predicción
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
  -- Primero el partido, después sus predicciones: siempre en ese orden.
  SELECT home_goals_actual, away_goals_actual, COALESCE(goes_to_penalties, false) AS pen,
         penalties_winner_real, status
    INTO m FROM public.matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'sin-partido'; END IF;
  IF m.status <> 'finished'
     OR (m.home_goals_actual, m.away_goals_actual, m.pen, m.penalties_winner_real)
        IS DISTINCT FROM (p_home, p_away, COALESCE(p_penales, false), p_ganador_penales) THEN
    RETURN 'desactualizado';
  END IF;
  PERFORM 1 FROM public.predictions WHERE match_id = p_match_id FOR UPDATE;

  -- El lote tiene que ser EXACTAMENTE las predicciones del partido: ids únicos,
  -- puntos enteros no negativos, y cada una con el marcador usado para calcular.
  IF jsonb_typeof(v_lote) <> 'array' THEN RETURN 'incompleto'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_lote) e
              WHERE jsonb_typeof(e) <> 'object'
                 OR jsonb_typeof(e -> 'puntos') IS DISTINCT FROM 'number'
                 OR (e ->> 'puntos')::numeric < 0
                 OR (e ->> 'puntos')::numeric <> trunc((e ->> 'puntos')::numeric)
                 OR (e ->> 'id') IS NULL
                 OR (e ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 OR NOT (e ? 'h' AND e ? 'a' AND e ? 'pw' AND e ? 'x2')) THEN
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
  -- El marcador que el motor usó tiene que seguir siendo el de la predicción.
  IF EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_lote) e
       JOIN public.predictions p ON p.id = (e ->> 'id')::uuid
       WHERE (p.home_goals_pred, p.away_goals_pred, p.penalties_winner_pred, COALESCE(p.use_powerup_x2, false))
             IS DISTINCT FROM
             ((e ->> 'h')::int, (e ->> 'a')::int, e ->> 'pw', COALESCE((e ->> 'x2')::boolean, false))) THEN
    RETURN 'desactualizado';
  END IF;

  UPDATE public.predictions p
     SET points_earned = x.puntos
    FROM jsonb_to_recordset(v_lote) AS x(id uuid, puntos integer)
   WHERE p.id = x.id AND p.match_id = p_match_id
     AND p.points_earned IS DISTINCT FROM x.puntos;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE public.matches
     SET puntuado_con = p_firma, puntuado_at = clock_timestamp(), puntaje_pendiente_desde = NULL
   WHERE id = p_match_id;
  RETURN 'ok:' || n;
END; $function$;

-- B) Anular: bloquea el partido y FIRMA «anulado» al terminar.
CREATE OR REPLACE FUNCTION public.void_cancelled_match(p_match_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text; v_tid int; v_kickoff timestamptz;
  v_next_phase text; v_next_matchday integer;
  r record; v_zeroed int := 0; v_refunded int := 0;
BEGIN
  IF NOT public.es_backend()
     AND COALESCE((SELECT is_admin FROM public.users WHERE id = auth.uid()), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Solo un administrador puede anular un partido';
  END IF;
  SELECT status, tournament_id, kickoff_at INTO v_status, v_tid, v_kickoff
    FROM public.matches WHERE id = p_match_id FOR UPDATE;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('status','error','message','Partido no encontrado');
  END IF;
  IF v_status NOT IN ('cancelled','postponed') THEN
    RETURN jsonb_build_object('status','ok','message','El partido no está cancelado','zeroed',0,'refunded',0);
  END IF;
  SELECT public.clave_fase(m.phase, m.stage), m.matchday
    INTO v_next_phase, v_next_matchday
    FROM public.matches m
   WHERE m.tournament_id = v_tid AND m.kickoff_at > v_kickoff
     AND m.status NOT IN ('cancelled','postponed')
   ORDER BY m.kickoff_at ASC LIMIT 1;
  FOR r IN SELECT p.id, p.user_id, p.league_id, p.use_powerup_x2
             FROM public.predictions p WHERE p.match_id = p_match_id
  LOOP
    UPDATE public.predictions SET points_earned = 0 WHERE id = r.id;
    v_zeroed := v_zeroed + 1;
    IF r.use_powerup_x2 THEN
      UPDATE public.predictions SET use_powerup_x2 = FALSE WHERE id = r.id;
      INSERT INTO public.powerup_credits (user_id, league_id, phase, matchday, source_match_id)
      VALUES (r.user_id, r.league_id, v_next_phase, v_next_matchday, p_match_id)
      ON CONFLICT (user_id, league_id, source_match_id) DO NOTHING;
      v_refunded := v_refunded + 1;
    END IF;
  END LOOP;
  -- Firma de la anulación (migración 92): después del bucle, así el apagado
  -- del ×2 de arriba queda ANTES de puntuado_at y no parece una corrección.
  UPDATE public.matches
     SET puntuado_con = 'anulado', puntuado_at = clock_timestamp(), puntaje_pendiente_desde = NULL
   WHERE id = p_match_id;
  RETURN jsonb_build_object('status','ok','zeroed',v_zeroed,'refunded',v_refunded);
END; $function$;

-- ACL explícito: en producción CREATE OR REPLACE conserva el que ya tenían,
-- pero una base nueva las crearía abiertas a PUBLIC. Mismo ACL que producción.
REVOKE ALL ON FUNCTION public.aplicar_puntaje(integer, integer, integer, boolean, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aplicar_puntaje(integer, integer, integer, boolean, text, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.void_cancelled_match(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.void_cancelled_match(integer) TO service_role;
REVOKE ALL ON FUNCTION public.expulsar_miembro(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expulsar_miembro(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hay_puntajes_pendientes() TO service_role;

-- -----------------------------------------------------------------------------
-- Comprobaciones (estado final: una segunda corrida pasa igual)
-- -----------------------------------------------------------------------------
DO $$
DECLARE f text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'pago_confirmado_no_se_borra'
                  AND tgrelid = 'public.league_members'::regclass) THEN
    RAISE EXCEPTION 'falta el candado de pagos en league_members';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'prediccion_modificada'
                  AND tgrelid = 'public.predictions'::regclass) THEN
    RAISE EXCEPTION 'falta el trigger de predicción modificada';
  END IF;
  IF pg_get_triggerdef((SELECT oid FROM pg_trigger WHERE tgname = 'resultado_cambiado_invalida_firma'
                         AND tgrelid = 'public.matches'::regclass)) NOT LIKE '%status%' THEN
    RAISE EXCEPTION 'la firma no se invalida al cambiar el estado';
  END IF;
  IF pg_get_functiondef('public.expulsar_miembro(uuid,uuid)'::regprocedure) NOT LIKE '%FOR UPDATE%' THEN
    RAISE EXCEPTION 'expulsar no bloquea primero al miembro';
  END IF;
  IF pg_get_functiondef('public.void_cancelled_match(integer)'::regprocedure) NOT LIKE '%''anulado''%' THEN
    RAISE EXCEPTION 'anular no deja firma';
  END IF;
  FOREACH f IN ARRAY ARRAY[
    'public.partidos_pendientes_de_puntaje()', 'public.hay_puntajes_pendientes()',
    'public.pago_confirmado_no_se_borra()', 'public.prediccion_modificada()',
    'public.resultado_cambiado_invalida_firma()',
    'public.aplicar_puntaje(integer,integer,integer,boolean,text,text,jsonb)',
    'public.void_cancelled_match(integer)'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') THEN
      RAISE EXCEPTION '% quedó abierta a anon', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'public.partidos_pendientes_de_puntaje()', 'public.hay_puntajes_pendientes()',
    'public.aplicar_puntaje(integer,integer,integer,boolean,text,text,jsonb)'] LOOP
    IF has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION '% quedó ejecutable desde el cliente', f;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', 'public.partidos_pendientes_de_puntaje()', 'EXECUTE') THEN
    RAISE EXCEPTION 'el backend no puede leer los pendientes';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.expulsar_miembro(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'expulsar perdió el EXECUTE de authenticated';
  END IF;
  RAISE NOTICE '92 OK';
END $$;

COMMIT;
