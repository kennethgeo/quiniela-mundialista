-- =============================================================================
-- 36_group_rules.sql  ·  Reglas por quiniela + aceptación obligatoria
-- =============================================================================
-- · leagues.rules              — texto de reglas del grupo (editable por admin)
-- · league_members.rules_accepted_at — cuándo aceptó cada miembro (NULL = pendiente)
-- · create_group(p_name,p_tid,p_rules) — crea con reglas; el creador acepta auto
-- · join_group_by_code         — el que se une queda con aceptación pendiente (NULL)
-- · accept_group_rules(league) — el miembro acepta las reglas
-- · set_group_rules(league,txt)— solo admin edita; resetea aceptación de los demás
-- · my_groups                  — ahora devuelve rules, is_admin, rules_accepted
-- Idempotente.
-- =============================================================================

-- Reglas por defecto (incluye la cláusula de respeto y expulsión)
ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS rules TEXT DEFAULT
'Reglas de la quiniela

1. Predicciones: cada quiniela juega el torneo elegido por su administrador. Las predicciones se cierran al iniciar cada partido.

2. Puntaje: marcador exacto = 3 pts, resultado correcto = 1 pt. El comodín ×2 duplica los puntos, según los límites de cada jornada/fase.

3. Respeto ante todo: mantené el respeto hacia todas las personas del grupo. Si se le falta el respeto a cualquier integrante, el administrador procederá a eliminar a la persona de la quiniela, sin derecho a reclamo alguno.

4. Juego limpio: prohibido hacer trampa o usar cuentas falsas.

5. Diversión: al final es un juego entre amigos. ¡Pura vida! 🇨🇷';

-- Aceptación por miembro
ALTER TABLE public.league_members
  ADD COLUMN IF NOT EXISTS rules_accepted_at TIMESTAMPTZ;

-- Los administradores de grupos existentes quedan como "ya aceptaron" (son quienes las definen)
UPDATE public.league_members lm
SET rules_accepted_at = now()
FROM public.leagues l
WHERE l.id = lm.league_id AND l.admin_id = lm.user_id AND lm.rules_accepted_at IS NULL;

-- ---------------------------------------------------------------------------
-- create_group: ahora acepta reglas opcionales; el creador acepta automáticamente
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_group(text, int);
CREATE OR REPLACE FUNCTION public.create_group(p_name text, p_tournament_id int, p_rules text DEFAULT NULL)
RETURNS public.leagues
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code text; v_row public.leagues; v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF btrim(COALESCE(p_name,'')) = '' THEN RAISE EXCEPTION 'El nombre es obligatorio'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tournaments WHERE id = p_tournament_id) THEN
    RAISE EXCEPTION 'Torneo inválido';
  END IF;
  LOOP
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.leagues WHERE invitation_code = v_code);
  END LOOP;

  IF NULLIF(btrim(COALESCE(p_rules,'')), '') IS NOT NULL THEN
    INSERT INTO public.leagues (name, invitation_code, admin_id, tournament_id, rules)
    VALUES (btrim(p_name), v_code, v_uid, p_tournament_id, btrim(p_rules))
    RETURNING * INTO v_row;
  ELSE
    INSERT INTO public.leagues (name, invitation_code, admin_id, tournament_id)
    VALUES (btrim(p_name), v_code, v_uid, p_tournament_id)
    RETURNING * INTO v_row;  -- rules toma el DEFAULT
  END IF;

  -- El creador entra ya con las reglas aceptadas (él las definió)
  INSERT INTO public.league_members (league_id, user_id, rules_accepted_at)
  VALUES (v_row.id, v_uid, now()) ON CONFLICT DO NOTHING;
  RETURN v_row;
END; $$;

-- ---------------------------------------------------------------------------
-- accept_group_rules: el miembro acepta las reglas del grupo
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_group_rules(p_league_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  UPDATE public.league_members
  SET rules_accepted_at = now()
  WHERE league_id = p_league_id AND user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'No sos miembro de este grupo'; END IF;
END; $$;

-- ---------------------------------------------------------------------------
-- set_group_rules: solo el admin edita; los demás miembros deben re-aceptar
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_group_rules(p_league_id uuid, p_rules text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leagues WHERE id = p_league_id AND admin_id = v_uid) THEN
    RAISE EXCEPTION 'Solo el administrador puede editar las reglas';
  END IF;
  UPDATE public.leagues SET rules = btrim(COALESCE(p_rules,'')) WHERE id = p_league_id;
  -- Al cambiar las reglas, todos (menos el admin) deben volver a leerlas y aceptarlas
  UPDATE public.league_members
  SET rules_accepted_at = NULL
  WHERE league_id = p_league_id AND user_id <> v_uid;
END; $$;

-- ---------------------------------------------------------------------------
-- my_groups: agrega rules, is_admin y rules_accepted
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.my_groups();
CREATE OR REPLACE FUNCTION public.my_groups()
RETURNS TABLE (
  id uuid, name text, description text, invitation_code text, admin_id uuid,
  tournament_id int, tournament_name text, tournament_kind text, tournament_status text,
  members int, my_points numeric, my_rank int,
  rules text, is_admin boolean, rules_accepted boolean
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT l.id, l.name, l.description, l.invitation_code, l.admin_id,
    l.tournament_id, t.name, t.kind, t.status,
    (SELECT count(*)::int FROM public.league_members lm WHERE lm.league_id = l.id) AS members,
    COALESCE(utp.points, 0) AS my_points,
    (SELECT count(*)::int + 1 FROM public.league_members lm2
       JOIN public.user_tournament_points u2
         ON u2.user_id = lm2.user_id AND u2.tournament_id = l.tournament_id
       WHERE lm2.league_id = l.id AND u2.points > COALESCE(utp.points, 0)) AS my_rank,
    l.rules,
    (l.admin_id = auth.uid()) AS is_admin,
    (m.rules_accepted_at IS NOT NULL) AS rules_accepted
  FROM public.leagues l
  JOIN public.league_members m ON m.league_id = l.id AND m.user_id = auth.uid()
  JOIN public.tournaments t ON t.id = l.tournament_id
  LEFT JOIN public.user_tournament_points utp
    ON utp.user_id = auth.uid() AND utp.tournament_id = l.tournament_id
  ORDER BY (t.status = 'active') DESC, l.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.create_group(text,int,text)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_group_rules(uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_group_rules(uuid,text)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_groups()                   TO authenticated;

NOTIFY pgrst, 'reload schema';
