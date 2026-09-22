-- =============================================================================
-- 89 · Una quiniela con pagos no se borra, `leagues` no se escribe desde el
--      cliente, y las votaciones cuentan con un padrón fijo y sin carreras
-- =============================================================================
-- Hallazgos de la tercera auditoría (22 sep 2026), hecha contra producción con
-- JWT reales en transacciones revertidas. Ninguno había hecho daño.
--
-- ANTES DE APLICARLA se corrió `database/humo_rutas_del_cliente.sql`, que
-- recorre como `authenticated` todo lo que la app hace contra la base: dio
-- 21 bien y los dos «ABIERTO» de abajo. Después de aplicarla tiene que dar
-- todo bien. Esa prueba existe porque la 85 rompió el guardado de predicciones
-- y se comprobó con una petición escrita a mano en vez de la que manda la app.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- A) Borrar la quiniela borraba la constancia de los pagos
-- ─────────────────────────────────────────────────────────────────────────────
-- `delete_group` solo pedía ser el creador, y el borrado arrastra en cascada
-- `league_members` —o sea `pago_confirmado_*`—. Con Bundestica hoy: 13 pagos
-- confirmados (₡130.000) desaparecían de un golpe. La 84 le prohíbe a UNA
-- persona salir si tiene un pago confirmado; al creador nadie le prohibía
-- borrar los 13. Decisión del dueño: una quiniela con pagos confirmados no se
-- borra. Para borrarla hay que desconfirmar esos pagos antes, uno por uno,
-- desde el pozo, donde el grupo lo ve.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- B) `leagues` solo estaba cerrada de rebote
-- ─────────────────────────────────────────────────────────────────────────────
-- El creador tenía UPDATE sobre TODAS las columnas —puntaje, cupos de ×2,
-- cuota, `tournament_id`— y DELETE directo. El UPDATE fallaba solo porque un
-- CHECK llama a `powerup_limits_valido`, que no tiene EXECUTE para
-- `authenticated`: `42501 permission denied for function`. El día que alguien
-- le diera ese permiso, el creador cambiaba el puntaje con el torneo en marcha
-- saltándose el candado de `set_group_scoring` y la votación de la 75. El
-- DELETE directo sí pasaba (comprobado, revertido).
--
-- Comprobado antes de cerrarla: las OCHO funciones que escriben `leagues` son
-- SECURITY DEFINER (`create_group`, `delete_group`, `set_group_rules`,
-- `set_group_scoring`, `set_group_extras`, `set_league_pozo`,
-- `set_powerup_limits`, `_apply_rule_proposal`) y el frontend no la escribe por
-- ninguna otra vía — cero `.from('leagues')` en todo `frontend/src`. Mismo
-- arreglo que la 85 le hizo a `league_members`.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- C) Las votaciones: padrón fijo y sin carreras
-- ─────────────────────────────────────────────────────────────────────────────
-- CLAUDE.md decía que «el padrón de una votación se congela al abrirla». Solo
-- era cierta la mitad: el voto de quien se iba seguía contando, pero el
-- DENOMINADOR era la membresía ACTUAL. Así un admin podía expulsar gente hasta
-- alcanzar la mayoría. Y ni votar ni cancelar bloqueaban la fila: si una
-- cancelación y el voto que aprueba coincidían, la propuesta podía quedar
-- «cancelada» con sus cambios ya aplicados.
--
-- Ahora, al abrir una votación se guarda su padrón (`rule_proposal_electores`).
-- Cuentan los votos de ese padrón y la mayoría se mide contra él, así que
-- expulsar a alguien ya no acerca la mayoría. Para votar hay que estar en el
-- padrón Y seguir siendo miembro; un voto ya emitido sigue contando aunque su
-- autor se vaya (decisión del dueño, ya escrita en la 83).
--
-- El conteo vive en UNA función (`_conteo_votacion`) que usan el que cierra
-- por mayoría, el que cierra por vencimiento y la pantalla. Antes eran tres
-- cuentas distintas: justo el error que este repo ya pagó con los puntos de
-- asistidor.
--
-- Una propuesta sin padrón guardado —de antes de esta migración— se cuenta como
-- antes. Hoy hay CERO propuestas en toda la historia, así que no afecta a nada;
-- el respaldo existe para que una propuesta vieja no quede con padrón vacío,
-- que convertiría cualquier «sí» en mayoría.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- A) delete_group se niega con pagos confirmados
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_group(p_league_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_uid uuid := auth.uid(); v_pagos int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leagues WHERE id = p_league_id AND admin_id = v_uid) THEN
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
-- B) leagues: el cliente lee, no escribe
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Crear liga propia"            ON public.leagues;
DROP POLICY IF EXISTS leagues_insert_authenticated   ON public.leagues;
DROP POLICY IF EXISTS "Actualizar liga propia"       ON public.leagues;
DROP POLICY IF EXISTS leagues_update_admin           ON public.leagues;
DROP POLICY IF EXISTS leagues_delete_admin           ON public.leagues;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.leagues FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.leagues IS
  'Quinielas. El cliente solo LEE (RLS: puede_ver_quiniela). Toda escritura pasa por una función '
  'SECURITY DEFINER: create_group, delete_group, set_group_rules, set_group_scoring, set_group_extras, '
  'set_league_pozo, set_powerup_limits, _apply_rule_proposal. No volver a otorgar escritura a '
  'authenticated: migración 89.';

-- -----------------------------------------------------------------------------
-- C) Votaciones: padrón fijo, un solo conteo y bloqueo de la fila
-- -----------------------------------------------------------------------------
-- Sin FK a users a propósito: el padrón es una foto y no se achica sola.
CREATE TABLE IF NOT EXISTS public.rule_proposal_electores (
  proposal_id uuid NOT NULL REFERENCES public.rule_proposals(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  PRIMARY KEY (proposal_id, user_id)
);
ALTER TABLE public.rule_proposal_electores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rule_proposal_electores FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.rule_proposal_electores IS
  'Padrón de cada votación, fijado al abrirla (migración 89). Lo escriben y leen solo funciones SECURITY DEFINER.';

-- El ÚNICO conteo de una votación. Interna: la llaman funciones DEFINER.
CREATE OR REPLACE FUNCTION public._conteo_votacion(p_id uuid)
RETURNS TABLE (padron int, votos_si int, votos_no int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH e AS (SELECT user_id FROM public.rule_proposal_electores WHERE proposal_id = p_id),
       hay AS (SELECT EXISTS (SELECT 1 FROM e) AS con_padron)
  SELECT
    CASE WHEN (SELECT con_padron FROM hay) THEN (SELECT count(*) FROM e)::int
         -- propuesta de antes de la 89: su padrón era la membresía actual
         ELSE (SELECT count(*) FROM public.league_members lm
                 JOIN public.rule_proposals p ON p.league_id = lm.league_id
                WHERE p.id = p_id)::int
    END,
    (SELECT count(*) FROM public.rule_votes v
      WHERE v.proposal_id = p_id AND v.vote
        AND (NOT (SELECT con_padron FROM hay) OR v.user_id IN (SELECT user_id FROM e)))::int,
    (SELECT count(*) FROM public.rule_votes v
      WHERE v.proposal_id = p_id AND NOT v.vote
        AND (NOT (SELECT con_padron FROM hay) OR v.user_id IN (SELECT user_id FROM e)))::int;
$function$;
REVOKE ALL ON FUNCTION public._conteo_votacion(uuid) FROM PUBLIC, anon, authenticated;

-- Abrir: se guarda el padrón ANTES del primer voto.
CREATE OR REPLACE FUNCTION public.propose_rule_change(p_league_id uuid, p_kind text, p_payload jsonb, p_note text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_uid uuid := auth.uid(); v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT public.es_admin_liga(p_league_id, v_uid) THEN
    RAISE EXCEPTION 'Solo un administrador puede proponer cambios';
  END IF;
  IF p_kind NOT IN ('scoring','rules') THEN RAISE EXCEPTION 'Tipo de propuesta inválido'; END IF;
  PERFORM public._resolve_expired_proposals(p_league_id);
  IF EXISTS (SELECT 1 FROM public.rule_proposals WHERE league_id = p_league_id AND status = 'open') THEN
    RAISE EXCEPTION 'Ya hay una propuesta abierta en esta quiniela';
  END IF;
  INSERT INTO public.rule_proposals (league_id, proposed_by, kind, payload, note, expires_at)
  VALUES (p_league_id, v_uid, p_kind, p_payload, NULLIF(btrim(COALESCE(p_note,'')), ''), now() + interval '48 hours')
  RETURNING id INTO v_id;
  INSERT INTO public.rule_proposal_electores (proposal_id, user_id)
  SELECT v_id, lm.user_id FROM public.league_members lm WHERE lm.league_id = p_league_id;
  INSERT INTO public.rule_votes (proposal_id, user_id, vote) VALUES (v_id, v_uid, true);
  PERFORM public._tally_rule_proposal(v_id);
  RETURN v_id;
END; $function$;

-- Cerrar por mayoría: bloquea la fila y cuenta contra el padrón.
CREATE OR REPLACE FUNCTION public._tally_rule_proposal(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_league uuid; c record;
BEGIN
  SELECT league_id INTO v_league FROM public.rule_proposals
   WHERE id = p_id AND status = 'open' FOR UPDATE;
  IF v_league IS NULL THEN RETURN; END IF;
  SELECT * INTO c FROM public._conteo_votacion(p_id);
  IF c.votos_si * 2 > c.padron THEN
    PERFORM public._apply_rule_proposal(p_id);
    UPDATE public.rule_proposals SET status = 'approved', closed_at = now() WHERE id = p_id AND status = 'open';
  ELSIF c.votos_no * 2 >= c.padron THEN
    UPDATE public.rule_proposals SET status = 'rejected', closed_at = now() WHERE id = p_id AND status = 'open';
  END IF;
END; $function$;

-- Cerrar por vencimiento: misma regla de siempre (más sí que no), con el mismo conteo.
CREATE OR REPLACE FUNCTION public._resolve_expired_proposals(p_league_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r record; c record;
BEGIN
  FOR r IN SELECT id FROM public.rule_proposals
            WHERE league_id = p_league_id AND status = 'open'
              AND expires_at IS NOT NULL AND expires_at <= now()
            FOR UPDATE
  LOOP
    SELECT * INTO c FROM public._conteo_votacion(r.id);
    IF c.votos_si > c.votos_no THEN
      PERFORM public._apply_rule_proposal(r.id);
      UPDATE public.rule_proposals SET status = 'approved', closed_at = now() WHERE id = r.id AND status = 'open';
    ELSE
      UPDATE public.rule_proposals SET status = 'rejected', closed_at = now() WHERE id = r.id AND status = 'open';
    END IF;
  END LOOP;
END; $function$;

-- Votar: bloquea la fila, exige padrón y membresía.
CREATE OR REPLACE FUNCTION public.cast_rule_vote(p_proposal_id uuid, p_vote boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_uid uuid := auth.uid(); v_league uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT league_id INTO v_league FROM public.rule_proposals WHERE id = p_proposal_id;
  IF v_league IS NULL THEN RAISE EXCEPTION 'Propuesta inexistente'; END IF;
  PERFORM public._resolve_expired_proposals(v_league);
  PERFORM 1 FROM public.rule_proposals WHERE id = p_proposal_id AND status = 'open' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La propuesta ya no está abierta'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.league_members WHERE league_id = v_league AND user_id = v_uid) THEN
    RAISE EXCEPTION 'No sos miembro de esta quiniela';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rule_proposal_electores WHERE proposal_id = p_proposal_id)
     AND NOT EXISTS (SELECT 1 FROM public.rule_proposal_electores WHERE proposal_id = p_proposal_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'Entraste a la quiniela después de abierta esta votación: no estás en su padrón';
  END IF;
  INSERT INTO public.rule_votes (proposal_id, user_id, vote) VALUES (p_proposal_id, v_uid, p_vote)
  ON CONFLICT (proposal_id, user_id) DO UPDATE SET vote = EXCLUDED.vote, created_at = now();
  PERFORM public._tally_rule_proposal(p_proposal_id);
END; $function$;

-- Cancelar: bloquea la fila; si otro la cerró primero, lo dice.
CREATE OR REPLACE FUNCTION public.cancel_rule_proposal(p_proposal_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_uid uuid := auth.uid(); v_league uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT league_id INTO v_league FROM public.rule_proposals
   WHERE id = p_proposal_id AND status = 'open' FOR UPDATE;
  IF v_league IS NULL OR NOT public.es_admin_liga(v_league, v_uid) THEN
    RAISE EXCEPTION 'Solo un administrador puede cancelar la propuesta abierta';
  END IF;
  UPDATE public.rule_proposals SET status = 'cancelled', closed_at = now()
   WHERE id = p_proposal_id AND status = 'open';
END; $function$;

-- La pantalla muestra el MISMO conteo que decide.
CREATE OR REPLACE FUNCTION public.league_proposals(p_league_id uuid)
RETURNS TABLE(id uuid, kind text, payload jsonb, note text, status text, created_at timestamp with time zone, closed_at timestamp with time zone, expires_at timestamp with time zone, proposed_by uuid, proposer_name text, members integer, yes_count integer, no_count integer, my_vote boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NOT public.puede_ver_quiniela(p_league_id) THEN
    RAISE EXCEPTION 'No sos miembro de esta quiniela';
  END IF;
  PERFORM public._resolve_expired_proposals(p_league_id);
  RETURN QUERY
  SELECT p.id, p.kind, p.payload, p.note, p.status, p.created_at, p.closed_at, p.expires_at,
         p.proposed_by, u.display_name, c.padron, c.votos_si, c.votos_no,
         (SELECT v.vote FROM public.rule_votes v WHERE v.proposal_id = p.id AND v.user_id = auth.uid())
    FROM public.rule_proposals p
    JOIN public.users u ON u.id = p.proposed_by
    CROSS JOIN LATERAL public._conteo_votacion(p.id) c
   WHERE p.league_id = p_league_id
   ORDER BY (p.status = 'open') DESC, p.created_at DESC
   LIMIT 20;
END; $function$;

-- -----------------------------------------------------------------------------
-- Comprobaciones (estado final: una segunda corrida pasa igual)
-- -----------------------------------------------------------------------------
DO $$
DECLARE n int;
BEGIN
  IF pg_get_functiondef('public.delete_group(uuid)'::regprocedure) NOT LIKE '%pago_confirmado_at%' THEN
    RAISE EXCEPTION 'delete_group no mira los pagos confirmados';
  END IF;
  IF has_table_privilege('authenticated','public.leagues','INSERT')
  OR has_table_privilege('authenticated','public.leagues','UPDATE')
  OR has_table_privilege('authenticated','public.leagues','DELETE') THEN
    RAISE EXCEPTION 'leagues sigue siendo escribible por authenticated';
  END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname='public' AND tablename='leagues' AND cmd <> 'SELECT';
  IF n > 0 THEN RAISE EXCEPTION 'leagues conserva % política(s) de escritura', n; END IF;
  IF NOT has_table_privilege('authenticated','public.leagues','SELECT') THEN
    RAISE EXCEPTION 'leagues dejó de ser legible: eso rompe todas las pantallas';
  END IF;
  -- las funciones que la app llama siguen abiertas para authenticated…
  IF NOT has_function_privilege('authenticated','public.delete_group(uuid)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.cast_rule_vote(uuid,boolean)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.cancel_rule_proposal(uuid)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.propose_rule_change(uuid,text,jsonb,text)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.league_proposals(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'una RPC que usa la app perdió su EXECUTE';
  END IF;
  -- …y las internas, cerradas.
  IF has_function_privilege('authenticated','public._conteo_votacion(uuid)','EXECUTE')
  OR has_table_privilege('authenticated','public.rule_proposal_electores','SELECT') THEN
    RAISE EXCEPTION 'el padrón o su conteo quedaron abiertos al cliente';
  END IF;
  IF pg_get_functiondef('public._tally_rule_proposal(uuid)'::regprocedure) NOT LIKE '%_conteo_votacion%'
  OR pg_get_functiondef('public._resolve_expired_proposals(uuid)'::regprocedure) NOT LIKE '%_conteo_votacion%'
  OR pg_get_functiondef('public.league_proposals(uuid)'::regprocedure) NOT LIKE '%_conteo_votacion%' THEN
    RAISE EXCEPTION 'hay un conteo de votos escrito aparte de _conteo_votacion';
  END IF;
  IF pg_get_functiondef('public.cast_rule_vote(uuid,boolean)'::regprocedure) NOT LIKE '%FOR UPDATE%'
  OR pg_get_functiondef('public.cancel_rule_proposal(uuid)'::regprocedure) NOT LIKE '%FOR UPDATE%'
  OR pg_get_functiondef('public._tally_rule_proposal(uuid)'::regprocedure) NOT LIKE '%FOR UPDATE%' THEN
    RAISE EXCEPTION 'votar, cancelar o cerrar ya no bloquean la fila de la propuesta';
  END IF;
  RAISE NOTICE '89 OK';
END $$;

COMMIT;
