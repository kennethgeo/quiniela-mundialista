-- =============================================================================
-- 95 · Las votaciones sobreviven a un borrado de cuenta, y anular no decide
--      con datos viejos
-- =============================================================================
-- Novena auditoría (Astra, 24 sep 2026). Dos hallazgos, los dos latentes:
-- 0 propuestas y 0 votos en producción; el único partido cancelado (252) tiene
-- 0 ×2 prendidos y 0 marcas pendientes.
--
-- 1) Borrar una cuenta borraba decisiones del grupo.
--    `rule_proposals.proposed_by` y `rule_votes.user_id` eran ON DELETE CASCADE.
--    Borrar al co-admin que propuso se llevaba la propuesta con todos sus votos
--    y su padrón; borrar a un votante le quitaba su voto a una mayoría ya
--    emitida, mientras el padrón (`rule_proposal_electores`, sin FK a users)
--    lo seguía contando como elector. La 94 cubrió al creador de la quiniela,
--    no a quien propone o vota.
--    Arreglo inmediato: ON DELETE RESTRICT en las dos. Quien participó en una
--    votación no se puede borrar hasta que exista una forma de conservar su
--    identidad histórica separada de la cuenta. `delete-user` lo dice con un
--    409. Borrar la QUINIELA sigue funcionando: esa cascada entra por
--    `league_id`/`proposal_id`, no por el usuario.
--
-- 2) `void_cancelled_match` leía las predicciones SIN bloquearlas y decidía la
--    devolución del ×2 con lo que había leído. Reproducido con dos conexiones
--    en un Postgres local: B prende el ×2 sin confirmar, A anula (lee el
--    `false` viejo, espera a B en el UPDATE de puntos), B confirma, A sigue con
--    el `false` → partido firmado «anulado», ×2 prendido, sin crédito y la fila
--    ya no pendiente. Con `FOR UPDATE` en el SELECT del bucle, A espera a B
--    ANTES de leer y ve el `true`: apaga el ×2 y otorga el crédito. El orden
--    sigue siendo partido → predicciones, como en `aplicar_puntaje`.
--    CREATE OR REPLACE: conserva el ACL (solo service_role).
-- =============================================================================

BEGIN;

ALTER TABLE public.rule_proposals DROP CONSTRAINT IF EXISTS rule_proposals_proposed_by_fkey;
ALTER TABLE public.rule_proposals
  ADD CONSTRAINT rule_proposals_proposed_by_fkey
  FOREIGN KEY (proposed_by) REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE public.rule_votes DROP CONSTRAINT IF EXISTS rule_votes_user_id_fkey;
ALTER TABLE public.rule_votes
  ADD CONSTRAINT rule_votes_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;

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
  IF (SELECT confdeltype FROM pg_constraint WHERE conname = 'rule_proposals_proposed_by_fkey'
       AND conrelid = 'public.rule_proposals'::regclass) <> 'r'
  OR (SELECT confdeltype FROM pg_constraint WHERE conname = 'rule_votes_user_id_fkey'
       AND conrelid = 'public.rule_votes'::regclass) <> 'r' THEN
    RAISE EXCEPTION 'borrar una cuenta sigue borrando votaciones';
  END IF;
  IF pg_get_functiondef('public.void_cancelled_match(integer)'::regprocedure)
     NOT LIKE '%WHERE p.match_id = p_match_id%FOR UPDATE%LOOP%' THEN
    RAISE EXCEPTION 'void_cancelled_match sigue leyendo las predicciones sin bloquearlas';
  END IF;
  IF has_function_privilege('anon', 'public.void_cancelled_match(integer)', 'EXECUTE')
  OR has_function_privilege('authenticated', 'public.void_cancelled_match(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'void_cancelled_match quedó abierta al cliente';
  END IF;
  RAISE NOTICE '95 OK';
END $$;

COMMIT;
