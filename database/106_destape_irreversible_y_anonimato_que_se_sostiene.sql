-- =============================================================================
-- 106_destape_irreversible_y_anonimato_que_se_sostiene.sql
-- 28 sep 2026. Auditoría 19 (Claude; Astra sin uso). No modifica ni borra
-- ninguna fila existente: una columna nueva que nace en NULL, políticas,
-- funciones y triggers. Idempotente.
-- =============================================================================
--
-- 1. [MEDIA] ATRASAR EL SAQUE DESPUÉS DEL DESTAPE REABRÍA LA EDICIÓN.
--    La política de lectura destapa las predicciones ajenas a T-15 y la de
--    escritura deja editar mientras `kickoff_at - 15 min > now()`. El sync
--    reescribe `kickoff_at` de todo partido sin candado: si ESPN (o el panel)
--    atrasa un partido después de T-15, todos ya vieron lo del resto, se
--    vuelven a ocultar y se puede EDITAR la propia. Ensayo revertido sobre el
--    297: «visibles con saque en 10 min=9 | tras mover el saque=0 | edición
--    propia=1». Ahora `matches.destapado_at` guarda el primer destape (lo pone
--    un trigger BEFORE UPDATE si el saque VIEJO ya estaba a menos de 15 min):
--    la rama normal de escritura exige que no esté destapado, y la lectura
--    sigue destapada. Reabrir después del destape queda solo por
--    `predictions_force_open`, que es explícito y queda auditado (105).
--    Nace en NULL para todos: un partido que ya pasó T-15 sigue cerrado por
--    la hora, igual que antes.
--    Y el cambio de saque que hace el SYNC ahora también queda en
--    `match_audit` (con `changed_by` NULL): antes solo se anotaba el del admin.
--
-- 2. [MEDIA] UNA CUENTA ANONIMIZADA PODÍA RECUPERAR NOMBRE, FOTO Y AVISOS.
--    La sesión abierta (≤ 1 h) podía reescribir `display_name`/`avatar_url` y
--    volver a registrar un dispositivo de push, y eso quedaba para siempre
--    (ensayo revertido: «nombre real vuelto | avatar | push=1»). Ahora:
--      · `congelar_campos_sensibles_users` congela nombre y foto de una cuenta
--        anonimizada cuando escribe el cliente;
--      · la política de alta de push exige que la cuenta no esté anonimizada;
--      · `anonimizar_usuario` corta sus sesiones (`auth.sessions` y
--        `auth.refresh_tokens`) y borra de Auth el correo, nombre y foto que
--        quedaban en los metadatos y en las identidades (Google).
--
-- 3. [BAJA] LA ALERTA DE PUNTAJES SALÍA ANTES DE LAS 6 H: la rama de
--    predicciones usaba la hora en que se hizo la predicción (días antes del
--    saque). Ahora cuenta desde que el partido pudo haberse puntuado: la hora
--    de la predicción o el saque + 2 h, lo que sea más tarde.
--    Y `soltar_alertas_de_puntaje` deja reintentar si el aviso no salió.
--
-- 4. [BAJA] Un partido forzado que pasa a en vivo escondía las predicciones
--    ajenas todo el partido: la lectura ahora usa la misma condición que la
--    escritura (`status = 'pending'`).
--
-- 5. [BAJA] Los co-admins (que también juegan) leían los créditos de ×2 de
--    los demás, con qué predicción los gastaron. La app no lee esa tabla
--    directo (usa `my_powerup_credits`): la política queda en los propios.
--
-- 6. [BAJA] El tope de 10 dispositivos: dos altas simultáneas podían dejar 11
--    (sin candado), y el mensaje mandaba a borrar desde el perfil, que solo
--    borra el dispositivo actual. Ahora toma un candado por persona y, al
--    llegar al tope, borra el registro más viejo de esa persona en vez de
--    rechazar (un endpoint de hace meses es casi seguro un navegador muerto).
-- =============================================================================

BEGIN;

-- 1 ---------------------------------------------------------------------------
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS destapado_at timestamptz;
COMMENT ON COLUMN public.matches.destapado_at IS
  'Primer momento en que las predicciones ajenas quedaron a la vista (T-15). Una vez puesto, atrasar el saque no reabre la edición (migración 106).';

CREATE OR REPLACE FUNCTION public.marcar_destape()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.destapado_at IS NULL AND OLD.kickoff_at IS NOT NULL
     AND OLD.kickoff_at - interval '15 minutes' <= now() THEN
    NEW.destapado_at := LEAST(now(), OLD.kickoff_at - interval '15 minutes');
  END IF;
  -- Nadie lo borra desde el cliente (no tiene privilegio de columna), y el
  -- trigger no lo deja volver a NULL.
  IF OLD.destapado_at IS NOT NULL THEN
    NEW.destapado_at := OLD.destapado_at;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.marcar_destape() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS marcar_destape ON public.matches;
CREATE TRIGGER marcar_destape BEFORE UPDATE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.marcar_destape();

ALTER POLICY predictions_insert_own_unlocked ON public.predictions
  WITH CHECK ((auth.uid() = user_id) AND is_league_member(league_id) AND (EXISTS ( SELECT 1
     FROM (matches m
       JOIN leagues l ON ((l.tournament_id = m.tournament_id)))
    WHERE ((m.id = predictions.match_id) AND (l.id = predictions.league_id)))) AND ( SELECT ((((m.kickoff_at - '00:15:00'::interval) > now()) AND m.destapado_at IS NULL AND (m.status <> ALL (ARRAY['finished'::text, 'cancelled'::text, 'postponed'::text]))) OR (COALESCE(m.predictions_force_open, false) AND m.status = 'pending'))
     FROM matches m
    WHERE (m.id = predictions.match_id)));

ALTER POLICY predictions_update_own_unlocked ON public.predictions
  USING ((auth.uid() = user_id) AND ( SELECT ((((m.kickoff_at - '00:15:00'::interval) > now()) AND m.destapado_at IS NULL AND (m.status <> ALL (ARRAY['finished'::text, 'cancelled'::text, 'postponed'::text]))) OR (COALESCE(m.predictions_force_open, false) AND m.status = 'pending'))
     FROM matches m
    WHERE (m.id = predictions.match_id)))
  WITH CHECK ((auth.uid() = user_id) AND is_league_member(league_id) AND (EXISTS ( SELECT 1
     FROM (matches m
       JOIN leagues l ON ((l.tournament_id = m.tournament_id)))
    WHERE ((m.id = predictions.match_id) AND (l.id = predictions.league_id)))) AND ( SELECT ((((m.kickoff_at - '00:15:00'::interval) > now()) AND m.destapado_at IS NULL AND (m.status <> ALL (ARRAY['finished'::text, 'cancelled'::text, 'postponed'::text]))) OR (COALESCE(m.predictions_force_open, false) AND m.status = 'pending'))
     FROM matches m
    WHERE (m.id = predictions.match_id)));

-- 1 (lectura) + 4 ---------------------------------------------------------------
ALTER POLICY predictions_select_propia_o_de_mi_quiniela ON public.predictions
  USING ((auth.uid() = user_id) OR (puede_ver_quiniela(league_id) AND ( SELECT ((((m.kickoff_at - '00:15:00'::interval) <= now()) OR m.destapado_at IS NOT NULL) AND (NOT (COALESCE(m.predictions_force_open, false) AND m.status = 'pending')))
     FROM matches m
    WHERE (m.id = predictions.match_id))));

-- 1 (rastro del sync) ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_correccion_partido()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_marcador_antes text;
  v_marcador_despues text;
BEGIN
  -- 106: el cambio de saque que hace el SYNC también queda (sin actor). Es lo
  -- que decide hasta cuándo se puede predecir.
  IF v_actor IS NULL THEN
    IF NEW.kickoff_at IS DISTINCT FROM OLD.kickoff_at THEN
      INSERT INTO public.match_audit (match_id, changed_by, campo, valor_antes, valor_despues)
      VALUES (NEW.id, NULL, 'saque', OLD.kickoff_at::text, NEW.kickoff_at::text);
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.home_goals_actual IS DISTINCT FROM OLD.home_goals_actual
     OR NEW.away_goals_actual IS DISTINCT FROM OLD.away_goals_actual THEN
    v_marcador_antes   := COALESCE(OLD.home_goals_actual::text, '-') || '-' || COALESCE(OLD.away_goals_actual::text, '-');
    v_marcador_despues := COALESCE(NEW.home_goals_actual::text, '-') || '-' || COALESCE(NEW.away_goals_actual::text, '-');
    INSERT INTO public.match_audit (match_id, changed_by, campo, valor_antes, valor_despues)
    VALUES (NEW.id, v_actor, 'marcador', v_marcador_antes, v_marcador_despues);
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.match_audit (match_id, changed_by, campo, valor_antes, valor_despues)
    VALUES (NEW.id, v_actor, 'estado', OLD.status, NEW.status);
  END IF;

  IF NEW.goes_to_penalties IS DISTINCT FROM OLD.goes_to_penalties
     OR NEW.penalties_winner_real IS DISTINCT FROM OLD.penalties_winner_real THEN
    INSERT INTO public.match_audit (match_id, changed_by, campo, valor_antes, valor_despues)
    VALUES (NEW.id, v_actor, 'penales',
            CASE WHEN OLD.goes_to_penalties THEN COALESCE(OLD.penalties_winner_real, 'si') ELSE 'no' END,
            CASE WHEN NEW.goes_to_penalties THEN COALESCE(NEW.penalties_winner_real, 'si') ELSE 'no' END);
  END IF;

  IF NEW.score_locked IS DISTINCT FROM OLD.score_locked THEN
    INSERT INTO public.match_audit (match_id, changed_by, campo, valor_antes, valor_despues)
    VALUES (NEW.id, v_actor, 'candado',
            CASE WHEN OLD.score_locked THEN 'fijado' ELSE 'libre' END,
            CASE WHEN NEW.score_locked THEN 'fijado' ELSE 'libre' END);
  END IF;

  IF NEW.predictions_force_open IS DISTINCT FROM OLD.predictions_force_open THEN
    INSERT INTO public.match_audit (match_id, changed_by, campo, valor_antes, valor_despues)
    VALUES (NEW.id, v_actor, 'predicciones_forzadas',
            CASE WHEN COALESCE(OLD.predictions_force_open, false) THEN 'abiertas' ELSE 'normal' END,
            CASE WHEN COALESCE(NEW.predictions_force_open, false) THEN 'abiertas' ELSE 'normal' END);
  END IF;

  IF NEW.kickoff_at IS DISTINCT FROM OLD.kickoff_at THEN
    INSERT INTO public.match_audit (match_id, changed_by, campo, valor_antes, valor_despues)
    VALUES (NEW.id, v_actor, 'saque', OLD.kickoff_at::text, NEW.kickoff_at::text);
  END IF;

  RETURN NEW;
END; $function$;

-- 2 ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.congelar_campos_sensibles_users()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.is_admin          := OLD.is_admin;
    NEW.total_points      := OLD.total_points;
    NEW.points_adjustment := OLD.points_adjustment;
    NEW.email             := OLD.email;
    NEW.id                := OLD.id;
    NEW.created_at        := OLD.created_at;
    -- 106: una cuenta anonimizada no recupera su identidad desde una sesión
    -- que quedó abierta.
    IF OLD.anonimizado_at IS NOT NULL THEN
      NEW.display_name   := OLD.display_name;
      NEW.avatar_url     := OLD.avatar_url;
      NEW.anonimizado_at := OLD.anonimizado_at;
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

-- La política no puede leer `users.anonimizado_at` directo: el cliente no
-- tiene SELECT de esa columna y la lectura fallaría para TODOS (lo cazó el
-- ensayo). Va en un ayudante SECURITY DEFINER, como `is_league_member`.
CREATE OR REPLACE FUNCTION public.cuenta_anonimizada()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT anonimizado_at IS NOT NULL FROM public.users WHERE id = auth.uid()), false);
$$;
REVOKE ALL ON FUNCTION public.cuenta_anonimizada() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cuenta_anonimizada() TO authenticated;

ALTER POLICY push_subs_insert_own ON public.push_subscriptions
  WITH CHECK ((auth.uid() = user_id) AND NOT public.cuenta_anonimizada());

CREATE OR REPLACE FUNCTION public.anonimizar_usuario(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_u      public.users%ROWTYPE;
  v_nombre text;
  v_push   integer;
  v_sesiones integer := 0;
BEGIN
  SELECT * INTO v_u FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_u.is_admin THEN
    RAISE EXCEPTION 'No se anonimiza a un admin global' USING ERRCODE = '42501';
  END IF;

  v_nombre := 'Ex-miembro ' || upper(left(replace(p_user_id::text, '-', ''), 4));

  UPDATE public.users
     SET display_name   = v_nombre,
         avatar_url     = NULL,
         email          = NULL,
         anonimizado_at = COALESCE(anonimizado_at, now())
   WHERE id = p_user_id;

  DELETE FROM public.push_subscriptions WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_push = ROW_COUNT;

  -- 106: la sesión abierta no sobrevive, y en Auth no quedan correo, nombre
  -- ni foto en los metadatos ni en las identidades (Google).
  DELETE FROM auth.refresh_tokens WHERE user_id::uuid = p_user_id;
  DELETE FROM auth.sessions WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_sesiones = ROW_COUNT;
  UPDATE auth.users
     SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
           - 'email' - 'full_name' - 'name' - 'avatar_url' - 'picture' - 'display_name'
   WHERE id = p_user_id;
  UPDATE auth.identities
     SET identity_data = COALESCE(identity_data, '{}'::jsonb)
           - 'email' - 'full_name' - 'name' - 'avatar_url' - 'picture'
   WHERE user_id = p_user_id;

  RETURN jsonb_build_object('status', 'ok', 'nombre', v_nombre, 'push_borradas', v_push,
                            'sesiones_cortadas', v_sesiones);
END;
$$;
REVOKE ALL ON FUNCTION public.anonimizar_usuario(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonimizar_usuario(uuid) TO service_role;

-- 3 ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reclamar_alertas_de_puntaje(p_horas integer DEFAULT 6)
RETURNS TABLE (match_id integer, partido text, pendiente_desde timestamptz, avisos integer)
LANGUAGE sql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH pendientes AS (
    SELECT m.id,
           m.home_team || ' vs ' || m.away_team AS partido,
           LEAST(
             CASE WHEN (CASE WHEN m.status = 'finished' THEN m.puntuado_con IS NULL
                             ELSE m.puntuado_con IS DISTINCT FROM 'anulado' END)
                  THEN COALESCE(m.puntaje_pendiente_desde, m.kickoff_at) END,
             -- 106: una predicción no espera puntaje antes de que el partido
             -- se pueda puntuar (saque + 2 h).
             GREATEST(
               (SELECT min(p.modificada_at) FROM public.predictions p
                 WHERE p.match_id = m.id AND p.puntaje_pendiente),
               m.kickoff_at + interval '2 hours')
           ) AS desde
    FROM public.matches m
    WHERE m.id IN (SELECT public.partidos_pendientes_de_puntaje())
  ),
  vencidos AS (
    SELECT * FROM pendientes
    WHERE desde IS NOT NULL AND desde < now() - make_interval(hours => GREATEST(p_horas, 1))
  ),
  anotados AS (
    INSERT INTO public.alertas_de_puntaje AS a (match_id)
    SELECT id FROM vencidos
    ON CONFLICT ON CONSTRAINT alertas_de_puntaje_pkey DO UPDATE
      SET ultimo_aviso_at = now(), avisos = a.avisos + 1
      WHERE a.ultimo_aviso_at < now() - interval '20 hours'
    RETURNING a.match_id, a.avisos
  )
  SELECT v.id, v.partido, v.desde, an.avisos
  FROM vencidos v JOIN anotados an ON an.match_id = v.id
  ORDER BY v.desde;
$$;
REVOKE ALL ON FUNCTION public.reclamar_alertas_de_puntaje(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reclamar_alertas_de_puntaje(integer) TO service_role;

-- Si el push de la alerta NO salió, el reclamo se suelta para reintentar en
-- la pasada siguiente (antes quedaba callado 20 h).
CREATE OR REPLACE FUNCTION public.soltar_alertas_de_puntaje(p_ids integer[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE n integer;
BEGIN
  UPDATE public.alertas_de_puntaje
     SET ultimo_aviso_at = ultimo_aviso_at - interval '21 hours',
         avisos = GREATEST(avisos - 1, 0)
   WHERE match_id = ANY (p_ids)
     AND ultimo_aviso_at > now() - interval '10 minutes';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.soltar_alertas_de_puntaje(integer[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.soltar_alertas_de_puntaje(integer[]) TO service_role;

-- 5 ---------------------------------------------------------------------------
ALTER POLICY powerup_credits_select_own_or_admin ON public.powerup_credits
  USING (user_id = auth.uid());

-- 6 ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tope_de_dispositivos_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('push:' || NEW.user_id::text, 0));
  -- Al tope, el registro más viejo de esa persona se va: casi seguro es un
  -- navegador que ya no existe, y la app solo sabe borrar el actual.
  DELETE FROM public.push_subscriptions
   WHERE id IN (SELECT id FROM public.push_subscriptions
                 WHERE user_id = NEW.user_id
                 ORDER BY created_at ASC
                 OFFSET 0 LIMIT GREATEST((SELECT count(*) FROM public.push_subscriptions WHERE user_id = NEW.user_id) - 9, 0));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tope_de_dispositivos_push() FROM PUBLIC, anon, authenticated;

-- Comprobaciones ---------------------------------------------------------------
DO $comprobar$
BEGIN
  IF has_column_privilege('authenticated', 'public.matches', 'destapado_at', 'UPDATE') THEN
    RAISE EXCEPTION '106: el cliente puede escribir destapado_at'; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'predictions'
             AND policyname IN ('predictions_insert_own_unlocked', 'predictions_update_own_unlocked')
             AND COALESCE(with_check, '') NOT ILIKE '%destapado_at IS NULL%') THEN
    RAISE EXCEPTION '106: la escritura de predicciones no mira el destape'; END IF;
  IF has_function_privilege('authenticated', 'public.soltar_alertas_de_puntaje(integer[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.anonimizar_usuario(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '106: una función de backend quedó para el cliente'; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'powerup_credits'
             AND COALESCE(qual, '') ILIKE '%es_admin_liga%') THEN
    RAISE EXCEPTION '106: los créditos siguen visibles para los co-admins'; END IF;
END
$comprobar$;

COMMIT;
