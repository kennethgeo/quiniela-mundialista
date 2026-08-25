-- =============================================================================
-- 63_hub_global_y_perfiles.sql  ·  Ranking global en el hub y perfil por quiniela
-- =============================================================================
-- Dos cosas que faltaban y que la app hoy mezcla:
--
-- 1) El número global (users.total_points) se ve suelto en el menú lateral sin
--    contexto: no hay dónde ver contra quién. Las pantallas que lo mostraban
--    (Dashboard, Leaderboard) quedaron sin ruta hace tiempo y redirigen al hub.
--    Ahora el hub —"Mis quinielas"— es el lugar natural para lo global.
--
-- 2) El perfil es uno solo y mezcla todo: junta las predicciones de TODAS las
--    quinielas en un mismo montón. Pero el jugador piensa por quiniela ("en la
--    Bundestica voy 3º"), así que hace falta también un perfil POR quiniela.
--
-- Nada de esto toca cómo se puntúa. Todo sale de las mismas fuentes que ya
-- existen: league_table para lo de cada quiniela, user_total_calculado para lo
-- global, y league_jornadas para las rachas — sin reimplementar ni un criterio.
-- Idempotente.
-- =============================================================================

-- ── Ranking global ───────────────────────────────────────────────────────────
-- Devuelve el top N y, aparte, TU fila aunque estés fuera del top. Se limita a
-- propósito: con la app abierta al público, volcar la tabla de usuarios entera
-- al navegador en cada carga no escala y además regala el padrón completo.
CREATE OR REPLACE FUNCTION public.ranking_global(p_limite integer DEFAULT 20)
RETURNS TABLE (
  pos integer, user_id uuid, display_name text, avatar_url text,
  puntos integer, quinielas integer, soy_yo boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  RETURN QUERY
  WITH base AS (
    SELECT u.id, u.display_name, u.avatar_url,
           COALESCE(u.total_points, 0) AS puntos,
           (SELECT count(*)::int FROM public.league_members lm WHERE lm.user_id = u.id) AS quinielas,
           u.created_at
    FROM public.users u
  ),
  ordenado AS (
    -- created_at como último criterio: es único, así que el orden nunca queda
    -- ambiguo y nadie comparte posición (misma idea que la migración 55).
    SELECT b.*, (row_number() OVER (ORDER BY b.puntos DESC, b.created_at ASC))::int AS p
    FROM base b
  )
  SELECT o.p, o.id, o.display_name, o.avatar_url, o.puntos, o.quinielas, (o.id = v_uid)
  FROM ordenado o
  -- Tope duro de 100. Con solo GREATEST, cualquiera podía pedir p_limite =
  -- 2147483647 y llevarse el padrón entero, que es justo lo que este límite
  -- viene a evitar.
  WHERE o.p <= LEAST(GREATEST(COALESCE(p_limite, 20), 1), 100) OR o.id = v_uid
  ORDER BY o.p;
END; $$;

-- ── Mi resumen global (la tarjeta del hub) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.mi_resumen_global()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT jsonb_build_object(
    'puntos',      COALESCE(u.total_points, 0),
    'posicion',    (SELECT count(*) + 1 FROM public.users x
                    WHERE COALESCE(x.total_points,0) > COALESCE(u.total_points,0)
                       OR (COALESCE(x.total_points,0) = COALESCE(u.total_points,0)
                           AND x.created_at < u.created_at)),
    'jugadores',   (SELECT count(*) FROM public.users),
    'quinielas',   (SELECT count(*) FROM public.league_members lm WHERE lm.user_id = v_uid),
    -- Los partidos se cuentan DISTINTOS: predecir el mismo partido en tres
    -- quinielas es un partido, no tres. Misma regla que el total global.
    'partidos',    (SELECT count(DISTINCT p.match_id) FROM public.predictions p
                    JOIN public.matches m ON m.id = p.match_id
                    WHERE p.user_id = v_uid AND m.status = 'finished'),
    'exactos',     (SELECT count(DISTINCT p.match_id) FROM public.predictions p
                    JOIN public.matches m ON m.id = p.match_id
                    WHERE p.user_id = v_uid AND m.status = 'finished'
                      AND p.home_goals_pred = m.home_goals_actual
                      AND p.away_goals_pred = m.away_goals_actual),
    'aciertos',    (SELECT count(DISTINCT p.match_id) FROM public.predictions p
                    JOIN public.matches m ON m.id = p.match_id
                    WHERE p.user_id = v_uid AND m.status = 'finished'
                      AND COALESCE(p.points_earned,0) > 0),
    'medallas',    (SELECT count(DISTINCT ub.badge_key) FROM public.user_badges ub
                    WHERE ub.user_id = v_uid)
  ) INTO v_out
  FROM public.users u WHERE u.id = v_uid;

  RETURN COALESCE(v_out, '{}'::jsonb);
END; $$;

-- ── Perfil de una persona DENTRO de una quiniela ─────────────────────────────
-- Reusa league_table (el desempate oficial) y league_jornadas (las rachas). No
-- se reimplementa ningún criterio: eso es justo lo que la migración 55 vino a
-- arreglar y no se vuelve a abrir.
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
  IF NOT EXISTS (SELECT 1 FROM public.league_members lm
                 WHERE lm.league_id = p_league_id AND lm.user_id = v_uid) THEN
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

-- Permisos siguiendo la regla de la migración 61: revocar primero (PostgreSQL
-- regala EXECUTE a PUBLIC al crear la función) y otorgar solo a authenticated.
REVOKE ALL ON FUNCTION public.ranking_global(integer)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mi_resumen_global()              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.perfil_en_quiniela(uuid, uuid)   FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ranking_global(integer)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.mi_resumen_global()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.perfil_en_quiniela(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
