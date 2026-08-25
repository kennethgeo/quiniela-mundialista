-- =============================================================================
-- 59_admins_por_quiniela.sql  ·  Varios administradores por quiniela
-- =============================================================================
-- Hoy leagues.admin_id es UN solo uuid: si esa persona no está, nadie corrige
-- nada, nadie confirma un pago y nadie cierra una votación. Con plata de por
-- medio eso es un punto único de falla.
--
-- MODELO: el creador (leagues.admin_id) sigue siendo el DUEÑO y no se puede
-- quitar. Además puede nombrar co-administradores entre los miembros
-- (league_members.es_admin). La distinción importa:
--
--   Solo el CREADOR          | Cualquier ADMIN
--   -------------------------|---------------------------------------------
--   nombrar/quitar admins    | editar reglas y puntaje
--   borrar la quiniela       | premios, cuota y reparto del pozo
--                            | confirmar pagos
--                            | proponer y cancelar votaciones
--                            | expulsar miembros (excepto al creador)
--
-- Que nombrar admins sea solo del creador evita el escenario obvio: un
-- co-admin promoviéndose gente hasta quedarse con el control de la quiniela.
--
-- LO QUE ESTO NO HABILITA: editar resultados de partidos. Los partidos son
-- compartidos por TODAS las quinielas del mismo torneo, así que un admin de
-- quiniela moviendo un marcador cambiaría los puntos de gente que ni conoce.
-- Eso sigue siendo del admin global de la app.
-- Idempotente.
-- =============================================================================

ALTER TABLE public.league_members
  ADD COLUMN IF NOT EXISTS es_admin boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.league_members.es_admin IS
  'Co-administrador nombrado por el creador. El creador (leagues.admin_id) es admin siempre, sin necesidad de esta marca.';

-- Fuente única de verdad para "¿puede administrar esta quiniela?".
CREATE OR REPLACE FUNCTION public.es_admin_liga(p_league_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.leagues WHERE id = p_league_id AND admin_id = p_user_id)
      OR EXISTS (SELECT 1 FROM public.league_members
                 WHERE league_id = p_league_id AND user_id = p_user_id AND es_admin);
$$;

-- ── Nombrar / quitar co-administradores (SOLO el creador) ────────────────────
CREATE OR REPLACE FUNCTION public.set_league_admin(
  p_league_id uuid, p_user_id uuid, p_es_admin boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_creador uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT admin_id INTO v_creador FROM public.leagues WHERE id = p_league_id;
  IF v_creador IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Solo quien creó la quiniela puede nombrar administradores';
  END IF;
  IF p_user_id = v_creador THEN
    RAISE EXCEPTION 'El creador ya es administrador y no se puede quitar';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.league_members
                 WHERE league_id = p_league_id AND user_id = p_user_id) THEN
    RAISE EXCEPTION 'Esa persona no es miembro de la quiniela';
  END IF;
  UPDATE public.league_members SET es_admin = COALESCE(p_es_admin, false)
  WHERE league_id = p_league_id AND user_id = p_user_id;
END; $$;

-- ── Expulsar a un miembro (cualquier admin) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.expulsar_miembro(p_league_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_creador uuid;
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

  -- Se borran también sus predicciones EN ESTA quiniela: si se quedaran,
  -- seguiría figurando en los puntajes de una quiniela de la que ya no es parte.
  DELETE FROM public.predictions WHERE league_id = p_league_id AND user_id = p_user_id;
  DELETE FROM public.tournament_predictions WHERE league_id = p_league_id AND user_id = p_user_id;
  DELETE FROM public.league_members WHERE league_id = p_league_id AND user_id = p_user_id;
END; $$;

-- ── Miembros con su rol, para el panel ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.league_miembros(p_league_id uuid)
RETURNS TABLE (
  user_id uuid, display_name text, avatar_url text,
  es_creador boolean, es_admin boolean, soy_yo boolean, joined_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_creador uuid;
BEGIN
  -- Ojo: 'user_id' y 'es_admin' también son parámetros OUT de esta función, así
  -- que toda referencia a columnas va calificada o plpgsql no sabe cuál es cuál.
  IF NOT EXISTS (SELECT 1 FROM public.league_members lm
                 WHERE lm.league_id = p_league_id AND lm.user_id = v_uid) THEN
    RAISE EXCEPTION 'No sos miembro de esta quiniela';
  END IF;
  SELECT l.admin_id INTO v_creador FROM public.leagues l WHERE l.id = p_league_id;
  RETURN QUERY
    SELECT u.id, u.display_name, u.avatar_url,
           (u.id = v_creador),
           (u.id = v_creador OR lm.es_admin),
           (u.id = v_uid),
           lm.joined_at
    FROM public.league_members lm
    JOIN public.users u ON u.id = lm.user_id
    WHERE lm.league_id = p_league_id
    ORDER BY (u.id = v_creador) DESC, lm.es_admin DESC, u.display_name;
END; $$;

-- =============================================================================
-- Las funciones que ya existían pasan a aceptar co-admins. Cuerpos idénticos a
-- los vigentes: lo único que cambia es el chequeo de permiso.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_group_rules(p_league_id uuid, p_rules text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT public.es_admin_liga(p_league_id, v_uid) THEN
    RAISE EXCEPTION 'Solo un administrador puede editar las reglas';
  END IF;
  IF public.group_tournament_started(p_league_id) THEN
    RAISE EXCEPTION 'El torneo ya inició: las reglas quedan bloqueadas (los cambios se someten a votación).';
  END IF;
  UPDATE public.leagues SET rules = btrim(COALESCE(p_rules,'')) WHERE id = p_league_id;
  UPDATE public.league_members SET rules_accepted_at = NULL
  WHERE league_id = p_league_id AND user_id <> v_uid;
END; $$;

CREATE OR REPLACE FUNCTION public.set_group_scoring(
  p_league_id uuid, p_points_exact int, p_points_correct int,
  p_champion_points int, p_scorer_points int, p_powerup_limit int,
  p_assist_points int DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT public.es_admin_liga(p_league_id, v_uid) THEN
    RAISE EXCEPTION 'Solo un administrador puede editar las reglas';
  END IF;
  IF public.group_tournament_started(p_league_id) THEN
    RAISE EXCEPTION 'El torneo ya inició: el puntaje queda bloqueado (los cambios se someten a votación).';
  END IF;
  UPDATE public.leagues SET
    points_exact    = GREATEST(0, COALESCE(p_points_exact, points_exact)),
    points_correct  = GREATEST(0, COALESCE(p_points_correct, points_correct)),
    champion_points = GREATEST(0, COALESCE(p_champion_points, champion_points)),
    scorer_points   = GREATEST(0, COALESCE(p_scorer_points, scorer_points)),
    assist_points   = GREATEST(0, COALESCE(p_assist_points, assist_points)),
    powerup_limit   = GREATEST(0, COALESCE(p_powerup_limit, powerup_limit))
  WHERE id = p_league_id;
END; $$;

CREATE OR REPLACE FUNCTION public.set_group_extras(
  p_league_id uuid, p_prizes_text text, p_whatsapp_link text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT public.es_admin_liga(p_league_id, v_uid) THEN
    RAISE EXCEPTION 'Solo un administrador puede editar esto';
  END IF;
  UPDATE public.leagues SET
    prizes_text   = NULLIF(btrim(COALESCE(p_prizes_text, '')), ''),
    whatsapp_link = NULLIF(btrim(COALESCE(p_whatsapp_link, '')), '')
  WHERE id = p_league_id;
END; $$;

CREATE OR REPLACE FUNCTION public.set_league_pozo(
  p_league_id uuid, p_cuota numeric, p_moneda text, p_reparto jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_suma numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT public.es_admin_liga(p_league_id, v_uid) THEN
    RAISE EXCEPTION 'Solo un administrador puede configurar el pozo';
  END IF;
  IF COALESCE(p_cuota, 0) < 0 THEN RAISE EXCEPTION 'La cuota no puede ser negativa'; END IF;

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

CREATE OR REPLACE FUNCTION public.confirmar_pago(
  p_league_id uuid, p_user_id uuid, p_confirmado boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT public.es_admin_liga(p_league_id, v_uid) THEN
    RAISE EXCEPTION 'Solo un administrador puede confirmar pagos';
  END IF;
  -- Nadie confirma su propio pago, ni siquiera un admin: el registro pierde
  -- sentido si uno puede darse por pagado a sí mismo.
  IF p_user_id = v_uid THEN
    RAISE EXCEPTION 'No podés confirmar tu propio pago';
  END IF;
  UPDATE public.league_members SET
    pago_confirmado_at  = CASE WHEN p_confirmado THEN now() ELSE NULL END,
    pago_confirmado_por = CASE WHEN p_confirmado THEN v_uid ELSE NULL END
  WHERE league_id = p_league_id AND user_id = p_user_id;
END; $$;

CREATE OR REPLACE FUNCTION public.propose_rule_change(
  p_league_id uuid, p_kind text, p_payload jsonb, p_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  INSERT INTO public.rule_votes (proposal_id, user_id, vote) VALUES (v_id, v_uid, true);
  PERFORM public._tally_rule_proposal(v_id);
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.cancel_rule_proposal(p_proposal_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_league uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT league_id INTO v_league FROM public.rule_proposals
  WHERE id = p_proposal_id AND status = 'open';
  IF v_league IS NULL OR NOT public.es_admin_liga(v_league, v_uid) THEN
    RAISE EXCEPTION 'Solo un administrador puede cancelar la propuesta abierta';
  END IF;
  UPDATE public.rule_proposals SET status = 'cancelled', closed_at = now() WHERE id = p_proposal_id;
END; $$;

-- league_pozo: 'soy_admin' pasa a contemplar co-admins. Sin esto, un co-admin
-- podría llamar a confirmar_pago pero el panel no le mostraría el botón.
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
             'es_admin', (u.id = v_l.admin_id OR lm.es_admin),
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
    'soy_admin', public.es_admin_liga(p_league_id, v_uid),
    'miembros', v_miembros,
    'pagados', v_pagados,
    'pozo_total', COALESCE(v_l.cuota, 0) * v_miembros,
    'recaudado', COALESCE(v_l.cuota, 0) * v_pagados,
    'gente', COALESCE(v_gente, '[]'::jsonb)
  );
END; $$;

-- Los créditos de arrastre del comodín también los mira un co-admin.
DROP POLICY IF EXISTS "powerup_credits_select_own_or_admin" ON public.powerup_credits;
CREATE POLICY "powerup_credits_select_own_or_admin" ON public.powerup_credits
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR public.es_admin_liga(league_id, auth.uid())
  );

-- my_groups: is_admin pasa a contemplar co-admins y se suma soy_creador (para
-- saber quién puede nombrar admins). Sumar una columna cambia el tipo de
-- retorno, así que hay que soltarla antes: CREATE OR REPLACE no alcanza.
DROP FUNCTION IF EXISTS public.my_groups();
CREATE OR REPLACE FUNCTION public.my_groups()
RETURNS TABLE (
  id uuid, name text, description text, invitation_code text, admin_id uuid,
  tournament_id integer, tournament_name text, tournament_kind text, tournament_status text,
  members integer, my_points numeric, my_rank integer, rules text, is_admin boolean,
  rules_accepted boolean, points_exact integer, points_correct integer, champion_points integer,
  scorer_points integer, powerup_limit integer, assist_points integer, open_proposal boolean,
  my_pending_vote boolean, prizes_text text, whatsapp_link text, soy_creador boolean
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT l.id, l.name, l.description, l.invitation_code, l.admin_id, l.tournament_id,
         t.name, t.kind, t.status,
         (SELECT count(*)::int FROM public.league_members lm WHERE lm.league_id = l.id) AS members,
         public.league_points(l.id, auth.uid()) AS my_points,
         public.league_rank(l.id, auth.uid()) AS my_rank,
         l.rules, public.es_admin_liga(l.id, auth.uid()) AS is_admin,
         (m.rules_accepted_at IS NOT NULL) AS rules_accepted,
         l.points_exact, l.points_correct, l.champion_points, l.scorer_points,
         l.powerup_limit, l.assist_points,
         EXISTS (SELECT 1 FROM public.rule_proposals rp
                 WHERE rp.league_id = l.id AND rp.status = 'open'
                   AND (rp.expires_at IS NULL OR rp.expires_at > now())) AS open_proposal,
         EXISTS (SELECT 1 FROM public.rule_proposals rp
                 WHERE rp.league_id = l.id AND rp.status = 'open'
                   AND (rp.expires_at IS NULL OR rp.expires_at > now())
                   AND NOT EXISTS (SELECT 1 FROM public.rule_votes rv
                                   WHERE rv.proposal_id = rp.id AND rv.user_id = auth.uid())) AS my_pending_vote,
         l.prizes_text, l.whatsapp_link,
         (l.admin_id = auth.uid()) AS soy_creador
  FROM public.leagues l
  JOIN public.league_members m ON m.league_id = l.id AND m.user_id = auth.uid()
  JOIN public.tournaments t ON t.id = l.tournament_id
  ORDER BY (t.status = 'active') DESC, l.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.es_admin_liga(uuid, uuid)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_league_admin(uuid, uuid, boolean)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.expulsar_miembro(uuid, uuid)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.league_miembros(uuid)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_groups()                               TO authenticated;
GRANT EXECUTE ON FUNCTION public.league_pozo(uuid)                         TO authenticated;

NOTIFY pgrst, 'reload schema';
