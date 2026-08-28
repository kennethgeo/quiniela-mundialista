-- =============================================================================
-- 66_acceso_del_admin_global.sql  ·  El super admin puede entrar a cualquier quiniela
-- =============================================================================
-- Hasta ahora el admin global de la app NO veía las quinielas ajenas. Tres
-- capas coincidían en impedirlo: my_groups() solo devuelve donde sos miembro,
-- la RLS de leagues solo deja leer las tuyas, y cada función de lectura corta
-- con "no sos miembro". Si alguien creaba una quiniela, el dueño de la app no
-- podía verla ni para moderarla.
--
-- ESTO ES UN PRIVILEGIO GRANDE Y ESTÁ HECHO A PROPÓSITO, decidido por el dueño:
-- el admin global entra a cualquier quiniela y ve lo mismo que un miembro
-- —tabla, histórico, predicciones destapadas, pozo, medallas—.
--
-- LÍMITES QUE SÍ SE MANTIENEN. "Ver" no es "actuar en nombre de otros", así que
-- estas siguen exigiendo membresía real y NO se tocaron:
--   · accept_group_rules  (aceptar las reglas es un acto personal)
--   · avisar_pago         (nadie dice "yo pagué" por otro)
--   · cast_rule_vote      (votar en una quiniela ajena adulteraría la votación)
--   · set_league_admin    (nombrar admins sigue siendo solo del creador)
-- Tampoco se toca el destape de 15 minutos: el admin global ve las predicciones
-- ajenas cuando ya están destapadas, igual que los miembros. Antes del saque
-- nadie las ve, y eso incluye al dueño de la app.
--
-- POR QUÉ UN AYUDANTE NUEVO Y NO ENSANCHAR is_league_member(): esa función se
-- llama así porque responde "¿es miembro?". Hacerla devolver true para alguien
-- que NO lo es sería una mentira en el nombre, y la próxima persona que la use
-- para un permiso de escritura abriría un agujero sin darse cuenta. Este
-- proyecto ya se comió ese problema con otras funciones.
-- Idempotente.
-- =============================================================================

-- ── Los dos ayudantes ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.es_admin_global()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT u.is_admin FROM public.users u WHERE u.id = auth.uid()), FALSE);
$$;
COMMENT ON FUNCTION public.es_admin_global() IS
  'Admin de la APLICACIÓN (users.is_admin). Distinto de es_admin_liga, que es admin de UNA quiniela.';

CREATE OR REPLACE FUNCTION public.puede_ver_quiniela(p_league_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_league_member(p_league_id) OR public.es_admin_global();
$$;
COMMENT ON FUNCTION public.puede_ver_quiniela(uuid) IS
  'Puede LEER esta quiniela: sus miembros, o el admin global. Solo para lecturas — las acciones personales (votar, avisar un pago, aceptar reglas) siguen exigiendo membresía real.';

-- ── Poder abrir una quiniela ajena ───────────────────────────────────────────
-- my_groups() se deja intacta a propósito: si devolviera todas las quinielas al
-- admin global, su hub se llenaría de grupos de desconocidos. Esta función trae
-- UNA, y es la que usa la pantalla cuando no está en tu lista.
CREATE OR REPLACE FUNCTION public.quiniela_por_id(p_league_id uuid)
RETURNS TABLE (
  id uuid, name text, description text, invitation_code text, admin_id uuid,
  tournament_id integer, tournament_name text, tournament_kind text, tournament_status text,
  members integer, my_points numeric, my_rank integer, rules text, is_admin boolean,
  rules_accepted boolean, points_exact integer, points_correct integer, champion_points integer,
  scorer_points integer, powerup_limit integer, assist_points integer, open_proposal boolean,
  my_pending_vote boolean, prizes_text text, whatsapp_link text, soy_creador boolean,
  soy_miembro boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.puede_ver_quiniela(p_league_id) THEN
    RAISE EXCEPTION 'No tenés acceso a esta quiniela';
  END IF;

  RETURN QUERY
  SELECT l.id, l.name, l.description, l.invitation_code, l.admin_id, l.tournament_id,
         t.name, t.kind, t.status,
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

-- ── Las funciones de lectura pasan a usar puede_ver_quiniela ─────────────────
-- Cuerpos idénticos a los vigentes: lo único que cambia es la línea del guard.
CREATE OR REPLACE FUNCTION public.group_standings(p_league_id uuid)
RETURNS TABLE (
  user_id uuid, display_name text, avatar_url text, points numeric, is_me boolean,
  exactos_x2 int, exactos int, aciertos int, jugadas int, error_goles int, pos int
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.puede_ver_quiniela(p_league_id) THEN
    RAISE EXCEPTION 'No sos miembro de este grupo';
  END IF;
  RETURN QUERY
    SELECT t.uid, t.display_name, t.avatar_url, t.points, (t.uid = auth.uid()),
           t.exactos_x2, t.exactos, t.aciertos, t.jugadas, t.error_goles, t.pos
    FROM public.league_table(p_league_id) t
    ORDER BY t.pos;
END; $$;

CREATE OR REPLACE FUNCTION public.league_jornadas(p_league_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tid int;
  v_out jsonb;
BEGIN
  IF NOT public.puede_ver_quiniela(p_league_id) THEN
    RAISE EXCEPTION 'No sos miembro de esta quiniela';
  END IF;

  SELECT l.tournament_id INTO v_tid FROM public.leagues l WHERE l.id = p_league_id;
  IF v_tid IS NULL THEN
    RETURN jsonb_build_object('jornadas', '[]'::jsonb, 'rachas', '[]'::jsonb);
  END IF;

  WITH mj AS (
    SELECT m.id, m.status, m.kickoff_at, m.home_goals_actual, m.away_goals_actual,
           COALESCE(m.stage, CASE WHEN m.matchday IS NOT NULL THEN 'J' || m.matchday END,
                    m.phase, 'otros') AS jkey,
           COALESCE(m.stage, CASE WHEN m.matchday IS NOT NULL THEN 'Jornada ' || m.matchday END,
                    replace(m.phase, '_', ' '), 'Partidos') AS label
    FROM public.matches m
    WHERE m.tournament_id = v_tid
      AND m.status NOT IN ('cancelled', 'postponed')
  ),
  jor AS (
    SELECT mj.jkey, min(mj.label) AS label, min(mj.kickoff_at) AS desde,
           count(*)::int AS partidos,
           count(*) FILTER (WHERE mj.status = 'finished')::int AS terminados
    FROM mj GROUP BY mj.jkey
  ),
  mem AS (
    SELECT u.id AS uid, u.display_name, u.avatar_url, u.created_at
    FROM public.league_members lm
    JOIN public.users u ON u.id = lm.user_id
    WHERE lm.league_id = p_league_id
  ),
  -- Cruz completa miembro × jornada: quien no predijo nada igual aparece con 0,
  -- si no la jornada mostraría una lista distinta a la del grupo.
  agg AS (
    SELECT j.jkey, mem.uid, mem.display_name, mem.avatar_url, mem.created_at,
      COALESCE(SUM(COALESCE(p.points_earned, 0)), 0)::numeric AS puntos,
      COALESCE(SUM(CASE WHEN p.use_powerup_x2
                         AND p.home_goals_pred = f.home_goals_actual
                         AND p.away_goals_pred = f.away_goals_actual
                        THEN 1 ELSE 0 END), 0)::int AS exactos_x2,
      COALESCE(SUM(CASE WHEN p.home_goals_pred = f.home_goals_actual
                         AND p.away_goals_pred = f.away_goals_actual
                        THEN 1 ELSE 0 END), 0)::int AS exactos,
      COALESCE(SUM(CASE WHEN COALESCE(p.points_earned, 0) > 0 THEN 1 ELSE 0 END), 0)::int AS aciertos,
      COALESCE(SUM(CASE WHEN p.id IS NOT NULL THEN 1 ELSE 0 END), 0)::int AS jugadas,
      COALESCE(SUM(CASE WHEN p.id IS NOT NULL
                        THEN abs(p.home_goals_pred - f.home_goals_actual)
                           + abs(p.away_goals_pred - f.away_goals_actual)
                        ELSE 0 END), 0)::int AS error_goles,
      COALESCE(SUM(CASE WHEN p.use_powerup_x2 THEN 1 ELSE 0 END), 0)::int AS x2_usados
    FROM jor j
    CROSS JOIN mem
    LEFT JOIN mj f ON f.jkey = j.jkey AND f.status = 'finished'
    LEFT JOIN public.predictions p
           ON p.match_id = f.id AND p.user_id = mem.uid AND p.league_id = p_league_id
    GROUP BY j.jkey, mem.uid, mem.display_name, mem.avatar_url, mem.created_at
  ),
  -- Misma escalera que public.league_table, acotada a la jornada.
  ranked AS (
    SELECT a.*,
      (row_number() OVER (PARTITION BY a.jkey
        ORDER BY a.puntos DESC, a.exactos_x2 DESC, a.exactos DESC, a.aciertos DESC,
                 a.jugadas DESC, a.error_goles ASC, a.created_at ASC))::int AS pos
    FROM agg a
  ),
  por_jornada AS (
    SELECT r.jkey,
      jsonb_agg(jsonb_build_object(
        'user_id', r.uid, 'display_name', r.display_name, 'avatar_url', r.avatar_url,
        'puntos', r.puntos, 'exactos', r.exactos, 'exactos_x2', r.exactos_x2,
        'aciertos', r.aciertos, 'jugadas', r.jugadas, 'error_goles', r.error_goles,
        'x2_usados', r.x2_usados, 'pos', r.pos, 'soy_yo', (r.uid = v_uid)
      ) ORDER BY r.pos) AS tabla,
      -- Sin puntos no hay ganador: el FILTER deja el agregado en NULL y '-> 0'
      -- lo propaga como null.
      (jsonb_agg(jsonb_build_object(
        'user_id', r.uid, 'display_name', r.display_name,
        'avatar_url', r.avatar_url, 'puntos', r.puntos
       ) ORDER BY r.pos) FILTER (WHERE r.pos = 1 AND r.puntos > 0)) -> 0 AS ganador
    FROM ranked r GROUP BY r.jkey
  ),
  jornadas_json AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'jkey', j.jkey, 'label', j.label, 'desde', j.desde,
      'partidos', j.partidos, 'terminados', j.terminados,
      'cerrada', (j.partidos > 0 AND j.terminados = j.partidos),
      'tabla', pj.tabla, 'ganador', pj.ganador
    ) ORDER BY j.desde), '[]'::jsonb) AS js
    FROM jor j JOIN por_jornada pj ON pj.jkey = j.jkey
  ),
  -- ── Rachas: solo sobre jornadas cerradas ──────────────────────────────────
  cerradas AS (
    SELECT r.uid, r.display_name, r.avatar_url, r.puntos, r.pos,
           j.jkey, j.label, j.desde,
           (r.pos = 1 AND r.puntos > 0) AS gano
    FROM ranked r JOIN jor j ON j.jkey = r.jkey
    WHERE j.partidos > 0 AND j.terminados = j.partidos
  ),
  -- Islas de jornadas ganadas seguidas (gaps-and-islands clásico).
  islas AS (
    SELECT c.*,
      row_number() OVER (PARTITION BY c.uid ORDER BY c.desde)
        - row_number() OVER (PARTITION BY c.uid, c.gano ORDER BY c.desde) AS isla
    FROM cerradas c
  ),
  tramos AS (
    SELECT i.uid, i.isla, count(*)::int AS largo, max(i.desde) AS fin
    FROM islas i WHERE i.gano GROUP BY i.uid, i.isla
  ),
  ultima AS (
    SELECT c.uid, max(c.desde) AS desde FROM cerradas c GROUP BY c.uid
  ),
  forma AS (
    SELECT z.uid, jsonb_agg(jsonb_build_object(
             'jkey', z.jkey, 'label', z.label, 'puntos', z.puntos, 'gano', z.gano
           ) ORDER BY z.desde) AS js
    FROM (
      SELECT c.*, row_number() OVER (PARTITION BY c.uid ORDER BY c.desde DESC) AS rrn
      FROM cerradas c
    ) z WHERE z.rrn <= 5 GROUP BY z.uid
  ),
  resumen AS (
    SELECT m.uid, m.display_name, m.avatar_url,
      COALESCE(count(c.jkey) FILTER (WHERE c.gano), 0)::int AS ganadas,
      COALESCE(count(c.jkey), 0)::int AS jornadas,
      COALESCE((SELECT max(t.largo) FROM tramos t WHERE t.uid = m.uid), 0) AS mejor_racha,
      -- La racha ACTUAL es el tramo ganado que llega hasta la última jornada
      -- cerrada de esa persona; si la última no la ganó, la racha es 0.
      COALESCE((SELECT t.largo FROM tramos t JOIN ultima u ON u.uid = t.uid
                WHERE t.uid = m.uid AND t.fin = u.desde), 0) AS racha_actual,
      COALESCE((SELECT f.js FROM forma f WHERE f.uid = m.uid), '[]'::jsonb) AS forma
    FROM mem m LEFT JOIN cerradas c ON c.uid = m.uid
    GROUP BY m.uid, m.display_name, m.avatar_url
  ),
  rachas_json AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'user_id', s.uid, 'display_name', s.display_name, 'avatar_url', s.avatar_url,
      'soy_yo', (s.uid = v_uid), 'ganadas', s.ganadas, 'jornadas', s.jornadas,
      'racha_actual', s.racha_actual, 'mejor_racha', s.mejor_racha, 'forma', s.forma
    ) ORDER BY s.ganadas DESC, s.racha_actual DESC, s.mejor_racha DESC, s.display_name),
    '[]'::jsonb) AS js
    FROM resumen s
  )
  SELECT jsonb_build_object('jornadas', jj.js, 'rachas', rj.js)
  INTO v_out
  FROM jornadas_json jj CROSS JOIN rachas_json rj;

  RETURN COALESCE(v_out, jsonb_build_object('jornadas', '[]'::jsonb, 'rachas', '[]'::jsonb));
END; $$;

CREATE OR REPLACE FUNCTION public.league_medals(p_league_id uuid)
RETURNS TABLE (user_id uuid, display_name text, avatar_url text, badge_key text, tier int, meta jsonb, earned_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.puede_ver_quiniela(p_league_id) THEN
    RAISE EXCEPTION 'No sos miembro de esta quiniela';
  END IF;
  RETURN QUERY
    SELECT ub.user_id, u.display_name, u.avatar_url, ub.badge_key, ub.tier, ub.meta, ub.earned_at
    FROM public.user_badges ub
    JOIN public.users u ON u.id = ub.user_id
    WHERE ub.league_id = p_league_id
    ORDER BY ub.tier DESC, ub.earned_at;
END; $$;

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
  IF NOT public.puede_ver_quiniela(p_league_id) THEN
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
  IF NOT public.puede_ver_quiniela(p_league_id) THEN
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

CREATE OR REPLACE FUNCTION public.league_proposals(p_league_id uuid)
RETURNS TABLE (
  id uuid, kind text, payload jsonb, note text, status text,
  created_at timestamptz, closed_at timestamptz, expires_at timestamptz,
  proposed_by uuid, proposer_name text,
  members int, yes_count int, no_count int, my_vote boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.puede_ver_quiniela(p_league_id) THEN
    RAISE EXCEPTION 'No sos miembro de esta quiniela';
  END IF;
  PERFORM public._resolve_expired_proposals(p_league_id);
  RETURN QUERY
    SELECT p.id, p.kind, p.payload, p.note, p.status, p.created_at, p.closed_at, p.expires_at,
      p.proposed_by, u.display_name,
      (SELECT count(*)::int FROM public.league_members lm WHERE lm.league_id = p.league_id),
      (SELECT count(*)::int FROM public.rule_votes v WHERE v.proposal_id = p.id AND v.vote),
      (SELECT count(*)::int FROM public.rule_votes v WHERE v.proposal_id = p.id AND NOT v.vote),
      (SELECT v.vote FROM public.rule_votes v WHERE v.proposal_id = p.id AND v.user_id = auth.uid())
    FROM public.rule_proposals p
    JOIN public.users u ON u.id = p.proposed_by
    WHERE p.league_id = p_league_id
    ORDER BY (p.status = 'open') DESC, p.created_at DESC
    LIMIT 20;
END; $$;

CREATE OR REPLACE FUNCTION public.league_table(p_league_id uuid)
RETURNS TABLE (
  uid uuid, display_name text, avatar_url text, created_at timestamptz,
  points numeric, exactos_x2 int, exactos int, aciertos int, jugadas int, error_goles int, pos int
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.es_backend() AND NOT public.puede_ver_quiniela(p_league_id) THEN
    RAISE EXCEPTION 'No sos miembro de esta quiniela';
  END IF;

  RETURN QUERY
  WITH agg AS (
    SELECT u.id AS uid, u.display_name, u.avatar_url, u.created_at,
           public.league_points(p_league_id, u.id) AS points,
           COALESCE(SUM(CASE WHEN m.status = 'finished' AND p.use_powerup_x2
                              AND p.home_goals_pred = m.home_goals_actual
                              AND p.away_goals_pred = m.away_goals_actual
                             THEN 1 ELSE 0 END), 0)::int AS exactos_x2,
           COALESCE(SUM(CASE WHEN m.status = 'finished'
                              AND p.home_goals_pred = m.home_goals_actual
                              AND p.away_goals_pred = m.away_goals_actual
                             THEN 1 ELSE 0 END), 0)::int AS exactos,
           COALESCE(SUM(CASE WHEN m.status = 'finished' AND COALESCE(p.points_earned, 0) > 0
                             THEN 1 ELSE 0 END), 0)::int AS aciertos,
           COALESCE(SUM(CASE WHEN m.status = 'finished' THEN 1 ELSE 0 END), 0)::int AS jugadas,
           COALESCE(SUM(CASE WHEN m.status = 'finished'
                             THEN abs(p.home_goals_pred - m.home_goals_actual)
                                + abs(p.away_goals_pred - m.away_goals_actual)
                             ELSE 0 END), 0)::int AS error_goles
    FROM public.league_members lm
    JOIN public.users u ON u.id = lm.user_id
    LEFT JOIN public.predictions p ON p.user_id = u.id AND p.league_id = p_league_id
    LEFT JOIN public.matches m ON m.id = p.match_id
    WHERE lm.league_id = p_league_id
    GROUP BY u.id, u.display_name, u.avatar_url, u.created_at
  )
  SELECT a.uid, a.display_name, a.avatar_url, a.created_at, a.points, a.exactos_x2,
         a.exactos, a.aciertos, a.jugadas, a.error_goles,
         (row_number() OVER (ORDER BY a.points DESC, a.exactos_x2 DESC, a.exactos DESC,
                                      a.aciertos DESC, a.jugadas DESC, a.error_goles ASC,
                                      a.created_at ASC))::int
  FROM agg a;
END; $$;

CREATE OR REPLACE FUNCTION public.match_audit_log(p_tournament_id integer, p_limite integer DEFAULT 30)
RETURNS TABLE (
  id uuid, changed_at timestamptz, campo text, valor_antes text, valor_despues text,
  match_id integer, home_team text, away_team text, matchday integer, autor text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.es_backend() AND NOT public.es_admin_global()
     AND NOT EXISTS (SELECT 1 FROM public.league_members lm
                     JOIN public.leagues l ON l.id = lm.league_id
                     WHERE lm.user_id = auth.uid() AND l.tournament_id = p_tournament_id) THEN
    RAISE EXCEPTION 'No jugás ninguna quiniela de este torneo';
  END IF;

  RETURN QUERY
  SELECT a.id, a.changed_at, a.campo, a.valor_antes, a.valor_despues,
         m.id, m.home_team, m.away_team, m.matchday,
         COALESCE(u.display_name, 'Admin')
  FROM public.match_audit a
  JOIN public.matches m ON m.id = a.match_id
  LEFT JOIN public.users u ON u.id = a.changed_by
  WHERE m.tournament_id = p_tournament_id
  ORDER BY a.changed_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limite, 30), 1), 100);
END; $$;

CREATE OR REPLACE FUNCTION public.perfil_en_quiniela(p_league_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_t record;
  v_miembros int;
  v_x2_usados int;
  v_x2_pegados int;
  v_racha jsonb;
  v_mejor jsonb;
BEGIN
  IF NOT public.puede_ver_quiniela(p_league_id) THEN
    RAISE EXCEPTION 'No sos miembro de esta quiniela';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.league_members lm
                 WHERE lm.league_id = p_league_id AND lm.user_id = p_user_id) THEN
    RAISE EXCEPTION 'Esa persona no juega esta quiniela';
  END IF;

  SELECT * INTO v_t FROM public.league_table(p_league_id) t WHERE t.uid = p_user_id;
  SELECT count(*)::int INTO v_miembros FROM public.league_members WHERE league_id = p_league_id;

  SELECT COALESCE(count(*) FILTER (WHERE p.use_powerup_x2), 0)::int,
         COALESCE(count(*) FILTER (WHERE p.use_powerup_x2 AND COALESCE(p.points_earned,0) > 0), 0)::int
    INTO v_x2_usados, v_x2_pegados
  FROM public.predictions p
  JOIN public.matches m ON m.id = p.match_id
  WHERE p.league_id = p_league_id AND p.user_id = p_user_id AND m.status = 'finished';

  -- Las rachas salen de league_jornadas, que ya las calcula con el desempate
  -- oficial y solo sobre jornadas cerradas.
  SELECT r INTO v_racha
  FROM jsonb_array_elements(public.league_jornadas(p_league_id) -> 'rachas') r
  WHERE r ->> 'user_id' = p_user_id::text;

  -- Su mejor partido en esta quiniela, para que el perfil cuente una historia
  -- y no sea solo una lista de números.
  SELECT jsonb_build_object(
           'match_id', m.id, 'local', m.home_team, 'visita', m.away_team,
           'marcador', COALESCE(m.home_goals_actual::text,'-') || '-' || COALESCE(m.away_goals_actual::text,'-'),
           'prediccion', p.home_goals_pred || '-' || p.away_goals_pred,
           'puntos', COALESCE(p.points_earned,0), 'x2', p.use_powerup_x2)
    INTO v_mejor
  FROM public.predictions p
  JOIN public.matches m ON m.id = p.match_id
  WHERE p.league_id = p_league_id AND p.user_id = p_user_id AND m.status = 'finished'
  ORDER BY COALESCE(p.points_earned,0) DESC, m.kickoff_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'display_name', v_t.display_name,
    'avatar_url', v_t.avatar_url,
    'soy_yo', (p_user_id = v_uid),
    'puntos', COALESCE(v_t.points, 0),
    'pos', v_t.pos,
    'miembros', v_miembros,
    'exactos', COALESCE(v_t.exactos, 0),
    'exactos_x2', COALESCE(v_t.exactos_x2, 0),
    'aciertos', COALESCE(v_t.aciertos, 0),
    'jugadas', COALESCE(v_t.jugadas, 0),
    'error_goles', COALESCE(v_t.error_goles, 0),
    'x2_usados', v_x2_usados,
    'x2_pegados', v_x2_pegados,
    'jornadas_ganadas', COALESCE((v_racha ->> 'ganadas')::int, 0),
    'racha_actual', COALESCE((v_racha ->> 'racha_actual')::int, 0),
    'mejor_racha', COALESCE((v_racha ->> 'mejor_racha')::int, 0),
    'forma', COALESCE(v_racha -> 'forma', '[]'::jsonb),
    'mejor_partido', v_mejor,
    'medallas', COALESCE((SELECT jsonb_agg(jsonb_build_object('badge_key', ub.badge_key, 'tier', ub.tier, 'meta', ub.meta)
                          ORDER BY ub.tier DESC, ub.badge_key)
                          FROM public.user_badges ub
                          WHERE ub.league_id = p_league_id AND ub.user_id = p_user_id), '[]'::jsonb)
  );
END; $$;

-- ── Las políticas RLS de lectura ─────────────────────────────────────────────
-- Las permisivas se COMBINAN CON OR: si quedara viva una política vieja que
-- deja leer a todos, el filtro por membresía de abajo no serviría de nada.
DROP POLICY IF EXISTS "Permitir lectura de miembros a todos" ON public.league_members;
DROP POLICY IF EXISTS "league_members_select_members" ON public.league_members;
DROP POLICY IF EXISTS "league_members_select_same_league" ON public.league_members;
CREATE POLICY "league_members_select_same_league" ON public.league_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.puede_ver_quiniela(league_id));

DROP POLICY IF EXISTS "user_badges_select_members" ON public.user_badges;
CREATE POLICY "user_badges_select_members" ON public.user_badges
  FOR SELECT TO authenticated USING (public.puede_ver_quiniela(league_id));

DROP POLICY IF EXISTS "rule_proposals_select_members" ON public.rule_proposals;
CREATE POLICY "rule_proposals_select_members" ON public.rule_proposals
  FOR SELECT TO authenticated USING (public.puede_ver_quiniela(league_id));

DROP POLICY IF EXISTS "rule_votes_select_members" ON public.rule_votes;
CREATE POLICY "rule_votes_select_members" ON public.rule_votes
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.rule_proposals p
            WHERE p.id = proposal_id AND public.puede_ver_quiniela(p.league_id)));

DROP POLICY IF EXISTS "Permitir lectura de ligas a todos" ON public.leagues;
DROP POLICY IF EXISTS "leagues_select_members" ON public.leagues;
CREATE POLICY "leagues_select_members" ON public.leagues
  FOR SELECT TO authenticated USING (public.puede_ver_quiniela(id));

-- Las predicciones: se conserva el destape de 15 min TAL CUAL. El admin global
-- gana el acceso a la quiniela, no la capacidad de espiar antes del saque.
DROP POLICY IF EXISTS "predictions_select_propia_o_de_mi_quiniela" ON public.predictions;
CREATE POLICY "predictions_select_propia_o_de_mi_quiniela"
  ON public.predictions FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR (
      public.puede_ver_quiniela(league_id)
      AND (SELECT m.kickoff_at - interval '15 minutes' <= now()
           FROM public.matches m WHERE m.id = match_id)
    )
  );

-- ── Permisos ─────────────────────────────────────────────────────────────────
-- anon no tiene nada que hacer en las tablas privadas. La RLS ya lo frenaría,
-- pero un GRANT amplio copiado de un tutorial la deja sin efecto si alguien
-- desactiva RLS por un rato.
REVOKE SELECT ON
  public.leagues,
  public.league_members,
  public.predictions,
  public.user_badges,
  public.rule_proposals,
  public.rule_votes
FROM anon;

-- es_admin_global es un ayudante INTERNO: no lo llama ningún cliente ni ninguna
-- política. Lo invoca puede_ver_quiniela, que es SECURITY DEFINER y por lo
-- tanto lo ejecuta como su dueño. Dárselo a 'authenticated' solo agrandaría la
-- superficie sin que nadie lo use.
REVOKE ALL ON FUNCTION public.es_admin_global()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.puede_ver_quiniela(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.quiniela_por_id(uuid)    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.es_admin_global()        TO service_role;
-- puede_ver_quiniela SÍ la necesita 'authenticated': se evalúa DENTRO de las
-- políticas RLS, o sea con los privilegios de quien consulta.
GRANT EXECUTE ON FUNCTION public.puede_ver_quiniela(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.quiniela_por_id(uuid)    TO authenticated, service_role;

-- ── Verificación ─────────────────────────────────────────────────────────────
-- Con RAISE EXCEPTION y no WARNING a propósito: si algo de esto no se cumple, la
-- migración entera se revierte. Un aviso en la consola se pasa por alto; una
-- base a medio endurecer es peor que una sin endurecer, porque parece segura.
DO $red$
DECLARE
  v_n int;
  v_abiertas text[];
  v_tablas text[];
BEGIN
  -- 1) Una sola política de lectura en predictions: las permisivas se combinan
  --    con OR, así que dos apiladas anulan el filtro por quiniela.
  SELECT count(*) INTO v_n FROM pg_policies
  WHERE schemaname='public' AND tablename='predictions' AND cmd IN ('SELECT','ALL');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Quedaron % políticas de lectura sobre predictions (debe haber 1): al combinarse con OR anulan el filtro por quiniela.', v_n;
  END IF;

  -- 2) Lo mismo para leagues y league_members.
  SELECT count(*) INTO v_n FROM pg_policies
  WHERE schemaname='public' AND tablename='leagues' AND cmd IN ('SELECT','ALL');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Quedaron % políticas de lectura sobre leagues (debe haber 1).', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM pg_policies
  WHERE schemaname='public' AND tablename='league_members' AND cmd IN ('SELECT','ALL');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Quedaron % políticas de lectura sobre league_members (debe haber 1).', v_n;
  END IF;

  -- 3) El candado de 15 minutos sigue en su lugar. Esto es lo que impide
  --    cambiar una predicción después de ver el resultado.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='predictions' AND cmd='UPDATE'
      AND with_check LIKE '%kickoff_at%'
  ) THEN
    RAISE EXCEPTION 'La política de UPDATE de predictions perdió el candado de 15 minutos en su WITH CHECK.';
  END IF;

  -- 4) anon no lee ninguna de las tablas privadas.
  SELECT array_agg(t ORDER BY t) INTO v_tablas
  FROM unnest(ARRAY['leagues','league_members','predictions',
                    'user_badges','rule_proposals','rule_votes']) t
  WHERE has_table_privilege('anon', format('public.%I', t), 'SELECT');
  IF v_tablas IS NOT NULL THEN
    RAISE EXCEPTION 'anon todavía puede leer: %', v_tablas;
  END IF;

  -- 5) Ninguna SECURITY DEFINER alcanzable por anon.
  SELECT array_agg(p.proname ORDER BY p.proname) INTO v_abiertas
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef
    AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_abiertas IS NOT NULL THEN
    RAISE EXCEPTION 'anon todavía puede ejecutar SECURITY DEFINER: %', v_abiertas;
  END IF;

  -- 6) es_admin_global es interno: no debe alcanzarlo un cliente.
  IF has_function_privilege('authenticated', 'public.es_admin_global()', 'EXECUTE') THEN
    RAISE EXCEPTION 'es_admin_global no debería ser ejecutable por authenticated: es un ayudante interno de puede_ver_quiniela.';
  END IF;

  -- 7) …pero estas dos SÍ, o se caen las políticas RLS y la pantalla de una
  --    quiniela ajena.
  IF NOT has_function_privilege('authenticated', 'public.puede_ver_quiniela(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated necesita EXECUTE en puede_ver_quiniela: se evalúa dentro de las políticas RLS.';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.quiniela_por_id(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated necesita EXECUTE en quiniela_por_id para abrir una quiniela.';
  END IF;

  RAISE NOTICE 'Listo: el admin global puede leer cualquier quiniela; votar, pagar y aceptar reglas siguen exigiendo membresía.';
END $red$;

NOTIFY pgrst, 'reload schema';
