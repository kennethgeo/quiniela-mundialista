-- =============================================================================
-- 60_jornadas_y_rachas.sql  ·  Quién gana cada jornada, y las rachas que salen
-- =============================================================================
-- Hoy la quiniela solo sabe decir quién va ganando EN TOTAL. Pero el torneo se
-- vive por jornada: "esta la gané yo", "llevo tres seguidas", "vengo frío". Eso
-- hoy se discute de memoria en el chat, que es donde nacen los roces.
--
-- DECISIONES QUE IMPORTAN:
--
-- 1) Se usa LA MISMA escalera de desempate que la Tabla (migración 55), pero
--    acotada a la jornada: puntos → exactos con ×2 → exactos → aciertos →
--    jugadas → menor error de gol → antigüedad. Así el ganador de la jornada es
--    UNO, igual que en la tabla general, y por el mismo criterio que ya votaron.
--    Dos criterios distintos conviviendo es exactamente el problema que arregló
--    la 55; no se vuelve a abrir esa puerta.
--
-- 2) Para ganar hay que SUMAR: si nadie hizo puntos, la jornada queda sin
--    ganador. Coronar a alguien con 0 puntos — que puede ni haber predicho — no
--    es ganar nada.
--
-- 3) Solo cuentan las jornadas CERRADAS (todos sus partidos finalizados) para
--    rachas y para el conteo de ganadas. Una jornada a medias todavía se puede
--    dar vuelta; anotarla como ganada y desanotarla después sería peor que no
--    mostrarla.
--
-- 4) NO se guarda nada. Todo sale de predictions.points_earned, que es la única
--    fuente de verdad del puntaje. Un snapshot guardado se desactualizaría en
--    cuanto el admin corrige un marcador — justo el caso en que la transparencia
--    importa. El registro de las correcciones ya vive en audit_logs (mig. 57).
--
-- 5) Los partidos cancelados/pospuestos se excluyen (ver void_cancelled_match),
--    igual que en la Tabla y en el motor de medallas.
--
-- La jornada se identifica igual que en el motor de medallas y en el Histórico:
-- stage, si no 'J'||matchday, si no phase.
-- Idempotente.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.league_jornadas(p_league_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tid int;
  v_out jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.league_members lm
                 WHERE lm.league_id = p_league_id AND lm.user_id = v_uid) THEN
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

GRANT EXECUTE ON FUNCTION public.league_jornadas(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
