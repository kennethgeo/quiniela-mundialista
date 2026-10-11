-- =============================================================================
-- 108_recordatorio_a_todos_con_avisos.sql
-- 11 oct 2026, decisión del dueño: «la idea es que igual avise a quienes
-- tengan activado faltando 45 minutos». Solo redefine UNA función; no toca
-- ninguna fila. Idempotente.
-- =============================================================================
--
-- El recordatorio de los 45 minutos salía únicamente a quien le faltaba
-- predecir, y esa regla vivía en DOS lados: en el backend
-- (`entregas_recordatorio`) y acá, en el reclamo atómico de la 82, que volvía a
-- descartar con `NOT EXISTS (predictions)`. Con el grupo al día no le llegaba a
-- nadie y parecía que los avisos no funcionaban (10 oct 2026, partido 295).
--
-- Ahora el backend arma una unidad por (persona, quiniela, partido) para todos
-- los que tienen un dispositivo registrado, y el texto cambia según si ya
-- predijo («⚽ Arranca en 45 min») o no («⏰ Faltan 45 min… No has predicho»).
-- Esta migración quita el descarte del reclamo; todo lo demás queda igual:
--   · solo el backend puede reclamar (`es_backend()`),
--   · membresía y torneo de la quiniela se siguen comprobando,
--   · nada se reclama con las predicciones ya cerradas (15 min antes) ni para
--     partidos terminados, cancelados o pospuestos,
--   · la deduplicación sigue siendo `ON CONFLICT … DO NOTHING` sobre
--     (persona, quiniela, partido, tipo): un aviso por partido y persona.
--
-- `CREATE OR REPLACE` con la MISMA firma conserva el ACL (solo `service_role`);
-- igual se vuelve a revocar y otorgar, y el bloque final lo comprueba.
--
-- ORDEN DE DESPLIEGUE: el código va primero. Con la 82 todavía puesta, el
-- reclamo descarta a quien ya predijo y el backend se comporta como antes
-- (probado en `test_recordatorio_a_todos.py`).
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.claim_notification_deliveries(
  p_entregas jsonb,
  p_tipo text
)
RETURNS TABLE (
  claimed_user_id uuid,
  claimed_league_id uuid,
  claimed_match_id integer,
  claimed_token uuid
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO public
AS $func$
BEGIN
  IF NOT public.es_backend() THEN
    RAISE EXCEPTION 'Solo el backend puede reclamar notificaciones';
  END IF;
  IF p_tipo IS NULL OR length(p_tipo) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'Tipo de notificación inválido';
  END IF;
  IF jsonb_typeof(p_entregas) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_entregas) > 1000 THEN
    RAISE EXCEPTION 'El lote de entregas debe ser un arreglo de hasta 1000 filas';
  END IF;

  RETURN QUERY
  WITH incoming AS (
    SELECT DISTINCT e.user_id, e.league_id, e.match_id, e.claim_token
    FROM jsonb_to_recordset(p_entregas) AS e(
      user_id uuid, league_id uuid, match_id integer, claim_token uuid)
    JOIN public.league_members lm
      ON lm.user_id = e.user_id AND lm.league_id = e.league_id
    JOIN public.leagues l ON l.id = e.league_id
    JOIN public.matches m
      ON m.id = e.match_id AND m.tournament_id = l.tournament_id
    WHERE e.claim_token IS NOT NULL
      AND m.status NOT IN ('finished', 'cancelled', 'postponed')
      AND m.kickoff_at - interval '15 minutes' > now()
  ), retried AS (
    UPDATE public.notification_deliveries nd
       SET status = 'claimed',
           attempts = nd.attempts + 1,
           claim_token = i.claim_token,
           claimed_at = now(),
           delivered_at = NULL,
           updated_at = now()
      FROM incoming i
     WHERE nd.user_id = i.user_id
       AND nd.league_id = i.league_id
       AND nd.match_id = i.match_id
       AND nd.tipo = p_tipo
       AND (nd.status = 'failed'
         OR (nd.status = 'claimed'
             AND nd.claimed_at < now() - interval '5 minutes'))
    RETURNING nd.user_id, nd.league_id, nd.match_id, nd.claim_token
  )
  SELECT r.user_id, r.league_id, r.match_id, r.claim_token FROM retried r;

  RETURN QUERY
  WITH incoming AS (
    SELECT DISTINCT e.user_id, e.league_id, e.match_id, e.claim_token
    FROM jsonb_to_recordset(p_entregas) AS e(
      user_id uuid, league_id uuid, match_id integer, claim_token uuid)
    JOIN public.league_members lm
      ON lm.user_id = e.user_id AND lm.league_id = e.league_id
    JOIN public.leagues l ON l.id = e.league_id
    JOIN public.matches m
      ON m.id = e.match_id AND m.tournament_id = l.tournament_id
    WHERE e.claim_token IS NOT NULL
      AND m.status NOT IN ('finished', 'cancelled', 'postponed')
      AND m.kickoff_at - interval '15 minutes' > now()
  ), inserted AS (
    INSERT INTO public.notification_deliveries (
      user_id, league_id, match_id, tipo, status, attempts, claim_token,
      claimed_at, delivered_at, last_error, created_at, updated_at)
    SELECT i.user_id, i.league_id, i.match_id, p_tipo, 'claimed', 1,
           i.claim_token, now(), NULL, NULL, now(), now()
    FROM incoming i
    ON CONFLICT ON CONSTRAINT notification_deliveries_unique DO NOTHING
    RETURNING user_id, league_id, match_id, claim_token
  )
  SELECT i.user_id, i.league_id, i.match_id, i.claim_token FROM inserted i;
END;
$func$;

COMMENT ON FUNCTION public.claim_notification_deliveries(jsonb, text) IS
  'Interna del backend: reclama atómicamente avisos nuevos, fallidos o abandonados. Desde la 108 no descarta a quien ya predijo.';

REVOKE ALL ON FUNCTION public.claim_notification_deliveries(jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_deliveries(jsonb, text)
  TO service_role;

DO $verificar$
DECLARE v_def text := pg_get_functiondef(
  'public.claim_notification_deliveries(jsonb,text)'::regprocedure);
BEGIN
  IF v_def ILIKE '%public.predictions%' THEN
    RAISE EXCEPTION 'El reclamo sigue descartando a quien ya predijo';
  END IF;
  IF v_def NOT ILIKE '%es_backend()%' THEN
    RAISE EXCEPTION 'El reclamo dejó de exigir el backend';
  END IF;
  IF v_def NOT ILIKE '%ON CONFLICT ON CONSTRAINT notification_deliveries_unique DO NOTHING%' THEN
    RAISE EXCEPTION 'La reclamación nueva dejó de usar ON CONFLICT DO NOTHING';
  END IF;
  IF v_def NOT ILIKE '%interval ''15 minutes'' > now()%' THEN
    RAISE EXCEPTION 'El reclamo dejó de respetar el cierre de predicciones';
  END IF;
  IF has_function_privilege('anon', 'public.claim_notification_deliveries(jsonb,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_notification_deliveries(jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'El reclamo quedó alcanzable desde el cliente';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.claim_notification_deliveries(jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role no puede reclamar notificaciones';
  END IF;
  RAISE NOTICE '108 OK: el recordatorio de 45 min se reclama para todos los que tengan avisos';
END $verificar$;

NOTIFY pgrst, 'reload schema';
COMMIT;
