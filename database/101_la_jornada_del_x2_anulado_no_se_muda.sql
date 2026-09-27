-- =============================================================================
-- 101_la_jornada_del_x2_anulado_no_se_muda.sql
-- Decimosexta auditoría (Astra, 27 sep 2026). Idempotente.
-- =============================================================================
--
-- 1. REPROGRAMAR A OTRA JORNADA DEVOLVÍA EL CUPO DEL ×2 ANULADO.
--    `_x2_cuenta` ubicaba cada ×2 anulado por la jornada ACTUAL de su partido
--    (`llave_cupo(source_match_id)`). Si el sync reprograma el pospuesto a
--    otra jornada, el anulado dejaba de ocupar su lugar en la original y la
--    persona podía prender otro ×2 ahí, además de conservar la compensación.
--    Reproducido por Astra: «J1 antes usados=1 → después usados=0; otro ×2 en
--    J1 aceptado». Contradice la decisión del dueño (97): en su jornada sigue
--    contando como usado.
--    Arreglo: `powerup_credits.origen_llave` guarda la bolsa del partido AL
--    ANULARLO, y la cuenta, la pantalla y la resolución de pendientes la usan.
--    Las filas viejas (sin el dato) caen al cálculo de antes: hoy son 5, todas
--    del partido 252, que sigue cancelado en su jornada (medido): la cuenta no
--    cambia para nadie y no se escribe ningún dato de producción.
--
-- 2. UN PATCH DEL MIEMBRO PODÍA TUMBAR SU PROPIA EXPULSIÓN.
--    El trigger de la 100 toma la membresía DESPUÉS de que un UPDATE directo
--    bloqueó la fila de la predicción, y expulsar/salir toman la membresía y
--    DESPUÉS borran esas filas. REPRODUCIDO con dos conexiones en Postgres 16
--    local: `deadlock detected` y la base cancelaba LA EXPULSIÓN. La app no
--    manda PATCH (solo upsert, que toma la membresía primero), pero cualquiera
--    puede mandarlo a mano. Arreglo: salir y expulsar reintentan hasta tres
--    veces si son la víctima; el subbloque suelta sus candados, el guardado
--    termina y la vuelta siguiente borra también lo que guardó.
-- =============================================================================

BEGIN;

ALTER TABLE public.powerup_credits ADD COLUMN IF NOT EXISTS origen_llave text;
COMMENT ON COLUMN public.powerup_credits.origen_llave IS
  'Bolsa (clave de fase|jornada) del partido anulado AL anularse; no cambia si el partido se reprograma (migración 101).';

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
          AND COALESCE(pc.origen_llave, public.llave_cupo(pc.source_match_id)) = p_llave) )::integer,
    (SELECT count(*) FROM public.powerup_credits pc
      WHERE pc.user_id = p_user AND pc.league_id = p_league
        AND pc.phase || '|' || COALESCE(pc.matchday, 0)::text = p_llave)::integer;
$$;

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
      INSERT INTO public.powerup_credits (user_id, league_id, phase, matchday, source_match_id, origen_llave)
      VALUES (r.user_id, r.league_id, v_next_phase, v_next_matchday, p_match_id, v_llave)
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
    SELECT pc.id, sm.kickoff_at AS src_kickoff, COALESCE(pc.origen_llave, public.llave_cupo(sm.id)) AS src_llave
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
            SELECT COALESCE(pc.origen_llave, public.llave_cupo(pc.source_match_id))
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
  v_intento integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT admin_id INTO v_creador FROM public.leagues WHERE id = p_league_id;
  IF v_creador IS NULL THEN
    RAISE EXCEPTION 'Esa quiniela no existe';
  END IF;

  IF v_uid = v_creador THEN
    RAISE EXCEPTION 'Creaste esta quiniela, así que no podés salirte: o la dejás activa, o la borrás desde el panel de administración';
  END IF;

  -- (101) Un guardado que ya bloqueó una predicción y espera la membresía
  -- (PATCH directo) cruza con esta salida. Si la base la elige como víctima,
  -- se reintenta: el subbloque suelta sus candados, el guardado termina y la
  -- segunda vuelta borra también lo que guardó.
  FOR v_intento IN 1..3 LOOP
    BEGIN
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
      EXIT;
    EXCEPTION WHEN deadlock_detected THEN
      IF v_intento = 3 THEN RAISE; END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'predicciones_borradas', v_predicciones,
    'globales_borradas', v_globales);
END;
$function$;

CREATE OR REPLACE FUNCTION public.expulsar_miembro(p_league_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_creador uuid; v_intento integer;
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

  -- (101) Igual que salir: si un PATCH del miembro se cruza y la base elige
  -- la expulsión como víctima, se reintenta. Así nadie esquiva que lo echen
  -- mandando guardados.
  FOR v_intento IN 1..3 LOOP
    BEGIN
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
      EXIT;
    EXCEPTION WHEN deadlock_detected THEN
      PERFORM set_config('quiniela.expulsion_con_pago', 'off', true);
      IF v_intento = 3 THEN RAISE; END IF;
    END;
  END LOOP;
END; $function$;


-- Comprobaciones ---------------------------------------------------------------
DO $comprobar$
BEGIN
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public._x2_cuenta(uuid,uuid,text,integer)'::regprocedure) NOT LIKE '%origen_llave%'
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public.void_cancelled_match(integer)'::regprocedure) NOT LIKE '%origen_llave%'
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public.my_powerup_credits(uuid)'::regprocedure) NOT LIKE '%origen_llave%'
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public.resolve_pending_powerup_credits(integer)'::regprocedure) NOT LIKE '%origen_llave%' THEN
    RAISE EXCEPTION '101: alguna función sigue ubicando el ×2 anulado por la jornada actual';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.salir_de_quiniela(uuid)'::regprocedure) NOT LIKE '%deadlock_detected%'
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public.expulsar_miembro(uuid,uuid)'::regprocedure) NOT LIKE '%deadlock_detected%' THEN
    RAISE EXCEPTION '101: salir/expulsar sin reintento';
  END IF;
  IF has_function_privilege('authenticated', 'public._x2_cuenta(uuid,uuid,text,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.void_cancelled_match(integer)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.salir_de_quiniela(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.expulsar_miembro(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.my_powerup_credits(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '101: los permisos de las funciones cambiaron';
  END IF;
END
$comprobar$;

COMMIT;
