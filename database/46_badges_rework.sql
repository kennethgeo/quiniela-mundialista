-- =============================================================================
-- 46_badges_rework.sql  ·  Rework de medallas (por quiniela) — Etapa 1
-- =============================================================================
-- Reemplaza la vieja VIEW global user_badges_view por un sistema POR QUINIELA:
--   · user_badges: medallas ganadas (user, league, badge_key, tier, earned_at)
--   · recompute_league_badges(league): motor idempotente (upsert + limpieza)
--   · my_medals() / league_medals(league): lectura para perfil y vitrina
-- El catálogo (nombres/íconos/umbrales) vive en frontend/src/lib/badges.js;
-- las CONDICIONES viven acá. Mantener sincronizados.
-- Idempotente. Al final hace backfill de todas las quinielas.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_badges (
  user_id   uuid NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,
  league_id uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  badge_key text NOT NULL,
  tier      int  NOT NULL DEFAULT 1,   -- 1 bronce · 2 plata · 3 oro (1 = sin nivel)
  meta      jsonb,
  earned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, league_id, badge_key)
);
CREATE INDEX IF NOT EXISTS idx_user_badges_league ON public.user_badges(league_id);
CREATE INDEX IF NOT EXISTS idx_user_badges_user   ON public.user_badges(user_id);

ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_badges_select_members" ON public.user_badges;
CREATE POLICY "user_badges_select_members" ON public.user_badges
  FOR SELECT TO authenticated USING (public.is_league_member(league_id));
GRANT SELECT ON public.user_badges TO authenticated;

-- -----------------------------------------------------------------------------
-- Motor: recalcula TODAS las medallas de una quiniela (idempotente).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_league_badges(p_league_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tid int;
  v_has_finished boolean;
BEGIN
  SELECT tournament_id INTO v_tid FROM public.leagues WHERE id = p_league_id;
  IF v_tid IS NULL THEN RETURN; END IF;
  SELECT EXISTS(SELECT 1 FROM public.matches WHERE tournament_id = v_tid AND status = 'finished')
    INTO v_has_finished;

  DROP TABLE IF EXISTS _earned;
  CREATE TEMP TABLE _earned AS
  WITH
  mem AS (SELECT user_id FROM public.league_members WHERE league_id = p_league_id),
  mj AS (
    SELECT m.id, m.status, m.kickoff_at, m.home_goals_actual, m.away_goals_actual,
      COALESCE(m.stage, CASE WHEN m.matchday IS NOT NULL THEN 'J'||m.matchday END, m.phase) AS jkey
    FROM public.matches m
    WHERE m.tournament_id = v_tid AND m.status NOT IN ('cancelled','postponed')
  ),
  fin AS (
    SELECT p.user_id, p.home_goals_pred hp, p.away_goals_pred ap, p.use_powerup_x2 x2,
           COALESCE(p.points_earned,0) pts, mj.home_goals_actual ha, mj.away_goals_actual aa,
           mj.jkey, mj.kickoff_at
    FROM public.predictions p
    JOIN mj ON mj.id = p.match_id AND mj.status = 'finished'
    WHERE p.league_id = p_league_id
  )
  SELECT user_id, badge_key, tier, meta FROM (
    -- 🎯 Francotirador (marcadores exactos)
    SELECT user_id, 'francotirador' badge_key,
      CASE WHEN c>=25 THEN 3 WHEN c>=10 THEN 2 ELSE 1 END tier, jsonb_build_object('count',c) meta
    FROM (SELECT user_id, count(*) c FROM fin WHERE hp=ha AND ap=aa GROUP BY user_id) x WHERE c>=3
    UNION ALL
    -- 🤝 Rey del empate (empate exacto acertado)
    SELECT user_id, 'rey_empate',
      CASE WHEN c>=15 THEN 3 WHEN c>=8 THEN 2 ELSE 1 END, jsonb_build_object('count',c)
    FROM (SELECT user_id, count(*) c FROM fin WHERE hp=ap AND hp=ha AND ap=aa GROUP BY user_id) x WHERE c>=3
    UNION ALL
    -- ⚡ Estratega (aciertos con comodín ×2)
    SELECT user_id, 'estratega',
      CASE WHEN c>=12 THEN 3 WHEN c>=5 THEN 2 ELSE 1 END, jsonb_build_object('count',c)
    FROM (SELECT user_id, count(*) c FROM fin WHERE x2 AND pts>0 GROUP BY user_id) x WHERE c>=1
    UNION ALL
    -- 🥶 Pecho frío (usó ×2 y falló)
    SELECT user_id, 'pecho_frio', 1, jsonb_build_object('count',c)
    FROM (SELECT user_id, count(*) c FROM fin WHERE x2 AND pts=0 GROUP BY user_id) x WHERE c>=1
    UNION ALL
    -- 🐔 Gallina (10+ predicciones, nunca usó ×2)
    SELECT user_id, 'gallina', 1, jsonb_build_object('count',tot)
    FROM (SELECT user_id, count(*) tot, count(*) FILTER (WHERE x2) x2c FROM fin GROUP BY user_id) x
    WHERE tot>=10 AND x2c=0
    UNION ALL
    -- 🔮 Vidente (globales acertadas: campeón/goleador/asistidor)
    SELECT user_id, 'vidente',
      CASE WHEN a>=3 THEN 3 WHEN a>=2 THEN 2 ELSE 1 END, jsonb_build_object('count',a)
    FROM (
      SELECT user_id,
        (CASE WHEN COALESCE(champion_points,0)>0 THEN 1 ELSE 0 END
        +CASE WHEN COALESCE(top_scorer_points,0)>0 THEN 1 ELSE 0 END
        +CASE WHEN COALESCE(top_assist_points,0)>0 THEN 1 ELSE 0 END) a
      FROM public.tournament_predictions WHERE league_id = p_league_id
    ) x WHERE a>=1
    UNION ALL
    -- 💯 Jornada perfecta (acertó todos los partidos de una jornada completa)
    SELECT user_id, 'jornada_perfecta',
      CASE WHEN c>=5 THEN 3 WHEN c>=3 THEN 2 ELSE 1 END, jsonb_build_object('count',c)
    FROM (
      WITH jt AS (
        SELECT jkey, count(*) total, count(*) FILTER (WHERE status='finished') finc FROM mj GROUP BY jkey
      ),
      up AS (
        SELECT f.user_id, f.jkey, count(*) pred, count(*) FILTER (WHERE f.pts>0) hits
        FROM fin f GROUP BY f.user_id, f.jkey
      )
      SELECT up.user_id, count(*) c
      FROM up JOIN jt ON jt.jkey = up.jkey
      WHERE jt.total = jt.finc AND up.pred = jt.total AND up.hits = jt.total
      GROUP BY up.user_id
    ) x WHERE c>=1
    UNION ALL
    -- 🔥 En racha (aciertos consecutivos, ordenados por fecha)
    SELECT user_id, 'en_racha',
      CASE WHEN b>=10 THEN 3 WHEN b>=6 THEN 2 ELSE 1 END, jsonb_build_object('count',b)
    FROM (
      WITH seq AS (
        SELECT user_id, kickoff_at, (pts>0) hit,
          row_number() OVER (PARTITION BY user_id ORDER BY kickoff_at)
          - row_number() OVER (PARTITION BY user_id, (pts>0) ORDER BY kickoff_at) grp
        FROM fin
      ),
      runs AS (SELECT user_id, count(*) rl FROM seq WHERE hit GROUP BY user_id, grp)
      SELECT user_id, max(rl) b FROM runs GROUP BY user_id
    ) x WHERE b>=3
    UNION ALL
    -- 👋 Debut (hizo al menos una predicción)
    SELECT DISTINCT user_id, 'debut', 1, NULL::jsonb
    FROM public.predictions WHERE league_id = p_league_id
    UNION ALL
    -- 🚩 Fundador (creó la quiniela)
    SELECT admin_id, 'fundador', 1, NULL::jsonb FROM public.leagues WHERE id = p_league_id
    UNION ALL
    -- ✅ Reglamentario (aceptó las reglas)
    SELECT user_id, 'reglamentario', 1, NULL::jsonb
    FROM public.league_members WHERE league_id = p_league_id AND rules_accepted_at IS NOT NULL
    UNION ALL
    -- 🗳️ Votante (votó una propuesta de cambio)
    SELECT DISTINCT rv.user_id, 'votante', 1, NULL::jsonb
    FROM public.rule_votes rv JOIN public.rule_proposals rp ON rp.id = rv.proposal_id
    WHERE rp.league_id = p_league_id
    UNION ALL
    -- 💩 Taylor (broma interna del grupo)
    SELECT lm.user_id, 'taylor', 3, NULL::jsonb
    FROM public.league_members lm JOIN public.users u ON u.id = lm.user_id
    WHERE lm.league_id = p_league_id AND u.display_name ILIKE '%Taylor%'
    UNION ALL
    -- 👻 Fantasma (miembro sin ninguna predicción; solo si el torneo ya tuvo partidos)
    SELECT m.user_id, 'fantasma', 1, NULL::jsonb
    FROM mem m
    WHERE v_has_finished
      AND NOT EXISTS (SELECT 1 FROM public.predictions p
                      WHERE p.league_id = p_league_id AND p.user_id = m.user_id)
  ) all_badges;

  -- Upsert conservando earned_at, y limpieza de las que ya no aplican.
  INSERT INTO public.user_badges (user_id, league_id, badge_key, tier, meta)
  SELECT user_id, p_league_id, badge_key, tier, meta FROM _earned
  ON CONFLICT (user_id, league_id, badge_key)
    DO UPDATE SET tier = EXCLUDED.tier, meta = EXCLUDED.meta;

  DELETE FROM public.user_badges ub
  WHERE ub.league_id = p_league_id
    AND NOT EXISTS (SELECT 1 FROM _earned e WHERE e.user_id = ub.user_id AND e.badge_key = ub.badge_key);

  DROP TABLE IF EXISTS _earned;
END; $$;
GRANT EXECUTE ON FUNCTION public.recompute_league_badges(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- Lectura
-- -----------------------------------------------------------------------------
-- Todas mis medallas (perfil global, todas las quinielas).
CREATE OR REPLACE FUNCTION public.my_medals()
RETURNS TABLE (league_id uuid, league_name text, badge_key text, tier int, meta jsonb, earned_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT ub.league_id, l.name, ub.badge_key, ub.tier, ub.meta, ub.earned_at
  FROM public.user_badges ub
  JOIN public.leagues l ON l.id = ub.league_id
  WHERE ub.user_id = auth.uid()
  ORDER BY ub.tier DESC, ub.earned_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.my_medals() TO authenticated;

-- Medallas de una quiniela (vitrina + chips en la tabla).
CREATE OR REPLACE FUNCTION public.league_medals(p_league_id uuid)
RETURNS TABLE (user_id uuid, display_name text, avatar_url text, badge_key text, tier int, meta jsonb, earned_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.league_members WHERE league_id = p_league_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'No sos miembro de esta quiniela';
  END IF;
  RETURN QUERY
    SELECT ub.user_id, u.display_name, u.avatar_url, ub.badge_key, ub.tier, ub.meta, ub.earned_at
    FROM public.user_badges ub
    JOIN public.users u ON u.id = ub.user_id
    WHERE ub.league_id = p_league_id
    ORDER BY ub.tier DESC, ub.earned_at;
END; $$;
GRANT EXECUTE ON FUNCTION public.league_medals(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- Backfill inicial: calcular las medallas de todas las quinielas existentes.
-- -----------------------------------------------------------------------------
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT id FROM public.leagues LOOP
    PERFORM public.recompute_league_badges(r.id);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
