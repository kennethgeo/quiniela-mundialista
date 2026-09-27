-- =============================================================================
-- 103_indices_y_bitacora_de_compensaciones.sql
-- 27 sep 2026, a pedido del dueño («todo lo que sea seguridad y eficiencia»).
-- No modifica ni borra ninguna fila existente. Idempotente.
-- =============================================================================
--
-- 1. BITÁCORA DE COMPENSACIONES DE ×2.
--    Límite aceptado en la 16.ª/17.ª auditoría: al salir de la quiniela se
--    borran los créditos, así que si la persona vuelve y el MISMO partido se
--    re-anula, se la compensa otra vez (el `ON CONFLICT` que lo impedía ya no
--    encuentra la fila). El dueño eligió no cambiar esa regla, pero sí poder
--    VERLO si pasa. Esta tabla guarda cada compensación otorgada y NO se borra
--    con la membresía (no tiene claves foráneas que caigan en cascada).
--    La llena un trigger AFTER INSERT sobre `powerup_credits`, solo para los
--    créditos de arrastre (con partido de origen): así `void_cancelled_match`
--    no se toca. Un re-anulado que no otorga nada (`ON CONFLICT DO NOTHING`)
--    no inserta crédito y por lo tanto no deja rastro, que es lo correcto.
--    Se siembra con los 5 créditos de arrastre que existen hoy: es una
--    COPIA a una tabla nueva; las filas de `powerup_credits` no se tocan.
--    El cliente no la ve ni la escribe (RLS sin políticas y sin privilegios).
--    `verificar_estado.sql` §20 lista a quien tenga dos compensaciones por el
--    mismo partido.
--
-- 2. ÍNDICES PARA LAS CLAVES FORÁNEAS (asesor de rendimiento de Supabase).
--    Sin índice, borrar una cuenta, una quiniela o un partido recorre la tabla
--    hija entera para cada fila del padre. Con los volúmenes de hoy no se nota;
--    sirven para que los borrados en cascada y los candados que toman sigan
--    siendo cortos cuando la base crezca. Un índice no cambia datos ni
--    resultados de ninguna consulta.
--
-- LO QUE NO SE HIZO, A PROPÓSITO:
--   · Reescribir las 23 políticas con `(select auth.uid())`: con ~1.000 filas
--     no mejora nada medible y tocar políticas es justo donde más fallos
--     salieron en estas auditorías.
--   · Mover la extensión `unaccent` fuera de `public`: la usan funciones
--     existentes; moverla sin necesidad arriesga romperlas.
--   · Las funciones SECURITY DEFINER que el asesor marca como «ejecutables por
--     usuarios»: son las RPC de la app, a propósito, con su control adentro.
--   · Las tablas con RLS y sin políticas: son del backend, a propósito.
-- =============================================================================

BEGIN;

-- 1 ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compensaciones_x2 (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL,
  league_id   uuid NOT NULL,
  match_id    integer NOT NULL,
  credito_id  uuid,
  creada_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.compensaciones_x2 IS
  'Cada crédito de arrastre otorgado por un ×2 anulado. No se borra al salir de la quiniela: sirve para ver si alguien fue compensado dos veces por el mismo partido (migración 103).';

ALTER TABLE public.compensaciones_x2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.compensaciones_x2 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.compensaciones_x2_id_seq FROM PUBLIC, anon, authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS compensaciones_x2_credito_uidx
  ON public.compensaciones_x2 (credito_id) WHERE credito_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS compensaciones_x2_persona_partido_idx
  ON public.compensaciones_x2 (user_id, league_id, match_id);

CREATE OR REPLACE FUNCTION public.registrar_compensacion_x2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.source_match_id IS NOT NULL THEN
    INSERT INTO public.compensaciones_x2 (user_id, league_id, match_id, credito_id)
    VALUES (NEW.user_id, NEW.league_id, NEW.source_match_id, NEW.id)
    ON CONFLICT (credito_id) WHERE credito_id IS NOT NULL DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.registrar_compensacion_x2() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS registrar_compensacion_x2 ON public.powerup_credits;
CREATE TRIGGER registrar_compensacion_x2
  AFTER INSERT ON public.powerup_credits
  FOR EACH ROW EXECUTE FUNCTION public.registrar_compensacion_x2();

-- Siembra: una COPIA de los créditos de arrastre que ya existen.
INSERT INTO public.compensaciones_x2 (user_id, league_id, match_id, credito_id, creada_at)
SELECT pc.user_id, pc.league_id, pc.source_match_id, pc.id, pc.created_at
  FROM public.powerup_credits pc
 WHERE pc.source_match_id IS NOT NULL
ON CONFLICT (credito_id) WHERE credito_id IS NOT NULL DO NOTHING;

-- 2 ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS banned_emails_banned_by_idx            ON public.banned_emails (banned_by);
CREATE INDEX IF NOT EXISTS global_chat_user_id_idx                ON public.global_chat (user_id);
CREATE INDEX IF NOT EXISTS league_members_pago_confirmado_por_idx ON public.league_members (pago_confirmado_por);
CREATE INDEX IF NOT EXISTS leagues_admin_id_idx                   ON public.leagues (admin_id);
CREATE INDEX IF NOT EXISTS leagues_tournament_id_idx              ON public.leagues (tournament_id);
CREATE INDEX IF NOT EXISTS match_audit_changed_by_idx             ON public.match_audit (changed_by);
CREATE INDEX IF NOT EXISTS notification_deliveries_league_id_idx  ON public.notification_deliveries (league_id);
CREATE INDEX IF NOT EXISTS notification_deliveries_match_id_idx   ON public.notification_deliveries (match_id);
CREATE INDEX IF NOT EXISTS powerup_credits_consumed_by_idx        ON public.powerup_credits (consumed_by_prediction_id);
CREATE INDEX IF NOT EXISTS powerup_credits_league_id_idx          ON public.powerup_credits (league_id);
CREATE INDEX IF NOT EXISTS powerup_credits_source_match_id_idx    ON public.powerup_credits (source_match_id);
CREATE INDEX IF NOT EXISTS prediction_logs_match_id_idx           ON public.prediction_logs (match_id);
CREATE INDEX IF NOT EXISTS prediction_logs_prediction_id_idx      ON public.prediction_logs (prediction_id);
CREATE INDEX IF NOT EXISTS prediction_logs_user_id_idx            ON public.prediction_logs (user_id);
CREATE INDEX IF NOT EXISTS rule_proposals_proposed_by_idx         ON public.rule_proposals (proposed_by);
CREATE INDEX IF NOT EXISTS rule_votes_user_id_idx                 ON public.rule_votes (user_id);
CREATE INDEX IF NOT EXISTS tournament_predictions_tournament_id_idx ON public.tournament_predictions (tournament_id);

-- Comprobaciones ---------------------------------------------------------------
DO $comprobar$
DECLARE n_origen int; n_bitacora int;
BEGIN
  SELECT count(*) INTO n_origen FROM public.powerup_credits WHERE source_match_id IS NOT NULL;
  SELECT count(*) INTO n_bitacora FROM public.compensaciones_x2
   WHERE credito_id IN (SELECT id FROM public.powerup_credits WHERE source_match_id IS NOT NULL);
  IF n_bitacora <> n_origen THEN
    RAISE EXCEPTION '103: la bitácora tiene % de % compensaciones', n_bitacora, n_origen; END IF;
  IF has_table_privilege('authenticated', 'public.compensaciones_x2', 'SELECT')
     OR has_table_privilege('anon', 'public.compensaciones_x2', 'SELECT')
     OR has_function_privilege('authenticated', 'public.registrar_compensacion_x2()', 'EXECUTE') THEN
    RAISE EXCEPTION '103: la bitácora quedó al alcance del cliente'; END IF;
END
$comprobar$;

COMMIT;
