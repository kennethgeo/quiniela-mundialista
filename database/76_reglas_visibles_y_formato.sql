-- =============================================================================
-- 76_reglas_visibles_y_formato.sql
-- `my_groups` y `quiniela_por_id` no devolvían dos reglas que la pantalla SÍ
-- edita, así que se veían siempre vacías y el siguiente guardado las borraba.
-- Se agregan, más la referencia del torneo para ofrecer las fases de SU
-- formato. Solo funciones: no toca ninguna fila. Idempotente.
-- =============================================================================
--
-- DOS PÉRDIDAS SILENCIOSAS DE DATOS, LAS DOS DEL MISMO TIPO.
--
-- 1) `powerup_por_partidos` ("1 comodín cada N partidos", migración 67) se
--    EDITA en la tarjeta de Puntaje —`group.powerup_por_partidos`— pero
--    ninguna de las dos RPC lo devuelve. O sea que siempre se ve vacío, y el
--    guardado manda `null` para el campo vacío: guardar cualquier otra cosa
--    del puntaje BORRABA la razón sin avisar.
--
-- 2) `powerup_limits` (cupo por fase, migraciones 68/72/73) igual: el editor
--    recibe `valores={group.powerup_limits || {}}`, que era SIEMPRE `{}`. Los
--    cupos guardados no se veían, y como el guardado manda el objeto entero,
--    al guardar una fase nueva se perdían todas las demás.
--
--    Nadie lo había notado porque hasta la 74 el editor estaba bloqueado en
--    los dos torneos donde se usa.
--
-- 3) Además se expone `tournament_ref` (`tournaments.external_ref`: 'crc.1',
--    'uefa.champions'…) para que la pantalla ofrezca las rondas que ESE
--    torneo juega de verdad. Hoy la liga tica ofrece «Dieciseisavos» y
--    «Octavos», que no existen ahí, y eso invita a configurar un cupo que
--    nunca se va a aplicar. Es un dato PÚBLICO del torneo, no del usuario:
--    ya se devuelven nombre, tipo y estado.
--
-- Cambiar el tipo de retorno de un RETURNS TABLE obliga a DROP + CREATE, y eso
-- REABRE EL ACL A PUBLIC (comprobado, migración 66). Por eso se revoca y se
-- re-otorga a mano al final, y se verifica.

BEGIN;

DROP FUNCTION IF EXISTS public.my_groups();
CREATE FUNCTION public.my_groups()
RETURNS TABLE(id uuid, name text, description text, invitation_code text,
  admin_id uuid, tournament_id integer, tournament_name text, tournament_kind text,
  tournament_status text, tournament_ref text, members integer, my_points numeric,
  my_rank integer, rules text, is_admin boolean, rules_accepted boolean,
  points_exact integer, points_correct integer, champion_points integer,
  scorer_points integer, powerup_limit integer, assist_points integer,
  powerup_por_partidos integer, powerup_limits jsonb,
  open_proposal boolean, my_pending_vote boolean, prizes_text text,
  whatsapp_link text, soy_creador boolean)
LANGUAGE sql SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT l.id, l.name, l.description, l.invitation_code, l.admin_id, l.tournament_id,
         t.name, t.kind, t.status, t.external_ref,
         (SELECT count(*)::int FROM public.league_members lm WHERE lm.league_id = l.id) AS members,
         public.league_points(l.id, auth.uid()) AS my_points,
         public.league_rank(l.id, auth.uid()) AS my_rank,
         l.rules, public.es_admin_liga(l.id, auth.uid()) AS is_admin,
         (m.rules_accepted_at IS NOT NULL) AS rules_accepted,
         l.points_exact, l.points_correct, l.champion_points, l.scorer_points,
         l.powerup_limit, l.assist_points,
         l.powerup_por_partidos, COALESCE(l.powerup_limits, '{}'::jsonb),
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

DROP FUNCTION IF EXISTS public.quiniela_por_id(uuid);
CREATE FUNCTION public.quiniela_por_id(p_league_id uuid)
RETURNS TABLE(id uuid, name text, description text, invitation_code text,
  admin_id uuid, tournament_id integer, tournament_name text, tournament_kind text,
  tournament_status text, tournament_ref text, members integer, my_points numeric,
  my_rank integer, rules text, is_admin boolean, rules_accepted boolean,
  points_exact integer, points_correct integer, champion_points integer,
  scorer_points integer, powerup_limit integer, assist_points integer,
  powerup_por_partidos integer, powerup_limits jsonb,
  open_proposal boolean, my_pending_vote boolean, prizes_text text,
  whatsapp_link text, soy_creador boolean, soy_miembro boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF NOT public.puede_ver_quiniela(p_league_id) THEN
    RAISE EXCEPTION 'No tenés acceso a esta quiniela';
  END IF;

  RETURN QUERY
  SELECT l.id, l.name, l.description, l.invitation_code, l.admin_id, l.tournament_id,
         t.name, t.kind, t.status, t.external_ref,
         (SELECT count(*)::int FROM public.league_members lm WHERE lm.league_id = l.id),
         public.league_points(l.id, auth.uid()),
         public.league_rank(l.id, auth.uid()),
         l.rules,
         -- El admin global NO figura como admin de la quiniela: eso sigue
         -- siendo del creador y sus co-admins. La pestaña Admin se le muestra
         -- por su condición global, no por esta bandera.
         public.es_admin_liga(l.id, auth.uid()),
         (m.rules_accepted_at IS NOT NULL),
         l.points_exact, l.points_correct, l.champion_points, l.scorer_points,
         l.powerup_limit, l.assist_points,
         l.powerup_por_partidos, COALESCE(l.powerup_limits, '{}'::jsonb),
         EXISTS (SELECT 1 FROM public.rule_proposals rp
                 WHERE rp.league_id = l.id AND rp.status = 'open'
                   AND (rp.expires_at IS NULL OR rp.expires_at > now())),
         EXISTS (SELECT 1 FROM public.rule_proposals rp
                 WHERE rp.league_id = l.id AND rp.status = 'open'
                   AND (rp.expires_at IS NULL OR rp.expires_at > now())
                   AND NOT EXISTS (SELECT 1 FROM public.rule_votes rv
                                   WHERE rv.proposal_id = rp.id AND rv.user_id = auth.uid())),
         l.prizes_text, l.whatsapp_link,
         (l.admin_id = auth.uid()),
         (m.user_id IS NOT NULL)
  FROM public.leagues l
  JOIN public.tournaments t ON t.id = l.tournament_id
  LEFT JOIN public.league_members m ON m.league_id = l.id AND m.user_id = auth.uid()
  WHERE l.id = p_league_id;
END; $$;

-- El DROP reabrió el ACL a PUBLIC; hay que volver a cerrarlo.
REVOKE ALL ON FUNCTION public.my_groups() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.quiniela_por_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_groups() TO authenticated;
GRANT EXECUTE ON FUNCTION public.quiniela_por_id(uuid) TO authenticated;

DO $verificar$
DECLARE f text; v_res text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.my_groups()', 'public.quiniela_por_id(uuid)'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') THEN
      RAISE EXCEPTION '% quedo ejecutable por anon', f;
    END IF;
    IF NOT has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION '% perdio EXECUTE para authenticated', f;
    END IF;
  END LOOP;

  -- Las tres columnas nuevas, en las dos RPC. Sin esto la pantalla vuelve a
  -- ver las reglas vacías y a borrarlas al guardar.
  FOREACH f IN ARRAY ARRAY['my_groups', 'quiniela_por_id'] LOOP
    SELECT pg_get_function_result(p.oid) INTO v_res
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = f;

    IF v_res NOT LIKE '%powerup_limits jsonb%'
       OR v_res NOT LIKE '%powerup_por_partidos integer%'
       OR v_res NOT LIKE '%tournament_ref text%' THEN
      RAISE EXCEPTION '% no devuelve las columnas nuevas', f;
    END IF;
  END LOOP;

  RAISE NOTICE 'Las reglas de comodines ya viajan a la pantalla. Ninguna fila modificada.';
END $verificar$;

COMMIT;

NOTIFY pgrst, 'reload schema';
