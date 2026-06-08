-- =============================================================================
-- MIGRACIÓN 2: Gamificación, Stats Avanzadas, y Push Notifications
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. SISTEMA DE COMODINES (POWERUP LIMITS)
-- -----------------------------------------------------------------------------
CREATE TABLE public.powerup_limits (
    phase TEXT NOT NULL,
    matchday INTEGER,
    max_uses INTEGER NOT NULL,
    PRIMARY KEY (phase, matchday)
);
COMMENT ON TABLE public.powerup_limits IS 'Límites de uso del comodín x2 por fase y jornada';

-- Llenamos los límites que pediste
INSERT INTO public.powerup_limits (phase, matchday, max_uses) VALUES 
('groups', 1, 4),
('groups', 2, 4),
('groups', 3, 4),
('round_of_32', 0, 3),
('round_of_16', 0, 2),
('quarter_finals', 0, 1),
('semi_finals', 0, 1),
('third_place', 0, 1),
('final', 0, 1);

-- Función y Trigger para evitar que un usuario "hackee" el límite mandando requests directos
CREATE OR REPLACE FUNCTION check_powerup_limit() RETURNS trigger AS $$
DECLARE
    v_phase TEXT;
    v_matchday INTEGER;
    v_max_uses INTEGER;
    v_current_uses INTEGER;
BEGIN
    IF NEW.use_powerup_x2 = TRUE THEN
        SELECT phase, COALESCE(matchday, 0) INTO v_phase, v_matchday
        FROM public.matches WHERE id = NEW.match_id;

        SELECT max_uses INTO v_max_uses
        FROM public.powerup_limits 
        WHERE phase = v_phase AND matchday = v_matchday;

        SELECT COUNT(*) INTO v_current_uses
        FROM public.predictions p
        JOIN public.matches m ON p.match_id = m.id
        WHERE p.user_id = NEW.user_id 
        AND p.use_powerup_x2 = TRUE
        AND m.phase = v_phase 
        AND COALESCE(m.matchday, 0) = v_matchday
        AND p.id != NEW.id;

        IF v_current_uses >= v_max_uses THEN
            RAISE EXCEPTION 'Límite de comodines x2 alcanzado para esta fase/jornada.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_powerup_limit ON public.predictions;
CREATE TRIGGER enforce_powerup_limit
BEFORE INSERT OR UPDATE ON public.predictions
FOR EACH ROW EXECUTE FUNCTION check_powerup_limit();


-- -----------------------------------------------------------------------------
-- 2. SISTEMA DE MEDALLAS (VISTA)
-- -----------------------------------------------------------------------------
-- Se calcula en tiempo real para no tener que estar guardando y actualizando estado.
CREATE OR REPLACE VIEW public.user_badges_view AS
SELECT 
    u.id AS user_id,
    u.display_name,
    (COUNT(p.id) FILTER (WHERE p.points_earned >= 3) >= 3) AS is_nostradamus,
    (COUNT(p.id) FILTER (WHERE p.home_goals_pred = p.away_goals_pred AND p.points_earned > 0) >= 3) AS is_rey_empate,
    (COUNT(p.id) FILTER (WHERE p.use_powerup_x2 = true AND p.points_earned > 0) >= 1) AS is_francotirador,
    (COUNT(p.id) FILTER (WHERE p.use_powerup_x2 = true AND p.points_earned = 0) >= 1) AS is_pecho_frio,
    (COUNT(p.id) FILTER (WHERE p.points_earned = 0) >= 5) AS is_mas_conocedor, -- "El más conocedor" (sarcasmo)
    (EXISTS (
        SELECT 1 FROM public.predictions p2 
        JOIN public.matches m2 ON p2.match_id = m2.id
        WHERE p2.user_id = u.id 
        AND m2.kickoff_at - p2.created_at <= interval '45 minutes'
    )) AS is_tortuga,
    (u.display_name ILIKE '%Taylor%') AS is_taylor -- Solo para Taylor "0T 💩"
FROM public.users u
LEFT JOIN public.predictions p ON p.user_id = u.id
LEFT JOIN public.matches m ON p.match_id = m.id AND m.status = 'finished'
GROUP BY u.id, u.display_name;


-- -----------------------------------------------------------------------------
-- 3. SISTEMA DE ESTADÍSTICAS AVANZADAS (VISTA)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.user_stats_view AS
WITH user_points_per_team AS (
    SELECT p.user_id, m.home_team AS team, SUM(p.points_earned) AS points_earned
    FROM public.predictions p JOIN public.matches m ON p.match_id = m.id WHERE m.status = 'finished' GROUP BY p.user_id, m.home_team
    UNION ALL
    SELECT p.user_id, m.away_team AS team, SUM(p.points_earned) AS points_earned
    FROM public.predictions p JOIN public.matches m ON p.match_id = m.id WHERE m.status = 'finished' GROUP BY p.user_id, m.away_team
),
aggregated_team_points AS (
    SELECT user_id, team, SUM(points_earned) as total_team_points FROM user_points_per_team GROUP BY user_id, team
),
ranked_teams AS (
    SELECT user_id, team, total_team_points,
        RANK() OVER (PARTITION BY user_id ORDER BY total_team_points DESC) as rank_best,
        RANK() OVER (PARTITION BY user_id ORDER BY total_team_points ASC) as rank_worst
    FROM aggregated_team_points
),
overall_stats AS (
    SELECT user_id,
        COUNT(p.id) AS total_predictions,
        COUNT(p.id) FILTER (WHERE p.points_earned > 0) AS winning_predictions,
        COUNT(p.id) FILTER (WHERE p.points_earned >= 3) AS exact_scores,
        SUM(p.points_earned) AS total_points
    FROM public.predictions p
    JOIN public.matches m ON p.match_id = m.id
    WHERE m.status = 'finished'
    GROUP BY user_id
)
SELECT 
    o.user_id,
    o.total_predictions,
    o.winning_predictions,
    o.exact_scores,
    o.total_points,
    (SELECT team FROM ranked_teams WHERE user_id = o.user_id AND rank_best = 1 LIMIT 1) AS talisman_team,
    (SELECT team FROM ranked_teams WHERE user_id = o.user_id AND rank_worst = 1 LIMIT 1) AS maldito_team
FROM overall_stats o;


-- -----------------------------------------------------------------------------
-- 4. SUSCRIPCIONES PUSH NOTIFICATIONS
-- -----------------------------------------------------------------------------
CREATE TABLE public.push_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE public.push_subscriptions IS 'Registros de dispositivos para Push Notifications';

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "push_subs_select_own" ON public.push_subscriptions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "push_subs_insert_own" ON public.push_subscriptions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "push_subs_delete_own" ON public.push_subscriptions FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Para que la API la actualice inmediatamente
NOTIFY pgrst, 'reload schema';
