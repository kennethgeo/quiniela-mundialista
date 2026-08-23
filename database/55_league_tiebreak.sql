-- =============================================================================
-- 55_league_tiebreak.sql  ·  Desempate deportivo de la tabla de una quiniela
-- =============================================================================
-- ANTES había dos criterios distintos conviviendo, y ninguno era deportivo:
--   · group_standings (la pestaña Tabla) ordenaba por puntos y desempataba por
--     users.created_at — o sea, ganaba el que se registró primero en la app.
--   · my_groups.my_rank (el "#N de 17" del Resumen) contaba cuántos tenían MÁS
--     puntos, así que los empatados compartían número.
-- Resultado: con un triple empate en el 1er puesto, la Tabla mostraba 1º/2º/3º
-- por antigüedad de cuenta mientras el Resumen les mostraba "#1" a los tres.
--
-- AHORA hay una sola escalera de desempate, basada en datos, y ambas vistas la
-- comparten:
--   1) puntos                                            DESC
--   2) marcadores exactos clavados CON el comodín ×2     DESC
--   3) marcadores exactos (todos)                        DESC
--   4) aciertos de resultado (points_earned > 0)         DESC
--   5) partidos jugados (predicciones sobre finalizados) DESC
--   6) error de gol acumulado (|dif| local + visita)     ASC
--   7) antigüedad de la cuenta                           ASC
--
-- El (2) va primero porque clavar el marcador arriesgando el comodín tiene más
-- mérito que clavarlo sin riesgo.
-- El (5) va ANTES que el (6) a propósito: sin eso, quien predijo menos partidos
-- acumularía menos error y se beneficiaría de no jugar. Al comparar solo entre
-- quienes jugaron la misma cantidad, el error total ya es justo.
-- El (7) es la red de seguridad: created_at es único, así que el orden SIEMPRE
-- queda estricto y nunca hay dos jugadores en la misma posición.
--
-- Solo cuentan los partidos 'finished': los suspendidos/pospuestos no suman ni
-- restan (ver void_cancelled_match).
-- Idempotente.
-- =============================================================================

-- Base común: agrega las métricas de una quiniela y asigna la posición.
-- No valida membresía (lo hace quien la llama).
CREATE OR REPLACE FUNCTION public.league_table(p_league_id uuid)
RETURNS TABLE (
  uid uuid, display_name text, avatar_url text, created_at timestamptz,
  points numeric, exactos_x2 int, exactos int, aciertos int, jugadas int, error_goles int, pos int
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
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
  SELECT uid, display_name, avatar_url, created_at, points, exactos_x2, exactos, aciertos, jugadas, error_goles,
         (row_number() OVER (ORDER BY points DESC, exactos_x2 DESC, exactos DESC, aciertos DESC,
                                      jugadas DESC, error_goles ASC, created_at ASC))::int
  FROM agg;
$$;

-- Posición de un jugador dentro de su quiniela, con la MISMA escalera que la Tabla.
CREATE OR REPLACE FUNCTION public.league_rank(p_league_id uuid, p_user_id uuid)
RETURNS int
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT pos FROM public.league_table(p_league_id) WHERE uid = p_user_id;
$$;

-- group_standings ahora devuelve también las métricas de desempate, para poder
-- mostrar en la app POR QUÉ alguien está arriba de otro con los mismos puntos.
-- Cambia la forma de la tabla devuelta, así que hay que DROP + CREATE.
DROP FUNCTION IF EXISTS public.group_standings(uuid);

CREATE FUNCTION public.group_standings(p_league_id uuid)
RETURNS TABLE (
  user_id uuid, display_name text, avatar_url text, points numeric, is_me boolean,
  exactos_x2 int, exactos int, aciertos int, jugadas int, error_goles int, pos int
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.league_members lm
                 WHERE lm.league_id = p_league_id AND lm.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'No sos miembro de este grupo';
  END IF;
  RETURN QUERY
    SELECT t.uid, t.display_name, t.avatar_url, t.points, (t.uid = auth.uid()),
           t.exactos_x2, t.exactos, t.aciertos, t.jugadas, t.error_goles, t.pos
    FROM public.league_table(p_league_id) t
    ORDER BY t.pos;
END; $$;

-- my_groups: el "#N" del Resumen pasa a usar league_rank, así deja de contradecir
-- a la Tabla. El resto de la función queda igual.
CREATE OR REPLACE FUNCTION public.my_groups()
RETURNS TABLE (
  id uuid, name text, description text, invitation_code text, admin_id uuid,
  tournament_id integer, tournament_name text, tournament_kind text, tournament_status text,
  members integer, my_points numeric, my_rank integer, rules text, is_admin boolean,
  rules_accepted boolean, points_exact integer, points_correct integer, champion_points integer,
  scorer_points integer, powerup_limit integer, assist_points integer, open_proposal boolean,
  my_pending_vote boolean, prizes_text text, whatsapp_link text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT l.id, l.name, l.description, l.invitation_code, l.admin_id, l.tournament_id,
         t.name, t.kind, t.status,
         (SELECT count(*)::int FROM public.league_members lm WHERE lm.league_id = l.id) AS members,
         public.league_points(l.id, auth.uid()) AS my_points,
         public.league_rank(l.id, auth.uid()) AS my_rank,
         l.rules, (l.admin_id = auth.uid()) AS is_admin,
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
         l.prizes_text, l.whatsapp_link
  FROM public.leagues l
  JOIN public.league_members m ON m.league_id = l.id AND m.user_id = auth.uid()
  JOIN public.tournaments t ON t.id = l.tournament_id
  ORDER BY (t.status = 'active') DESC, l.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.league_table(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.league_rank(uuid, uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.group_standings(uuid)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_groups()               TO authenticated;

NOTIFY pgrst, 'reload schema';
