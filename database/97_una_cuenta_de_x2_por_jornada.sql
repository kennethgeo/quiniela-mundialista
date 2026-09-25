-- =============================================================================
-- 97 · Una sola cuenta de ×2 por jornada: el anulado se compensa UNA vez
-- =============================================================================
-- Undécima auditoría (Astra, 25 sep 2026). Tres hallazgos en los créditos, los
-- tres latentes: 0 bolsas con más de un crédito, 0 créditos consumidos por
-- predicciones anuladas. Pero el 297 (jornada 10, dos ×2 hoy) si se cancelara
-- mandaba su arrastre a la MISMA jornada 10.
--
-- DECISIÓN DEL DUEÑO (25 sep 2026): un ×2 anulado se compensa UNA vez, con un
-- crédito para la PRÓXIMA jornada. En la jornada del partido anulado ese ×2
-- sigue contando como usado, haya salido del cupo o de un crédito. Antes era
-- inconsistente: del cupo liberaba el lugar Y daba crédito; de un crédito (96)
-- solo daba el crédito.
--
-- 1) El crédito compensado podía RESUCITAR. La 96 dejaba K consumido al anular,
--    pero si el partido era pospuesto y se volvía a prender y apagar el ×2, el
--    apagado devolvía TODOS los créditos de esa predicción, K incluido.
--    Ahora K queda marcado `sustituido_at` y ningún apagado lo devuelve.
-- 2) Dos créditos no dejaban usar los dos. El que autoriza comparaba los ×2
--    activos contra «cupo + créditos LIBRES»: un crédito consumido salía del
--    lado derecho mientras su ×2 seguía en el izquierdo. La pantalla tenía el
--    mismo error. Ahora los dos cuentan «cupo + TODOS los créditos de la
--    jornada» contra «×2 activos + ×2 anulados de la jornada».
-- 3) El arrastre iba al siguiente PARTIDO, no a la siguiente JORNADA: anular el
--    primer partido de una jornada lo dejaba en esa misma. Ahora va a la
--    primera bolsa cronológica DISTINTA (sirve también para eliminatorias,
--    donde no alcanza con sumar 1 a matchday). Igual en la resolución tardía.
--
-- UNA SOLA CUENTA: `_x2_cuenta()` la usan el que autoriza (check_powerup_limit),
-- el que cobra (consume_powerup_credit) y la pantalla (my_powerup_credits
-- devuelve el ajuste neto por jornada, calculado CON `_x2_cuenta`). Es el error crónico del proyecto —la
-- misma regla escrita dos veces—, así que se escribe una.
-- Reemplaza la marca `quiniela.anulando` de la 96: la anulación ahora marca el
-- crédito como sustituido ANTES de apagar el ×2, y el apagado solo devuelve lo
-- no sustituido.
-- =============================================================================

BEGIN;

ALTER TABLE public.powerup_credits ADD COLUMN IF NOT EXISTS sustituido_at timestamptz;
COMMENT ON COLUMN public.powerup_credits.sustituido_at IS
  'El ×2 que pagó este crédito se anuló y ya se compensó con un arrastre: no vuelve al saldo (migración 97).';

-- La cuenta de una bolsa (persona, quiniela, clave de fase|jornada).
--   usados   = ×2 activos en la bolsa (sin contar p_excluir) + ×2 ANULADOS cuyo
--              partido es de la bolsa (cada arrastre otorgado ocupa su lugar).
--   creditos = TODOS los créditos asignados a la bolsa: libres, pagando un ×2
--              activo, o sustituidos. El sustituido pagó un lugar que SIGUE
--              ocupado —el del ×2 anulado, contado en `usados`—; sacarlo de la
--              capacidad cobraría ese lugar dos veces. Lo único que lo
--              distingue es que ningún apagado lo devuelve.
-- Se autoriza mientras usados < cupo + creditos.
CREATE OR REPLACE FUNCTION public._x2_cuenta(p_user uuid, p_league uuid, p_llave text, p_excluir integer)
RETURNS TABLE(usados integer, creditos integer)
LANGUAGE sql STABLE SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT
    ( (SELECT count(*) FROM public.predictions p
        WHERE p.user_id = p_user AND p.league_id = p_league AND p.use_powerup_x2
          AND p.match_id IS DISTINCT FROM p_excluir
          AND public.llave_cupo(p.match_id) = p_llave)
    + (SELECT count(*) FROM public.powerup_credits pc
        WHERE pc.user_id = p_user AND pc.league_id = p_league
          AND pc.source_match_id IS NOT NULL
          AND public.llave_cupo(pc.source_match_id) = p_llave) )::integer,
    (SELECT count(*) FROM public.powerup_credits pc
      WHERE pc.user_id = p_user AND pc.league_id = p_league
        AND pc.phase || '|' || COALESCE(pc.matchday, 0)::text = p_llave)::integer;
$$;
REVOKE ALL ON FUNCTION public._x2_cuenta(uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.check_powerup_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_llave text; v_base integer; v_usados integer; v_creditos integer;
  v_activating boolean; v_prev_x2 boolean;
BEGIN
  SELECT use_powerup_x2 INTO v_prev_x2 FROM public.predictions
   WHERE user_id=NEW.user_id AND league_id=NEW.league_id AND match_id=NEW.match_id;
  v_activating := (NEW.use_powerup_x2 = TRUE) AND (COALESCE(v_prev_x2,FALSE)=FALSE);
  IF v_activating AND NEW.league_id IS NOT NULL THEN
    v_llave := public.llave_cupo(NEW.match_id);
    PERFORM pg_advisory_xact_lock(hashtextextended(
      NEW.user_id::text || NEW.league_id::text || COALESCE(v_llave,''), 0));
    v_base := public.cupo_powerups(NEW.league_id, NEW.match_id);
    -- (97) La misma cuenta que usan el que cobra y la pantalla.
    SELECT c.usados, c.creditos INTO v_usados, v_creditos
      FROM public._x2_cuenta(NEW.user_id, NEW.league_id, v_llave, NEW.match_id) c;
    IF v_usados >= COALESCE(v_base,0) + COALESCE(v_creditos,0) THEN
      RAISE EXCEPTION 'Límite de comodines x2 alcanzado para esta jornada.';
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.consume_powerup_credit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_llave text; v_base integer; v_usados integer; v_creditos integer;
  v_consumidos integer; v_necesarios integer; v_credit_id uuid;
  v_activating boolean; v_deactivating boolean;
BEGIN
  v_activating := (NEW.use_powerup_x2 = TRUE)
                  AND (TG_OP = 'INSERT' OR COALESCE(OLD.use_powerup_x2, FALSE) = FALSE);
  v_deactivating := (TG_OP = 'UPDATE')
                    AND COALESCE(OLD.use_powerup_x2, FALSE) = TRUE
                    AND COALESCE(NEW.use_powerup_x2, FALSE) = FALSE;
  IF NOT (v_activating OR v_deactivating) OR NEW.league_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_llave := public.llave_cupo(NEW.match_id);
  -- (97) También al apagar: el reacomodo toca los créditos de la bolsa.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.user_id::text || NEW.league_id::text || COALESCE(v_llave,''), 0));

  IF v_deactivating THEN
    -- Devolver lo que pagó ESTA predicción, salvo lo que ya se compensó con
    -- un arrastre (sustituido): eso no vuelve nunca (hallazgo 1).
    UPDATE public.powerup_credits
       SET consumed_at = NULL, consumed_by_prediction_id = NULL
     WHERE consumed_by_prediction_id = NEW.id AND sustituido_at IS NULL;
  END IF;

  -- Este trigger es AFTER: la fila nueva ya cuenta en `usados`.
  v_base := COALESCE(public.cupo_powerups(NEW.league_id, NEW.match_id), 0);
  SELECT c.usados, c.creditos INTO v_usados, v_creditos
    FROM public._x2_cuenta(NEW.user_id, NEW.league_id, v_llave, NULL) c;
  v_necesarios := GREATEST(v_usados - v_base, 0);
  -- Consumidos incluye los sustituidos: pagan el lugar del ×2 anulado.
  SELECT count(*) INTO v_consumidos FROM public.powerup_credits
   WHERE user_id = NEW.user_id AND league_id = NEW.league_id
     AND consumed_at IS NOT NULL
     AND phase || '|' || COALESCE(matchday, 0)::text = v_llave;

  IF v_consumidos < v_necesarios AND v_activating THEN
    -- Por encima del cupo: lo paga el crédito libre más viejo.
    SELECT id INTO v_credit_id FROM public.powerup_credits
     WHERE user_id = NEW.user_id AND league_id = NEW.league_id
       AND consumed_at IS NULL AND sustituido_at IS NULL
       AND phase || '|' || COALESCE(matchday, 0)::text = v_llave
     ORDER BY created_at ASC LIMIT 1;
    IF v_credit_id IS NOT NULL THEN
      UPDATE public.powerup_credits
         SET consumed_at = now(), consumed_by_prediction_id = NEW.id
       WHERE id = v_credit_id;
    END IF;
  ELSIF v_consumidos > v_necesarios THEN
    -- Sobran créditos pagando: se liberaron lugares del cupo (se apagó un ×2
    -- que iba por el cupo). Se devuelven los más nuevos, para no dejar un
    -- crédito atado a un ×2 que ya entra en el cupo. Nunca un sustituido.
    UPDATE public.powerup_credits
       SET consumed_at = NULL, consumed_by_prediction_id = NULL
     WHERE id IN (SELECT id FROM public.powerup_credits
                   WHERE user_id = NEW.user_id AND league_id = NEW.league_id
                     AND consumed_at IS NOT NULL AND sustituido_at IS NULL
                     AND phase || '|' || COALESCE(matchday, 0)::text = v_llave
                   ORDER BY consumed_at DESC
                   LIMIT v_consumidos - v_necesarios);
  END IF;

  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.void_cancelled_match(p_match_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text; v_tid int; v_kickoff timestamptz; v_llave text;
  v_next_phase text; v_next_matchday integer;
  r record; v_zeroed int := 0; v_refunded int := 0; v_vistas uuid[] := '{}';
  v_nuevo uuid;
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
  v_llave := public.llave_cupo(p_match_id);
  -- (97) La PRÓXIMA JORNADA, no el próximo partido: la primera bolsa
  -- cronológica distinta de la del anulado.
  SELECT public.clave_fase(m.phase, m.stage), m.matchday
    INTO v_next_phase, v_next_matchday
    FROM public.matches m
   WHERE m.tournament_id = v_tid AND m.kickoff_at > v_kickoff
     AND m.status NOT IN ('cancelled','postponed')
     AND public.llave_cupo(m.id) IS DISTINCT FROM v_llave
   ORDER BY m.kickoff_at ASC LIMIT 1;
  -- (97) Los candados de cupo de cada persona ANTES que las filas, en el mismo
  -- orden que toma quien prende un ×2 (candado y después su fila).
  PERFORM pg_advisory_xact_lock(hashtextextended(k, 0))
     FROM (SELECT DISTINCT p.user_id::text || p.league_id::text || COALESCE(v_llave,'') AS k
             FROM public.predictions p WHERE p.match_id = p_match_id AND p.league_id IS NOT NULL
            ORDER BY 1) s;
  FOR r IN SELECT p.id, p.user_id, p.league_id, p.use_powerup_x2
             FROM public.predictions p WHERE p.match_id = p_match_id
              FOR UPDATE  -- (95) antes de LEER el ×2: si no, decide con una versión vieja
  LOOP
    v_vistas := v_vistas || r.id;
    UPDATE public.predictions SET points_earned = 0 WHERE id = r.id;
    v_zeroed := v_zeroed + 1;
    IF r.use_powerup_x2 THEN
      -- (97) Orden: primero el arrastre (así el lugar sigue ocupado en su
      -- jornada cuando se apague el ×2), después marcar sustituido lo que lo
      -- pagó, y recién entonces apagar. Una sola compensación por partido:
      -- si ya se otorgó antes (partido pospuesto, re-anulado), no se sustituye
      -- nada y el apagado devuelve lo que pagó el ×2 nuevo.
      v_nuevo := NULL;
      INSERT INTO public.powerup_credits (user_id, league_id, phase, matchday, source_match_id)
      VALUES (r.user_id, r.league_id, v_next_phase, v_next_matchday, p_match_id)
      ON CONFLICT (user_id, league_id, source_match_id) DO NOTHING
      RETURNING id INTO v_nuevo;
      IF v_nuevo IS NOT NULL THEN
        UPDATE public.powerup_credits SET sustituido_at = now()
         WHERE consumed_by_prediction_id = r.id AND sustituido_at IS NULL;
        v_refunded := v_refunded + 1;
      END IF;
      UPDATE public.predictions SET use_powerup_x2 = FALSE WHERE id = r.id;
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

CREATE OR REPLACE FUNCTION public.resolve_pending_powerup_credits(p_tournament_id integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record; v_next_phase text; v_next_matchday integer; v_resolved int := 0;
BEGIN
  IF NOT public.es_backend()
     AND COALESCE((SELECT is_admin FROM public.users WHERE id = auth.uid()), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Solo un administrador puede resolver créditos pendientes';
  END IF;
  FOR r IN
    SELECT pc.id, sm.kickoff_at AS src_kickoff, public.llave_cupo(sm.id) AS src_llave
      FROM public.powerup_credits pc
      JOIN public.leagues l ON l.id = pc.league_id
      JOIN public.matches sm ON sm.id = pc.source_match_id
     WHERE l.tournament_id = p_tournament_id
       AND pc.phase IS NULL AND pc.consumed_at IS NULL
  LOOP
    -- (97) La próxima JORNADA distinta de la del partido anulado.
    SELECT public.clave_fase(m.phase, m.stage), m.matchday
      INTO v_next_phase, v_next_matchday
      FROM public.matches m
     WHERE m.tournament_id = p_tournament_id
       AND m.kickoff_at > r.src_kickoff
       AND m.status NOT IN ('cancelled','postponed')
       AND public.llave_cupo(m.id) IS DISTINCT FROM r.src_llave
     ORDER BY m.kickoff_at ASC LIMIT 1;
    IF v_next_phase IS NOT NULL THEN
      UPDATE public.powerup_credits
         SET phase = v_next_phase, matchday = v_next_matchday
       WHERE id = r.id;
      v_resolved := v_resolved + 1;
    END IF;
  END LOOP;
  RETURN v_resolved;
END; $function$;

-- La pantalla calcula «límite = cupo + ajuste» y «usados = ×2 activos». Para
-- que diga lo mismo que el trigger, el ajuste es la MISMA cuenta:
-- créditos de la jornada (todos) MENOS los ×2 anulados de esa jornada.
-- Puede ser negativo (un ×2 anulado que salió del cupo sigue ocupándolo).
-- Antes devolvía solo los créditos LIBRES: con uno consumido, la pantalla
-- mostraba un lugar menos del que había (hallazgo 2, del lado del cliente).
-- (Solo lee y solo lo del que llama: no expone nada que la pantalla no mostrara.)
CREATE OR REPLACE FUNCTION public.my_powerup_credits(p_league_id uuid)
 RETURNS TABLE(phase text, matchday integer, credits integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  -- Solo LEE y solo lo del que llama. Las jornadas con algo que ajustar:
  -- donde hay créditos asignados o donde se anuló un ×2. La cuenta es la de
  -- `_x2_cuenta` (no una copia): ajuste = créditos − usados + activos, o sea
  -- créditos − ×2 anulados. Los pendientes (phase NULL) no se muestran.
  RETURN QUERY
    SELECT split_part(b.llave, '|', 1), split_part(b.llave, '|', 2)::int,
           (c.creditos - c.usados
            + (SELECT count(*) FROM public.predictions p
                WHERE p.user_id = v_uid AND p.league_id = p_league_id AND p.use_powerup_x2
                  AND public.llave_cupo(p.match_id) = b.llave))::int
      FROM (SELECT pc.phase || '|' || COALESCE(pc.matchday, 0)::text AS llave
              FROM public.powerup_credits pc
             WHERE pc.user_id = v_uid AND pc.league_id = p_league_id AND pc.phase IS NOT NULL
            UNION
            SELECT public.llave_cupo(pc.source_match_id)
              FROM public.powerup_credits pc
             WHERE pc.user_id = v_uid AND pc.league_id = p_league_id AND pc.source_match_id IS NOT NULL) b,
           LATERAL public._x2_cuenta(v_uid, p_league_id, b.llave, NULL) c
     WHERE b.llave IS NOT NULL
       AND c.creditos - c.usados
           + (SELECT count(*) FROM public.predictions p
               WHERE p.user_id = v_uid AND p.league_id = p_league_id AND p.use_powerup_x2
                 AND public.llave_cupo(p.match_id) = b.llave) <> 0;
END;
$function$;

DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public._x2_cuenta(uuid,uuid,text,integer)', 'EXECUTE')
  OR has_function_privilege('anon', 'public._x2_cuenta(uuid,uuid,text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '_x2_cuenta quedó abierta al cliente';
  END IF;
  IF has_function_privilege('anon', 'public.void_cancelled_match(integer)', 'EXECUTE')
  OR has_function_privilege('authenticated', 'public.void_cancelled_match(integer)', 'EXECUTE')
  OR has_function_privilege('authenticated', 'public.resolve_pending_powerup_credits(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'una función de créditos quedó abierta al cliente';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.my_powerup_credits(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'my_powerup_credits perdió el permiso del cliente';
  END IF;
  IF pg_get_functiondef('public.check_powerup_limit()'::regprocedure) NOT LIKE '%_x2_cuenta%'
  OR pg_get_functiondef('public.consume_powerup_credit()'::regprocedure) NOT LIKE '%_x2_cuenta%'
  OR pg_get_functiondef('public.my_powerup_credits(uuid)'::regprocedure) NOT LIKE '%_x2_cuenta%' THEN
    RAISE EXCEPTION 'el que autoriza, el que cobra y la pantalla no usan la misma cuenta';
  END IF;
  IF pg_get_functiondef('public.void_cancelled_match(integer)'::regprocedure)
     NOT LIKE '%WHERE p.match_id = p_match_id%FOR UPDATE%LOOP%' THEN
    RAISE EXCEPTION 'void_cancelled_match volvió a leer sin bloquear (95)';
  END IF;
  RAISE NOTICE '97 OK';
END $$;

COMMIT;
