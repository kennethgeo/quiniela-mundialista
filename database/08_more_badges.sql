-- =============================================================================
-- Migración: ajustar Francotirador + nuevos logros sarcásticos
-- Ejecutar en el SQL Editor de Supabase
--
-- Cambios:
--  - is_francotirador ahora exige points_earned >= 3 (acierto real con el x2,
--    no un punto parcial).
--  - Se agregan logros sarcásticos: optimista, aburrido, fantasma,
--    calientabancas, gallina (precavido) y ludópata.
--
-- Se usa DROP + CREATE (en vez de CREATE OR REPLACE) porque la vista incluye
-- columnas nuevas en medio del orden y CREATE OR REPLACE no permite reordenar
-- ni renombrar columnas existentes. Se mantienen tanto `id` como `user_id`
-- porque el frontend usa ambas (el ranking usa id; el perfil filtra por user_id).
-- =============================================================================

DROP VIEW IF EXISTS public.user_badges_view;

CREATE VIEW public.user_badges_view AS
SELECT
    u.id,
    u.id AS user_id,
    u.display_name,
    u.avatar_url,
    u.total_points,
    -- Nostradamus: 3+ MARCADORES EXACTOS reales (goles predichos = goles reales),
    -- comparando contra el resultado del partido (independiente del comodín)
    (COUNT(p.id) FILTER (WHERE m.id IS NOT NULL
        AND p.prediction_type = 'Marcador'
        AND p.home_goals_pred = m.home_goals_actual
        AND p.away_goals_pred = m.away_goals_actual) >= 3) AS is_nostradamus,
    (COUNT(p.id) FILTER (WHERE m.id IS NOT NULL AND p.home_goals_pred = p.away_goals_pred AND p.points_earned > 0) >= 3) AS is_rey_empate,
    -- Francotirador: acierto REAL con el comodín (>= 3 pts), no un punto parcial
    (COUNT(p.id) FILTER (WHERE m.id IS NOT NULL AND p.use_powerup_x2 = true AND p.points_earned >= 3) >= 1) AS is_francotirador,
    (COUNT(p.id) FILTER (WHERE m.id IS NOT NULL AND p.use_powerup_x2 = true AND p.points_earned = 0) >= 1) AS is_pecho_frio,
    (COUNT(p.id) FILTER (WHERE m.id IS NOT NULL AND p.points_earned = 0) >= 5) AS is_mas_conocedor,
    -- La Tortuga: hizo/editó una predicción "al límite" — en los 15 min previos
    -- al cierre (que es 15 min antes del kickoff), usando la última edición.
    -- Usar updated_at evita falsos positivos por datos migrados.
    (EXISTS (
        SELECT 1 FROM public.predictions p2
        JOIN public.matches m2 ON p2.match_id = m2.id
        WHERE p2.user_id = u.id
        AND m2.status = 'finished'
        AND (m2.kickoff_at - p2.updated_at) BETWEEN interval '15 minutes' AND interval '30 minutes'
    )) AS is_tortuga,
    (u.display_name ILIKE '%Taylor%') AS is_taylor,

    -- ── Nuevos logros sarcásticos ──

    -- El Optimista: predijo 5+ goles totales en 3+ partidos (todo es goleada)
    (COUNT(p.id) FILTER (WHERE m.id IS NOT NULL AND (p.home_goals_pred + p.away_goals_pred) >= 5) >= 3) AS is_optimista,
    -- El Aburrido: predijo 0-0 en 2+ partidos
    (COUNT(p.id) FILTER (WHERE m.id IS NOT NULL AND p.home_goals_pred = 0 AND p.away_goals_pred = 0) >= 2) AS is_aburrido,
    -- El Fantasma: no ha jugado ningún partido finalizado
    (COUNT(p.id) FILTER (WHERE m.id IS NOT NULL) = 0) AS is_fantasma,
    -- Calientabancas: 5+ partidos jugados y 0 puntos totales
    (u.total_points = 0 AND COUNT(p.id) FILTER (WHERE m.id IS NOT NULL) >= 5) AS is_calientabancas,
    -- El Precavido (gallina): 10+ predicciones y NUNCA usó el comodín
    (COUNT(p.id) FILTER (WHERE m.id IS NOT NULL AND p.use_powerup_x2 = true) = 0
        AND COUNT(p.id) FILTER (WHERE m.id IS NOT NULL) >= 10) AS is_gallina,
    -- Ludópata: usó el comodín x2 en 5+ predicciones
    (COUNT(p.id) FILTER (WHERE p.use_powerup_x2 = true) >= 5) AS is_ludopata

FROM public.users u
LEFT JOIN public.predictions p ON p.user_id = u.id
LEFT JOIN public.matches m ON p.match_id = m.id AND m.status = 'finished'
GROUP BY u.id, u.display_name, u.avatar_url, u.total_points;

-- Re-otorgar permisos de lectura (DROP elimina los grants anteriores)
GRANT SELECT ON public.user_badges_view TO anon, authenticated;

-- Refrescar la caché de PostgREST
NOTIFY pgrst, 'reload schema';
