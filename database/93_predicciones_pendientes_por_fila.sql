-- =============================================================================
-- 93 · Una predicción pendiente se marca EN SU FILA, no con un reloj
-- =============================================================================
-- Séptima auditoría (Astra, 24 sep 2026). Tres hallazgos de la 92 en el
-- detector de «predicción cambiada después de puntuar». Ninguno había hecho
-- daño: 0 predicciones con `modificada_at`, 0 partidos con `puntuado_at`.
--
-- 1) Con `puntuado_at` NULL —los 62 partidos históricos, 795 predicciones— la
--    comparación `modificada_at > puntuado_at` nunca se cumple: corregir hoy una
--    predicción vieja la dejaba con los puntos viejos y fuera de pendientes.
--    La humo v4 lo tapaba: le ponía al partido un `puntuado_at` artificial.
-- 2) El reloj no es visibilidad. Una inserción del admin toma su hora en el
--    BEFORE INSERT y DESPUÉS espera el bloqueo del partido (la FK); el puntaje
--    que tenía ese bloqueo no la ve, firma con una hora POSTERIOR, y la fila
--    nueva queda con una hora anterior: no aparece pendiente.
-- 3) `prediction_type` cambia los puntos (Marcador 3 / Solo_Ganador 1 para el
--    mismo 2-1) y no estaba ni en el trigger ni en el lote.
--
-- El arreglo: `predictions.puntaje_pendiente`, una marca POR FILA.
--   · La pone el trigger al insertar o al cambiar lo que decide los puntos
--     (ahora con `prediction_type`). Solo toca su propia fila: nada de bloquear
--     el partido desde una predicción, que era el deadlock descartado en la 92.
--   · La borran `aplicar_puntaje` y `void_cancelled_match`, SOLO en las filas
--     que calcularon. Una fila que no vieron —la inserción concurrente— sigue
--     marcada al confirmarse, sin importar la hora que diga.
--   · Nace en `false` para las 1.044 existentes: nada histórico se repuntúa.
--   · El cliente no la puede escribir: `predictions` tiene privilegios de UPDATE
--     e INSERT por columna (85/87) y esta no se le otorga.
-- =============================================================================

BEGIN;

ALTER TABLE public.predictions ADD COLUMN IF NOT EXISTS puntaje_pendiente boolean NOT NULL DEFAULT false;

-- Lo que decide los puntos, ahora con el tipo de predicción.
CREATE OR REPLACE FUNCTION public.prediccion_modificada()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF TG_OP = 'INSERT'
     OR (NEW.home_goals_pred, NEW.away_goals_pred, NEW.penalties_winner_pred,
         COALESCE(NEW.use_powerup_x2, false), NEW.prediction_type::text)
        IS DISTINCT FROM
        (OLD.home_goals_pred, OLD.away_goals_pred, OLD.penalties_winner_pred,
         COALESCE(OLD.use_powerup_x2, false), OLD.prediction_type::text) THEN
    NEW.modificada_at := clock_timestamp();
    NEW.puntaje_pendiente := true;
  END IF;
  RETURN NEW;
END; $function$;
REVOKE ALL ON FUNCTION public.prediccion_modificada() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS prediccion_modificada ON public.predictions;
CREATE TRIGGER prediccion_modificada
  BEFORE INSERT OR UPDATE OF home_goals_pred, away_goals_pred, penalties_winner_pred, use_powerup_x2, prediction_type
  ON public.predictions
  FOR EACH ROW EXECUTE FUNCTION public.prediccion_modificada();

-- Pendientes: la marca de la fila reemplaza la comparación de relojes.
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
      -- O con una predicción marcada que el último puntaje no calculó.
      OR EXISTS (SELECT 1 FROM public.predictions p
                  WHERE p.match_id = m.id
                    AND p.puntaje_pendiente
                    AND p.modificada_at > now() - interval '3 days')
    )
  ORDER BY m.id;
$$;
REVOKE ALL ON FUNCTION public.partidos_pendientes_de_puntaje() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partidos_pendientes_de_puntaje() TO service_role;

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
  -- puntos enteros no negativos, y cada una con lo que se usó para calcular.
  IF jsonb_typeof(v_lote) <> 'array' THEN RETURN 'incompleto'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_lote) e
              WHERE jsonb_typeof(e) <> 'object'
                 OR jsonb_typeof(e -> 'puntos') IS DISTINCT FROM 'number'
                 OR (e ->> 'puntos')::numeric < 0
                 OR (e ->> 'puntos')::numeric <> trunc((e ->> 'puntos')::numeric)
                 OR (e ->> 'id') IS NULL
                 OR (e ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 OR NOT (e ? 'h' AND e ? 'a' AND e ? 'pw' AND e ? 'x2' AND e ? 't')) THEN
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
  -- Lo que el motor usó tiene que seguir siendo lo de la predicción.
  IF EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_lote) e
       JOIN public.predictions p ON p.id = (e ->> 'id')::uuid
       WHERE (p.home_goals_pred, p.away_goals_pred, p.penalties_winner_pred,
              COALESCE(p.use_powerup_x2, false), p.prediction_type::text)
             IS DISTINCT FROM
             ((e ->> 'h')::int, (e ->> 'a')::int, e ->> 'pw',
              COALESCE((e ->> 'x2')::boolean, false), e ->> 't')) THEN
    RETURN 'desactualizado';
  END IF;

  UPDATE public.predictions p
     SET points_earned = x.puntos
    FROM jsonb_to_recordset(v_lote) AS x(id uuid, puntos integer)
   WHERE p.id = x.id AND p.match_id = p_match_id
     AND p.points_earned IS DISTINCT FROM x.puntos;
  GET DIAGNOSTICS n = ROW_COUNT;
  -- Solo las filas que se calcularon dejan de estar pendientes.
  UPDATE public.predictions p SET puntaje_pendiente = false
    FROM jsonb_to_recordset(v_lote) AS x(id uuid)
   WHERE p.id = x.id AND p.match_id = p_match_id AND p.puntaje_pendiente;
  UPDATE public.matches
     SET puntuado_con = p_firma, puntuado_at = clock_timestamp(), puntaje_pendiente_desde = NULL
   WHERE id = p_match_id;
  RETURN 'ok:' || n;
END; $function$;

CREATE OR REPLACE FUNCTION public.void_cancelled_match(p_match_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text; v_tid int; v_kickoff timestamptz;
  v_next_phase text; v_next_matchday integer;
  r record; v_zeroed int := 0; v_refunded int := 0; v_vistas uuid[] := '{}';
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
    v_vistas := v_vistas || r.id;
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
  -- Solo las filas que se anularon dejan de estar pendientes (93).
  UPDATE public.predictions SET puntaje_pendiente = false
   WHERE id = ANY (v_vistas) AND puntaje_pendiente;
  UPDATE public.matches
     SET puntuado_con = 'anulado', puntuado_at = clock_timestamp(), puntaje_pendiente_desde = NULL
   WHERE id = p_match_id;
  RETURN jsonb_build_object('status','ok','zeroed',v_zeroed,'refunded',v_refunded);
END; $function$;

REVOKE ALL ON FUNCTION public.aplicar_puntaje(integer, integer, integer, boolean, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aplicar_puntaje(integer, integer, integer, boolean, text, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.void_cancelled_match(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.void_cancelled_match(integer) TO service_role;

DO $$
BEGIN
  IF pg_get_triggerdef((SELECT oid FROM pg_trigger WHERE tgname = 'prediccion_modificada'
                         AND tgrelid = 'public.predictions'::regclass)) NOT LIKE '%prediction_type%' THEN
    RAISE EXCEPTION 'el tipo de predicción no marca pendiente';
  END IF;
  IF pg_get_functiondef('public.partidos_pendientes_de_puntaje()'::regprocedure) LIKE '%puntuado_at%' THEN
    RAISE EXCEPTION 'los pendientes vuelven a depender de comparar relojes';
  END IF;
  IF has_column_privilege('authenticated', 'public.predictions', 'puntaje_pendiente', 'UPDATE')
  OR has_column_privilege('authenticated', 'public.predictions', 'puntaje_pendiente', 'INSERT') THEN
    RAISE EXCEPTION 'el cliente puede escribir la marca de pendiente';
  END IF;
  IF has_function_privilege('authenticated', 'public.aplicar_puntaje(integer,integer,integer,boolean,text,text,jsonb)', 'EXECUTE')
  OR has_function_privilege('anon', 'public.void_cancelled_match(integer)', 'EXECUTE')
  OR has_function_privilege('authenticated', 'public.partidos_pendientes_de_puntaje()', 'EXECUTE') THEN
    RAISE EXCEPTION 'una función de puntaje quedó abierta al cliente';
  END IF;
  RAISE NOTICE '93 OK';
END $$;

COMMIT;
