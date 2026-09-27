-- =============================================================================
-- 99_predicciones_cerradas_para_todos.sql
-- Decimotercera auditoría (Astra, 27 sep 2026). Tres arreglos:
--   1. Una predicción cerrada no se escribe, TAMPOCO siendo admin global.
--   2. El rechazo por estado llega ANTES de bloquear la fila (USING), para que
--      no quede un camino al deadlock contra void_cancelled_match.
--   3. Quien sale o es expulsado no conserva créditos de ×2 al volver.
-- Idempotente.
-- =============================================================================
--
-- 1. LAS POLÍTICAS DEL ADMIN GLOBAL (nacieron a mano en el dashboard, nunca
--    estuvieron en database/). `predictions_insert_admin`,
--    `predictions_update_admin` y `tournament_predictions_update_admin` solo
--    miraban `users.is_admin`: las políticas permisivas se combinan con OR, así
--    que la 98 cerraba la puerta del miembro y dejaba abierta la del admin.
--    Reproducido por Astra con el upsert completo de PredecirJornada: el admin
--    guarda en cancelado, pospuesto y terminado, incluso con la reapertura
--    forzada apagada. El admin global también JUEGA: con el resultado a la
--    vista eso no es corregir, es predecir sabiendo.
--    Ninguna pantalla las usa (cero escrituras de predicciones ajenas en
--    frontend/src; el panel corrige RESULTADOS en `matches`, no predicciones).
--    Si algún día hace falta que el admin corrija una predicción, que sea una
--    RPC explícita con bitácora, no una excepción general en la RLS.
--
-- 2. EL ESTADO VA TAMBIÉN EN USING. La 98 lo puso solo en WITH CHECK, y
--    PostgreSQL evalúa WITH CHECK DESPUÉS de los triggers BEFORE. Con
--    `USING (auth.uid() = user_id)` el cliente podía BLOQUEAR la fila de un
--    partido pospuesto (un UPDATE o un SELECT … FOR UPDATE), y el trigger del
--    ×2 pedía el candado de cupo antes de que llegara el rechazo.
--    REPRODUCIDO CON DOS CONEXIONES en un Postgres 16 local, con las funciones
--    de la 97 y las políticas de la 98: A bloquea su predicción del pospuesto,
--    B corre void_cancelled_match (candado de cupo → espera la fila), A prende
--    el ×2 → `deadlock detected`. Con este USING: A no llega a bloquear nada
--    («A bloqueó 0») y B anula sin esperar.
--    En un upsert, ON CONFLICT bloquea la fila existente y enseguida aplica el
--    USING como comprobación: el error sale ANTES de los triggers, sin pedir
--    el candado de cupo.
--    Lo que NO cubre, dicho: si el estado cambia a pospuesto en medio de un
--    guardado ya empezado, el ciclo sigue siendo posible. Postgres lo detecta
--    y aborta una de las dos transacciones; si cae la anulación, la
--    recuperación de la 92 la reintenta (busca cancelados/pospuestos sin firma
--    'anulado'); si cae el guardado, la persona ve el error y el partido ya
--    está cerrado. Falla ruidosa y recuperable, no un dato mal escrito.
--
-- 3. CRÉDITOS AL SALIR. salir_de_quiniela y expulsar_miembro borran las
--    predicciones pero no `powerup_credits`. Reproducido por Astra: cupo 1 +
--    un crédito, salir, volver a entrar con el código → dos ×2 pasan. El
--    crédito nació de una predicción que ya no existe, así que se borra con la
--    membresía. Va en un trigger sobre league_members (AFTER DELETE) y no en
--    las dos funciones, para que cubra cualquier puerta presente o futura —
--    mismo razonamiento que el candado de pagos de la 92.
--    ¿Se pierde el registro que impide compensar dos veces? No: ese registro
--    protege contra volver a anular el MISMO ×2, y las predicciones anuladas
--    ya se borraron al salir. Al volver, un partido pospuesto está cerrado
--    (98 + esta), así que no hay ×2 nuevo que anular ahí.
--    Hoy: 0 créditos de gente fuera de su quiniela (medido 27 sep 2026).
-- =============================================================================

BEGIN;

-- 1 ---------------------------------------------------------------------------
DROP POLICY IF EXISTS predictions_insert_admin ON public.predictions;
DROP POLICY IF EXISTS predictions_update_admin ON public.predictions;
DROP POLICY IF EXISTS tournament_predictions_update_admin ON public.tournament_predictions;

-- 2 ---------------------------------------------------------------------------
ALTER POLICY predictions_update_own_unlocked ON public.predictions
  USING (
    auth.uid() = user_id
    AND (SELECT (((m.kickoff_at - '00:15:00'::interval) > now())
                 AND (m.status <> ALL (ARRAY['finished'::text, 'cancelled'::text, 'postponed'::text])))
             OR (COALESCE(m.predictions_force_open, false)
                 AND (m.status <> ALL (ARRAY['finished'::text, 'cancelled'::text, 'postponed'::text])))
           FROM public.matches m WHERE m.id = predictions.match_id)
  );

ALTER POLICY tournament_predictions_update_own ON public.tournament_predictions
  USING (auth.uid() = user_id AND public.tournament_predictions_open(tournament_id));

-- 3 ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.creditos_se_van_con_la_membresia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.powerup_credits
   WHERE user_id = OLD.user_id AND league_id = OLD.league_id;
  RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION public.creditos_se_van_con_la_membresia() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS creditos_se_van_con_la_membresia ON public.league_members;
CREATE TRIGGER creditos_se_van_con_la_membresia
  AFTER DELETE ON public.league_members
  FOR EACH ROW EXECUTE FUNCTION public.creditos_se_van_con_la_membresia();

-- Comprobaciones ---------------------------------------------------------------
DO $comprobar$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename IN ('predictions', 'tournament_predictions')
     AND cmd IN ('INSERT', 'UPDATE', 'ALL')
     AND (COALESCE(qual, '') || COALESCE(with_check, '')) ILIKE '%is_admin%';
  IF n > 0 THEN RAISE EXCEPTION '99: siguen % políticas de escritura por is_admin en predicciones', n; END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'predictions' AND policyname = 'predictions_update_own_unlocked'
     AND qual ILIKE '%postponed%' AND with_check ILIKE '%postponed%';
  IF n <> 1 THEN RAISE EXCEPTION '99: el USING de predictions_update_own_unlocked no mira el estado'; END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'tournament_predictions' AND policyname = 'tournament_predictions_update_own'
     AND qual ILIKE '%tournament_predictions_open%';
  IF n <> 1 THEN RAISE EXCEPTION '99: el USING de tournament_predictions_update_own no mira el cierre'; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'creditos_se_van_con_la_membresia'
                  AND tgrelid = 'public.league_members'::regclass) THEN
    RAISE EXCEPTION '99: falta el trigger de créditos'; END IF;

  IF has_function_privilege('authenticated', 'public.creditos_se_van_con_la_membresia()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.creditos_se_van_con_la_membresia()', 'EXECUTE') THEN
    RAISE EXCEPTION '99: la función del trigger quedó ejecutable por el cliente'; END IF;
END
$comprobar$;

COMMIT;
