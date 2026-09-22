-- =============================================================================
-- 88 · Tres cosas que parecían resueltas y no lo estaban
-- =============================================================================
-- Hallazgos 3, 4 y 5 de la segunda auditoría de Astra (22 sep 2026), los tres
-- confirmados leyendo las funciones de producción. Ninguno había hecho daño
-- todavía; los tres lo habrían hecho sin avisar.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- A) Cambiar la cuota reescribía el dinero ya recaudado
-- ─────────────────────────────────────────────────────────────────────────────
-- `league_pozo` calculaba `recaudado = cuota ACTUAL × pagos confirmados`, y
-- `set_league_pozo` deja cambiar la cuota sin mirar nada. Con los 13 pagos
-- confirmados de Bundestica (₡130.000), subir la cuota a ₡20.000 habría hecho
-- figurar ₡260.000 recaudados sin que nadie pagara un colón más. En una
-- quiniela por plata, la constancia de un pago no puede depender de un número
-- que se edita después.
--
-- Cada pago confirmado guarda ahora SU monto y SU moneda en el momento de
-- confirmarse, y `recaudado` suma eso. Los 13 pagos existentes no tienen monto
-- registrado —no se inventa: rellenarlos es una escritura en producción y la
-- decide el dueño—, así que:
--   · la cuota NO se puede cambiar mientras haya pagos confirmados sin monto;
--   · la moneda NO se puede cambiar mientras haya CUALQUIER pago confirmado
--     (sumar colones y dólares no da un número);
--   · el reparto de premios sí se puede tocar: no reescribe ningún pago.
-- La regla va en un TRIGGER sobre `leagues`, no dentro de `set_league_pozo`:
-- así la cubre cualquier camino que escriba la cuota, incluida una votación
-- aplicada por `_apply_rule_proposal`. Un pago confirmado que falta se sigue
-- sumando con la cuota vigente, igual que antes: el comportamiento de hoy no
-- cambia hasta que exista un monto con el que reemplazarlo.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- B) El reintento de puntaje de la 86 no podía dispararse nunca
-- ─────────────────────────────────────────────────────────────────────────────
-- `partidos_sin_puntuar` buscaba `points_earned IS NULL`, pero la columna nace
-- en 0: medido, **0 NULL en toda la tabla** y las 249 predicciones de partidos
-- por jugar en 0. Un puntaje que falla antes de escribir deja ceros que se
-- confunden con un cero legítimo. El arreglo del PR #176 era un no-op, y sus
-- pruebas pasaban porque sus datos usaban `None`, que la base real no produce.
--
-- `matches.puntuado_con` guarda la FIRMA del resultado que se puntuó (goles,
-- penales y quién pasó). La escribe el motor al terminar, y el sync reintenta
-- cualquier partido terminado cuya firma no coincida con su resultado actual.
-- Así el cero vuelve a ser un puntaje válido, y la marca queda atada al
-- resultado: si el admin corrige el marcador y el re-puntaje falla, la firma
-- vieja ya no coincide y se reintenta.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- C) El backend sabía reintentar avisos y el cron no lo llamaba
-- ─────────────────────────────────────────────────────────────────────────────
-- `cron_recordatorio_saque` solo llama al backend si hay partidos entre 40 y 65
-- minutos del saque. El backend reintenta un aviso fallido mientras falten más
-- de 15 minutos, pero si a los 35 no hay otro partido en ventana, nadie lo
-- llama. Es «la alarma existía y miraba al lado» una vez más: la misma forma
-- que la puerta del cron de la migración 81.
--
-- La puerta se abre también cuando hay un aviso fallido o abandonado cuyo
-- partido sigue abierto. Es un SUPERCONJUNTO a propósito: la puerta decide si
-- vale la pena llamar; qué se manda lo decide el backend.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- A) Pagos: cada confirmación guarda su monto
-- -----------------------------------------------------------------------------
ALTER TABLE public.league_members
  ADD COLUMN IF NOT EXISTS pago_confirmado_monto  numeric,
  ADD COLUMN IF NOT EXISTS pago_confirmado_moneda text;

COMMENT ON COLUMN public.league_members.pago_confirmado_monto IS
  'Cuota vigente en el momento de confirmar el pago. NULL en los pagos confirmados antes de la migración 88.';

CREATE OR REPLACE FUNCTION public.confirmar_pago(p_league_id uuid, p_user_id uuid, p_confirmado boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_uid uuid := auth.uid(); v_cuota numeric; v_moneda text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT public.es_admin_liga(p_league_id, v_uid) THEN
    RAISE EXCEPTION 'Solo un administrador puede confirmar pagos';
  END IF;
  IF p_user_id = v_uid THEN RAISE EXCEPTION 'No podés confirmar tu propio pago'; END IF;
  SELECT cuota, COALESCE(moneda, 'CRC') INTO v_cuota, v_moneda FROM public.leagues WHERE id = p_league_id;
  UPDATE public.league_members SET
    pago_confirmado_at     = CASE WHEN p_confirmado THEN now()   ELSE NULL END,
    pago_confirmado_por    = CASE WHEN p_confirmado THEN v_uid   ELSE NULL END,
    pago_confirmado_monto  = CASE WHEN p_confirmado THEN v_cuota ELSE NULL END,
    pago_confirmado_moneda = CASE WHEN p_confirmado THEN v_moneda ELSE NULL END
  WHERE league_id = p_league_id AND user_id = p_user_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.league_pozo(p_league_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_uid uuid := auth.uid(); v_l record; v_miembros int; v_pagados int;
        v_recaudado numeric; v_gente jsonb;
BEGIN
  IF NOT public.puede_ver_quiniela(p_league_id) THEN
    RAISE EXCEPTION 'No sos miembro de esta quiniela';
  END IF;
  SELECT id, admin_id, cuota, moneda, premios_reparto INTO v_l FROM public.leagues WHERE id = p_league_id;
  SELECT count(*),
         count(*) FILTER (WHERE lm.pago_confirmado_at IS NOT NULL),
         -- Lo que se confirmó, no lo que la cuota dice HOY. Un pago de antes
         -- de la 88 no tiene monto y cae a la cuota vigente, como siempre.
         COALESCE(SUM(COALESCE(lm.pago_confirmado_monto, v_l.cuota, 0))
                  FILTER (WHERE lm.pago_confirmado_at IS NOT NULL), 0)
    INTO v_miembros, v_pagados, v_recaudado
    FROM public.league_members lm WHERE lm.league_id = p_league_id;
  SELECT jsonb_agg(x ORDER BY x->>'display_name') INTO v_gente FROM (
    SELECT jsonb_build_object(
      'user_id', u.id, 'display_name', u.display_name, 'avatar_url', u.avatar_url,
      'es_admin', (u.id = v_l.admin_id OR lm.es_admin),
      'soy_yo', (u.id = v_uid),
      'aviso', (lm.pago_avisado_at IS NOT NULL),
      'confirmado', (lm.pago_confirmado_at IS NOT NULL)
    ) AS x
    FROM public.league_members lm JOIN public.users u ON u.id = lm.user_id
    WHERE lm.league_id = p_league_id
  ) s;
  RETURN jsonb_build_object(
    'cuota', v_l.cuota, 'moneda', v_l.moneda, 'reparto', v_l.premios_reparto,
    'soy_admin', public.es_admin_liga(p_league_id, v_uid),
    'miembros', v_miembros, 'pagados', v_pagados,
    'pozo_total', COALESCE(v_l.cuota, 0) * v_miembros,
    'recaudado', v_recaudado,
    'gente', COALESCE(v_gente, '[]'::jsonb)
  );
END; $function$;

CREATE OR REPLACE FUNCTION public.cuota_no_reescribe_pagos()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_sin_monto int; v_confirmados int;
BEGIN
  SELECT count(*) FILTER (WHERE pago_confirmado_at IS NOT NULL),
         count(*) FILTER (WHERE pago_confirmado_at IS NOT NULL AND pago_confirmado_monto IS NULL)
    INTO v_confirmados, v_sin_monto
    FROM public.league_members WHERE league_id = NEW.id;

  IF COALESCE(NEW.moneda, 'CRC') IS DISTINCT FROM COALESCE(OLD.moneda, 'CRC') AND v_confirmados > 0 THEN
    RAISE EXCEPTION 'No se puede cambiar la moneda: hay % pago(s) confirmado(s) en la moneda actual.', v_confirmados;
  END IF;
  IF COALESCE(NEW.cuota, 0) IS DISTINCT FROM COALESCE(OLD.cuota, 0) AND v_sin_monto > 0 THEN
    RAISE EXCEPTION 'No se puede cambiar la cuota: hay % pago(s) confirmado(s) sin monto registrado y cambiarla reescribiría lo recaudado.', v_sin_monto;
  END IF;
  RETURN NEW;
END; $function$;

REVOKE ALL ON FUNCTION public.cuota_no_reescribe_pagos() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS cuota_no_reescribe_pagos ON public.leagues;
CREATE TRIGGER cuota_no_reescribe_pagos
  BEFORE UPDATE OF cuota, moneda ON public.leagues
  FOR EACH ROW EXECUTE FUNCTION public.cuota_no_reescribe_pagos();

-- -----------------------------------------------------------------------------
-- B) La marca de «ya puntuado» va atada al resultado
-- -----------------------------------------------------------------------------
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS puntuado_con text;

COMMENT ON COLUMN public.matches.puntuado_con IS
  'Firma del resultado que puntuó el motor (scoring.firma_resultado). Si no coincide con el resultado actual, el sync reintenta. La escribe solo el backend.';

-- -----------------------------------------------------------------------------
-- C) La puerta del cron también se abre para los reintentos
-- -----------------------------------------------------------------------------
-- Interna: la llama cron_recordatorio_saque (SECURITY DEFINER). No va en el
-- inventario de la 61, mismo caso que hay_partidos_en_ventana.
CREATE OR REPLACE FUNCTION public.hay_avisos_por_reintentar()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.notification_deliveries nd
      JOIN public.matches m ON m.id = nd.match_id
     WHERE nd.tipo = 'kickoff-45m'                           -- TIPO_RECORDATORIO_SAQUE
       AND (nd.status = 'failed'
            OR (nd.status = 'claimed'
                AND nd.claimed_at < now() - interval '5 minutes'))  -- MINUTOS_PARA_RECLAMO_VENCIDO
       AND m.status NOT IN ('finished','cancelled','postponed')
       AND m.kickoff_at - interval '15 minutes' > now()      -- cierre de predicciones
  );
$function$;

REVOKE ALL ON FUNCTION public.hay_avisos_por_reintentar() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cron_recordatorio_saque()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF public.hay_partidos_en_ventana('40 minutes','65 minutes')
     OR public.hay_avisos_por_reintentar() THEN
    PERFORM public.llamar_backend('/api/matches/notify-kickoff');
  END IF;
END; $function$;

-- -----------------------------------------------------------------------------
-- Comprobaciones (estado final: una segunda corrida pasa igual)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF pg_get_functiondef('public.league_pozo(uuid)'::regprocedure) NOT LIKE '%pago_confirmado_monto%' THEN
    RAISE EXCEPTION 'league_pozo sigue calculando lo recaudado con la cuota actual';
  END IF;
  IF pg_get_functiondef('public.confirmar_pago(uuid,uuid,boolean)'::regprocedure) NOT LIKE '%pago_confirmado_monto%' THEN
    RAISE EXCEPTION 'confirmar_pago no guarda el monto';
  END IF;
  -- La 85 cerró la escritura del cliente sobre league_members: las columnas
  -- nuevas no pueden nacer escribibles.
  IF has_column_privilege('authenticated','public.league_members','pago_confirmado_monto','INSERT')
  OR has_column_privilege('authenticated','public.league_members','pago_confirmado_monto','UPDATE') THEN
    RAISE EXCEPTION 'el monto del pago quedó escribible por el cliente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cuota_no_reescribe_pagos'
                 AND tgrelid = 'public.leagues'::regclass) THEN
    RAISE EXCEPTION 'falta el candado de la cuota';
  END IF;
  IF pg_get_functiondef('public.cron_recordatorio_saque()'::regprocedure) NOT LIKE '%hay_avisos_por_reintentar%' THEN
    RAISE EXCEPTION 'la puerta del cron sigue ciega a los reintentos';
  END IF;
  IF has_function_privilege('authenticated','public.hay_avisos_por_reintentar()','EXECUTE')
  OR has_function_privilege('authenticated','public.cuota_no_reescribe_pagos()','EXECUTE') THEN
    RAISE EXCEPTION 'una función interna quedó abierta al cliente';
  END IF;
  RAISE NOTICE '88 OK';
END $$;

COMMIT;
