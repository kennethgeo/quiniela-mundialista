-- =============================================================================
-- FIX 3: Eliminar Trigger Viejo de Powerups
-- =============================================================================

-- El trigger antiguo 'enforce_single_powerup_per_matchday' bloqueaba el uso a solo 1 comodín.
-- Lo eliminamos para que funcione el nuevo trigger 'enforce_powerup_limit'.
DROP TRIGGER IF EXISTS enforce_single_powerup_per_matchday ON public.predictions;
DROP FUNCTION IF EXISTS public.check_single_powerup_per_matchday();

-- =============================================================================
-- FIX MEDALLAS Y ESTADÍSTICAS
-- =============================================================================
-- Recrear la vista de medallas asegurando la condición de Taylor y demás.
CREATE OR REPLACE VIEW public.user_badges_view AS
SELECT 
    u.id,
    u.display_name,
    u.avatar_url,
    u.total_points,
    (COUNT(p.id) FILTER (WHERE p.points_earned >= 3) >= 3) AS is_nostradamus,
    (COUNT(p.id) FILTER (WHERE p.home_goals_pred = p.away_goals_pred AND p.points_earned > 0) >= 3) AS is_rey_empate,
    (COUNT(p.id) FILTER (WHERE p.use_powerup_x2 = true AND p.points_earned > 0) >= 1) AS is_francotirador,
    (COUNT(p.id) FILTER (WHERE p.use_powerup_x2 = true AND p.points_earned = 0) >= 1) AS is_pecho_frio,
    (COUNT(p.id) FILTER (WHERE p.points_earned = 0) >= 5) AS is_mas_conocedor,
    (EXISTS (
        SELECT 1 FROM public.predictions p2 
        JOIN public.matches m2 ON p2.match_id = m2.id
        WHERE p2.user_id = u.id 
        AND m2.kickoff_at - p2.created_at <= interval '45 minutes'
    )) AS is_tortuga,
    (u.display_name ILIKE '%Taylor%') AS is_taylor
FROM public.users u
LEFT JOIN public.predictions p ON p.user_id = u.id
LEFT JOIN public.matches m ON p.match_id = m.id AND m.status = 'finished'
GROUP BY u.id, u.display_name;

-- Refrescar la caché de PostgREST
NOTIFY pgrst, 'reload schema';
