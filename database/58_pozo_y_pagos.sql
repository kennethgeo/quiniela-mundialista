-- =============================================================================
-- 58_pozo_y_pagos.sql  ·  Cuota, pozo y control de pagos por quiniela
-- =============================================================================
-- La quiniela se juega por plata, pero hoy lo único que hay es prizes_text: un
-- texto libre. Quién pagó y cuánto le toca a cada puesto vive en la cabeza del
-- admin y en el chat de WhatsApp, que es justo donde se generan los roces.
--
-- IMPORTANTE: la app NO mueve plata. Solo lleva la cuenta. El pago sigue siendo
-- entre ustedes (efectivo, SINPE, lo que sea). Esto es un registro compartido,
-- no una pasarela de pagos.
--
-- El flujo es de DOS PASOS a propósito, para que no dependa de la palabra de
-- uno solo:
--   1. el miembro avisa que pagó   (pago_avisado_at)
--   2. el admin lo confirma        (pago_confirmado_at + quién confirmó)
-- Así queda claro si alguien dice haber pagado y todavía no le confirmaron, que
-- es exactamente la discusión que suele aparecer.
--
-- Lo ve TODO EL GRUPO, no solo el admin: es el punto: que nadie tenga que
-- preguntar en qué anda el pozo.
-- Idempotente.
-- =============================================================================

ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS cuota numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS moneda text NOT NULL DEFAULT 'CRC',
  -- [{"puesto":1,"porcentaje":60}, ...]. Se valida que sume <= 100 al guardar.
  ADD COLUMN IF NOT EXISTS premios_reparto jsonb;

ALTER TABLE public.league_members
  ADD COLUMN IF NOT EXISTS pago_avisado_at timestamptz,
  ADD COLUMN IF NOT EXISTS pago_confirmado_at timestamptz,
  ADD COLUMN IF NOT EXISTS pago_confirmado_por uuid REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.leagues.cuota IS 'Cuota por persona. La app NO cobra: solo lleva el registro.';

-- ── Configurar el pozo (solo admin de la quiniela) ───────────────────────────
CREATE OR REPLACE FUNCTION public.set_league_pozo(
  p_league_id uuid, p_cuota numeric, p_moneda text, p_reparto jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_suma numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leagues WHERE id = p_league_id AND admin_id = v_uid) THEN
    RAISE EXCEPTION 'Solo el administrador puede configurar el pozo';
  END IF;
  IF COALESCE(p_cuota, 0) < 0 THEN RAISE EXCEPTION 'La cuota no puede ser negativa'; END IF;

  -- Un reparto que sume más de 100% repartiría plata que no existe.
  IF p_reparto IS NOT NULL AND jsonb_typeof(p_reparto) = 'array' THEN
    SELECT COALESCE(SUM((e->>'porcentaje')::numeric), 0) INTO v_suma
    FROM jsonb_array_elements(p_reparto) e;
    IF v_suma > 100 THEN
      RAISE EXCEPTION 'El reparto suma % por ciento y no puede pasar de 100', v_suma;
    END IF;
  END IF;

  UPDATE public.leagues SET
    cuota = COALESCE(p_cuota, 0),
    moneda = COALESCE(NULLIF(btrim(p_moneda), ''), 'CRC'),
    premios_reparto = p_reparto
  WHERE id = p_league_id;
END; $$;

-- ── El miembro avisa que pagó (o se retracta) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.avisar_pago(p_league_id uuid, p_avisar boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.league_members
                 WHERE league_id = p_league_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'No sos miembro de esta quiniela';
  END IF;
  UPDATE public.league_members
  SET pago_avisado_at = CASE WHEN p_avisar THEN now() ELSE NULL END
  WHERE league_id = p_league_id AND user_id = v_uid;
END; $$;

-- ── El admin confirma (o revierte) el pago de alguien ────────────────────────
CREATE OR REPLACE FUNCTION public.confirmar_pago(
  p_league_id uuid, p_user_id uuid, p_confirmado boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leagues WHERE id = p_league_id AND admin_id = v_uid) THEN
    RAISE EXCEPTION 'Solo el administrador puede confirmar pagos';
  END IF;
  UPDATE public.league_members SET
    pago_confirmado_at  = CASE WHEN p_confirmado THEN now() ELSE NULL END,
    pago_confirmado_por = CASE WHEN p_confirmado THEN v_uid ELSE NULL END
  WHERE league_id = p_league_id AND user_id = p_user_id;
END; $$;

-- ── Estado del pozo, visible para todo el grupo ──────────────────────────────
CREATE OR REPLACE FUNCTION public.league_pozo(p_league_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_l record;
  v_miembros int;
  v_pagados int;
  v_gente jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.league_members
                 WHERE league_id = p_league_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'No sos miembro de esta quiniela';
  END IF;

  SELECT id, admin_id, cuota, moneda, premios_reparto INTO v_l
  FROM public.leagues WHERE id = p_league_id;

  SELECT count(*), count(*) FILTER (WHERE lm.pago_confirmado_at IS NOT NULL)
    INTO v_miembros, v_pagados
  FROM public.league_members lm WHERE lm.league_id = p_league_id;

  SELECT jsonb_agg(x ORDER BY x->>'display_name')
    INTO v_gente
  FROM (
    SELECT jsonb_build_object(
             'user_id', u.id,
             'display_name', u.display_name,
             'avatar_url', u.avatar_url,
             'es_admin', (u.id = v_l.admin_id),
             'soy_yo', (u.id = v_uid),
             'aviso', (lm.pago_avisado_at IS NOT NULL),
             'confirmado', (lm.pago_confirmado_at IS NOT NULL)
           ) AS x
    FROM public.league_members lm
    JOIN public.users u ON u.id = lm.user_id
    WHERE lm.league_id = p_league_id
  ) s;

  RETURN jsonb_build_object(
    'cuota', v_l.cuota,
    'moneda', v_l.moneda,
    'reparto', v_l.premios_reparto,
    'soy_admin', (v_l.admin_id = v_uid),
    'miembros', v_miembros,
    'pagados', v_pagados,
    -- Pozo si pagan todos vs lo realmente recaudado: la diferencia entre los
    -- dos es lo que falta cobrar, y es el número que interesa.
    'pozo_total', COALESCE(v_l.cuota, 0) * v_miembros,
    'recaudado', COALESCE(v_l.cuota, 0) * v_pagados,
    'gente', COALESCE(v_gente, '[]'::jsonb)
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.set_league_pozo(uuid, numeric, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.avisar_pago(uuid, boolean)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_pago(uuid, uuid, boolean)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.league_pozo(uuid)                           TO authenticated;

NOTIFY pgrst, 'reload schema';
