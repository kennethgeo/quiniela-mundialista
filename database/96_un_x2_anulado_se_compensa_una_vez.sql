-- =============================================================================
-- 96 · Un ×2 anulado se compensa UNA vez, y quien confirmó un pago no se borra
-- =============================================================================
-- Décima auditoría (Claude, 24 sep 2026; Astra sin uso). Los dos latentes:
-- 0 créditos pagando un ×2 de un partido por jugar; los 13 pagos los confirmó
-- el creador, que ya no se puede borrar (94).
--
-- 1) Doble compensación del ×2 anulado. `consume_powerup_credit` (86) devuelve
--    el crédito que pagó un ×2 cuando ese ×2 se APAGA, y `void_cancelled_match`
--    apaga el ×2 del partido cancelado y además OTORGA el crédito de arrastre.
--    Si ese ×2 se había pagado con un crédito K, la persona recuperaba K y
--    recibía uno nuevo: dos por uno. Reproducido en producción, revertido:
--    «K vuelve a estar libre=t | créditos nuevos por el cancelado=1».
--    Arreglo: la anulación enciende `quiniela.anulando` (set_config local a la
--    transacción, como `quiniela.expulsion_con_pago` de la 92) y el trigger no
--    devuelve con esa marca. K queda consumido y vinculado a la predicción
--    anulada —se conserva el rastro— y la compensación es el crédito nuevo, que
--    va a la PRÓXIMA jornada, como votó el grupo. Apagar el ×2 a mano sigue
--    devolviendo el crédito, igual que antes. El cliente no puede llamar a
--    set_config (PostgREST solo expone `public`).
--
-- 2) `league_members.pago_confirmado_por` era ON DELETE SET NULL: borrar la
--    cuenta del co-admin que confirmó un pago borraba QUIÉN dio fe de él —el
--    pago quedaba confirmado por nadie—. Misma familia que la 95. Ahora
--    RESTRICT, y `delete-user` responde 409.
-- =============================================================================

BEGIN;

ALTER TABLE public.league_members DROP CONSTRAINT IF EXISTS league_members_pago_confirmado_por_fkey;
ALTER TABLE public.league_members
  ADD CONSTRAINT league_members_pago_confirmado_por_fkey
  FOREIGN KEY (pago_confirmado_por) REFERENCES public.users(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.consume_powerup_credit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_llave text; v_base_limit integer; v_current integer;
  v_credit_id uuid; v_activating boolean; v_deactivating boolean;
BEGIN
  v_activating := (NEW.use_powerup_x2 = TRUE)
                  AND (TG_OP = 'INSERT' OR COALESCE(OLD.use_powerup_x2, FALSE) = FALSE);
  v_deactivating := (TG_OP = 'UPDATE')
                    AND COALESCE(OLD.use_powerup_x2, FALSE) = TRUE
                    AND COALESCE(NEW.use_powerup_x2, FALSE) = FALSE;

  IF v_activating AND NEW.league_id IS NOT NULL THEN
    -- LA MISMA llave y EL MISMO cupo que usa check_powerup_limit para dejar
    -- pasar esta activación. Si acá se calculara distinto, el trigger
    -- autorizaría con un crédito que nadie cobra.
    v_llave      := public.llave_cupo(NEW.match_id);
    v_base_limit := public.cupo_powerups(NEW.league_id, NEW.match_id);

    -- Este trigger es AFTER, así que la fila nueva YA cuenta: por eso el
    -- conteo no la excluye y la comparación es `>` y no `>=`.
    SELECT COUNT(*) INTO v_current
      FROM public.predictions p
      JOIN public.matches m ON p.match_id = m.id
     WHERE p.user_id = NEW.user_id
       AND p.league_id = NEW.league_id
       AND p.use_powerup_x2 = TRUE
       AND public.llave_cupo(m.id) = v_llave;

    IF v_current > COALESCE(v_base_limit, 0) THEN
      -- `powerup_credits.phase` guarda la CLAVE de fase (lo escribe así
      -- void_cancelled_match), no `matches.phase`.
      SELECT id INTO v_credit_id
        FROM public.powerup_credits
       WHERE user_id = NEW.user_id
         AND league_id = NEW.league_id
         AND phase || '|' || COALESCE(matchday, 0)::text = v_llave
         AND consumed_at IS NULL
       ORDER BY created_at ASC
       LIMIT 1;
      IF v_credit_id IS NOT NULL THEN
        UPDATE public.powerup_credits
           SET consumed_at = now(), consumed_by_prediction_id = NEW.id
         WHERE id = v_credit_id;
      END IF;
    END IF;
  END IF;

  -- (96) Si lo apaga la ANULACIÓN, el crédito que lo pagó no vuelve:
  -- void_cancelled_match ya otorga el de arrastre por ese mismo ×2.
  IF v_deactivating AND current_setting('quiniela.anulando', true) IS DISTINCT FROM 'on' THEN
    -- Devolver el crédito que pagó ESTA predicción. Sin esto, apagar un ×2 lo
    -- quemaba para siempre, que es justo lo contrario de lo que el grupo votó.
    UPDATE public.powerup_credits
       SET consumed_at = NULL, consumed_by_prediction_id = NULL
     WHERE consumed_by_prediction_id = NEW.id;
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
  -- (96) Apagar el ×2 acá NO es «la persona lo apagó»: el crédito que lo pagó
  -- no se devuelve, porque el ×2 anulado ya se compensa con el crédito de
  -- arrastre de abajo. Sin esto recuperaba dos por uno. Vive solo en esta
  -- transacción y se apaga al terminar, como el permiso de la expulsión.
  PERFORM set_config('quiniela.anulando', 'on', true);
  FOR r IN SELECT p.id, p.user_id, p.league_id, p.use_powerup_x2
             FROM public.predictions p WHERE p.match_id = p_match_id
              FOR UPDATE  -- (95) antes de LEER el ×2: si no, decide con una versión vieja
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
  PERFORM set_config('quiniela.anulando', 'off', true);
  -- Solo las filas que se anularon dejan de estar pendientes (93).
  UPDATE public.predictions SET puntaje_pendiente = false
   WHERE id = ANY (v_vistas) AND puntaje_pendiente;
  UPDATE public.matches
     SET puntuado_con = 'anulado', puntuado_at = clock_timestamp(), puntaje_pendiente_desde = NULL
   WHERE id = p_match_id;
  RETURN jsonb_build_object('status','ok','zeroed',v_zeroed,'refunded',v_refunded);
END; $function$;

DO $$
BEGIN
  IF (SELECT confdeltype FROM pg_constraint WHERE conname = 'league_members_pago_confirmado_por_fkey'
       AND conrelid = 'public.league_members'::regclass) <> 'r' THEN
    RAISE EXCEPTION 'borrar a quien confirmó un pago sigue borrando quién lo confirmó';
  END IF;
  IF pg_get_functiondef('public.consume_powerup_credit()'::regprocedure) NOT LIKE '%quiniela.anulando%'
  OR pg_get_functiondef('public.void_cancelled_match(integer)'::regprocedure) NOT LIKE '%quiniela.anulando%' THEN
    RAISE EXCEPTION 'la anulación sigue devolviendo el crédito además de otorgar uno';
  END IF;
  IF pg_get_functiondef('public.void_cancelled_match(integer)'::regprocedure)
     NOT LIKE '%WHERE p.match_id = p_match_id%FOR UPDATE%LOOP%' THEN
    RAISE EXCEPTION 'void_cancelled_match volvió a leer sin bloquear (95)';
  END IF;
  IF has_function_privilege('anon', 'public.void_cancelled_match(integer)', 'EXECUTE')
  OR has_function_privilege('authenticated', 'public.void_cancelled_match(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'void_cancelled_match quedó abierta al cliente';
  END IF;
  RAISE NOTICE '96 OK';
END $$;

COMMIT;
