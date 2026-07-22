-- =============================================================================
-- 37_per_league_rules.sql  ·  Reglas y predicciones INDEPENDIENTES por quiniela
-- =============================================================================
-- Antes: las predicciones eran por (usuario, partido) → compartidas entre todas
-- las quinielas del mismo torneo, con puntaje/comodines globales.
-- Ahora: cada quiniela (league) tiene su propia config de puntaje y sus propias
-- predicciones (usuario, league, partido). Idempotente.
--
--   leagues:               points_exact, points_correct, champion_points,
--                          scorer_points, powerup_limit (máx ×2 por jornada/fase)
--   predictions:           + league_id  (UNIQUE user_id, league_id, match_id)
--   tournament_predictions:+ league_id  (campeón/goleador por quiniela)
--   set_group_scoring():   el admin de la quiniela edita su config
--   my_groups():           devuelve la config
--   group_standings():     ya suma solo las predicciones de esa quiniela
-- =============================================================================

-- 1) Config de puntaje por quiniela ------------------------------------------
ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS points_exact    int DEFAULT 3;
ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS points_correct  int DEFAULT 1;
ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS champion_points int DEFAULT 12;
ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS scorer_points   int DEFAULT 12;
-- Máximo de comodines ×2 por jornada/fase (0 = deshabilitado).
ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS powerup_limit   int DEFAULT 2;

-- 2) predictions.league_id ---------------------------------------------------
ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS league_id uuid REFERENCES public.leagues(id) ON DELETE CASCADE;

-- Quitar el trigger de límite de comodines (era global) para que no bloquee el
-- backfill; más abajo se recrea por-liga.
DROP TRIGGER IF EXISTS enforce_powerup_limit ON public.predictions;

-- Backfill: cada predicción existente se copia a cada quiniela del usuario que
-- juega el torneo de ese partido.
INSERT INTO public.predictions
  (user_id, league_id, match_id, prediction_type, home_goals_pred, away_goals_pred,
   penalties_winner_pred, use_powerup_x2, points_earned, created_at, updated_at)
SELECT p.user_id, lm.league_id, p.match_id, p.prediction_type, p.home_goals_pred,
       p.away_goals_pred, p.penalties_winner_pred, p.use_powerup_x2, p.points_earned,
       p.created_at, p.updated_at
FROM public.predictions p
JOIN public.matches m       ON m.id = p.match_id
JOIN public.league_members lm ON lm.user_id = p.user_id
JOIN public.leagues l       ON l.id = lm.league_id AND l.tournament_id = m.tournament_id
WHERE p.league_id IS NULL
ON CONFLICT DO NOTHING;

-- Quitar las filas viejas sin quiniela (ya copiadas arriba).
DELETE FROM public.predictions WHERE league_id IS NULL;

-- Cambiar la unicidad: (usuario, quiniela, partido)
ALTER TABLE public.predictions ALTER COLUMN league_id SET NOT NULL;
DO $$ BEGIN
  ALTER TABLE public.predictions DROP CONSTRAINT IF EXISTS predictions_user_id_match_id_key;
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.predictions ADD CONSTRAINT predictions_user_league_match_key
    UNIQUE (user_id, league_id, match_id);
EXCEPTION WHEN duplicate_table THEN NULL; WHEN others THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_predictions_league ON public.predictions(league_id);

-- Límite de comodines ×2 POR QUINIELA (usa leagues.powerup_limit y cuenta solo
-- las predicciones de esa quiniela). Reemplaza al trigger global anterior.
CREATE OR REPLACE FUNCTION public.check_powerup_limit() RETURNS trigger AS $$
DECLARE v_phase text; v_matchday integer; v_limit integer; v_current integer;
BEGIN
  IF NEW.use_powerup_x2 = TRUE AND NEW.league_id IS NOT NULL THEN
    SELECT phase, COALESCE(matchday, 0) INTO v_phase, v_matchday
    FROM public.matches WHERE id = NEW.match_id;

    SELECT powerup_limit INTO v_limit FROM public.leagues WHERE id = NEW.league_id;

    SELECT COUNT(*) INTO v_current
    FROM public.predictions p
    JOIN public.matches m ON p.match_id = m.id
    WHERE p.user_id = NEW.user_id
      AND p.league_id = NEW.league_id
      AND p.use_powerup_x2 = TRUE
      AND m.phase = v_phase
      AND COALESCE(m.matchday, 0) = v_matchday
      AND p.id <> NEW.id;

    IF v_limit IS NOT NULL AND v_current >= v_limit THEN
      RAISE EXCEPTION 'Límite de comodines x2 alcanzado para esta jornada.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_powerup_limit ON public.predictions;
CREATE TRIGGER enforce_powerup_limit
  BEFORE INSERT OR UPDATE ON public.predictions
  FOR EACH ROW EXECUTE FUNCTION public.check_powerup_limit();

-- 3) tournament_predictions.league_id (campeón/goleador por quiniela) ---------
ALTER TABLE public.tournament_predictions
  ADD COLUMN IF NOT EXISTS league_id uuid REFERENCES public.leagues(id) ON DELETE CASCADE;

INSERT INTO public.tournament_predictions
  (user_id, league_id, tournament_id, champion_team, top_scorer_name,
   champion_points, top_scorer_points)
SELECT tp.user_id, lm.league_id, tp.tournament_id, tp.champion_team, tp.top_scorer_name,
       tp.champion_points, tp.top_scorer_points
FROM public.tournament_predictions tp
JOIN public.league_members lm ON lm.user_id = tp.user_id
JOIN public.leagues l ON l.id = lm.league_id AND l.tournament_id = tp.tournament_id
WHERE tp.league_id IS NULL
ON CONFLICT DO NOTHING;

DELETE FROM public.tournament_predictions WHERE league_id IS NULL;

DO $$ BEGIN
  ALTER TABLE public.tournament_predictions DROP CONSTRAINT IF EXISTS tournament_predictions_user_id_tournament_id_key;
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.tournament_predictions ADD CONSTRAINT tournament_predictions_user_league_key
    UNIQUE (user_id, league_id);
EXCEPTION WHEN others THEN NULL; END $$;

-- 4) set_group_scoring: el admin de la quiniela edita su config --------------
CREATE OR REPLACE FUNCTION public.set_group_scoring(
  p_league_id uuid, p_points_exact int, p_points_correct int,
  p_champion_points int, p_scorer_points int, p_powerup_limit int)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leagues WHERE id = p_league_id AND admin_id = v_uid) THEN
    RAISE EXCEPTION 'Solo el administrador puede editar las reglas';
  END IF;
  UPDATE public.leagues SET
    points_exact    = GREATEST(0, COALESCE(p_points_exact, points_exact)),
    points_correct  = GREATEST(0, COALESCE(p_points_correct, points_correct)),
    champion_points = GREATEST(0, COALESCE(p_champion_points, champion_points)),
    scorer_points   = GREATEST(0, COALESCE(p_scorer_points, scorer_points)),
    powerup_limit   = GREATEST(0, COALESCE(p_powerup_limit, powerup_limit))
  WHERE id = p_league_id;
END; $$;

-- 5) league_points: puntos de un usuario EN una quiniela (helper) ------------
CREATE OR REPLACE FUNCTION public.league_points(p_league_id uuid, p_user_id uuid)
RETURNS numeric
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT SUM(COALESCE(pr.points_earned,0)) FROM public.predictions pr
                   WHERE pr.user_id = p_user_id AND pr.league_id = p_league_id), 0)
       + COALESCE((SELECT SUM(COALESCE(tp.champion_points,0)+COALESCE(tp.top_scorer_points,0))
                   FROM public.tournament_predictions tp
                   WHERE tp.user_id = p_user_id AND tp.league_id = p_league_id), 0);
$$;

-- 6) my_groups: devolver la config de puntaje --------------------------------
DROP FUNCTION IF EXISTS public.my_groups();
CREATE OR REPLACE FUNCTION public.my_groups()
RETURNS TABLE (
  id uuid, name text, description text, invitation_code text, admin_id uuid,
  tournament_id int, tournament_name text, tournament_kind text, tournament_status text,
  members int, my_points numeric, my_rank int,
  rules text, is_admin boolean, rules_accepted boolean,
  points_exact int, points_correct int, champion_points int, scorer_points int, powerup_limit int
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT l.id, l.name, l.description, l.invitation_code, l.admin_id,
    l.tournament_id, t.name, t.kind, t.status,
    (SELECT count(*)::int FROM public.league_members lm WHERE lm.league_id = l.id) AS members,
    public.league_points(l.id, auth.uid()) AS my_points,
    (SELECT count(*)::int + 1 FROM public.league_members lm2
       WHERE lm2.league_id = l.id
         AND public.league_points(l.id, lm2.user_id) > public.league_points(l.id, auth.uid())) AS my_rank,
    l.rules,
    (l.admin_id = auth.uid()) AS is_admin,
    (m.rules_accepted_at IS NOT NULL) AS rules_accepted,
    l.points_exact, l.points_correct, l.champion_points, l.scorer_points, l.powerup_limit
  FROM public.leagues l
  JOIN public.league_members m ON m.league_id = l.id AND m.user_id = auth.uid()
  JOIN public.tournaments t ON t.id = l.tournament_id
  ORDER BY (t.status = 'active') DESC, l.created_at DESC;
$$;

-- 7) group_standings: tabla de la quiniela con SUS puntos --------------------
CREATE OR REPLACE FUNCTION public.group_standings(p_league_id uuid)
RETURNS TABLE (user_id uuid, display_name text, avatar_url text, points numeric, is_me boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.league_members lm
                 WHERE lm.league_id = p_league_id AND lm.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'No sos miembro de este grupo';
  END IF;
  RETURN QUERY
    SELECT u.id, u.display_name, u.avatar_url,
           public.league_points(p_league_id, u.id)::numeric,
           (u.id = auth.uid())
    FROM public.league_members lm
    JOIN public.users u ON u.id = lm.user_id
    WHERE lm.league_id = p_league_id
    ORDER BY public.league_points(p_league_id, u.id) DESC, u.created_at ASC;
END; $$;

GRANT EXECUTE ON FUNCTION public.set_group_scoring(uuid,int,int,int,int,int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.league_points(uuid,uuid)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_groups()                                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.group_standings(uuid)                       TO authenticated;

NOTIFY pgrst, 'reload schema';
