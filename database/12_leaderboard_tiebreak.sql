-- =============================================================================
-- 12_leaderboard_tiebreak.sql
-- =============================================================================
-- Desempate del ranking. Hasta ahora el orden era SOLO por total_points, así que
-- dos jugadores con los mismos puntos quedaban en un orden arbitrario. Esta
-- migración agrega a user_badges_view las métricas de desempate y define el
-- orden oficial, para que NUNCA haya un empate visible:
--
--   1) total_points            (puntos)                                  DESC
--   2) exact_count             (marcadores exactos)                      DESC
--   3) correct_count           (resultados correctos, incluye exactos)   DESC
--   4) scorer_goals            (goles del goleador elegido)              DESC
--   5) champion_hit            (acertó al campeón)                       DESC
--   6) created_at              (fecha de registro: el más antiguo gana)  ASC
--
-- created_at es único por usuario, así que el orden queda SIEMPRE estricto.
--
-- Se usa DROP + CREATE (no CREATE OR REPLACE) porque agregamos columnas y un
-- ORDER BY; CREATE OR REPLACE no permite cambiar la forma de la vista.
-- =============================================================================

DROP VIEW IF EXISTS public.user_badges_view;

CREATE VIEW public.user_badges_view AS
SELECT
    u.id,
    u.id AS user_id,
    u.display_name,
    u.avatar_url,
    u.total_points,
    u.created_at,
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

    -- ── Logros sarcásticos ──

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
    (COUNT(p.id) FILTER (WHERE p.use_powerup_x2 = true) >= 5) AS is_ludopata,

    -- ── Métricas de desempate ──

    -- Marcadores exactos: goles predichos = goles reales (mismo criterio que
    -- Nostradamus, independiente del comodín).
    COUNT(p.id) FILTER (WHERE m.id IS NOT NULL
        AND p.prediction_type = 'Marcador'
        AND p.home_goals_pred = m.home_goals_actual
        AND p.away_goals_pred = m.away_goals_actual)::int AS exact_count,
    -- Resultados correctos: toda predicción que sumó puntos (acertó ganador o
    -- empate). Incluye los exactos.
    COUNT(p.id) FILTER (WHERE m.id IS NOT NULL AND p.points_earned > 0)::int AS correct_count,
    -- Goles del goleador elegido: cuenta los goles registrados en events_json
    -- (de todos los partidos) cuyo autor coincide con el goleador que el usuario
    -- eligió. Excluye autogoles; los penales sí cuentan. Comparación
    -- normalizada (sin distinguir mayúsculas ni espacios sobrantes).
    COALESCE((
        SELECT COUNT(*)
        FROM public.tournament_predictions tp
        CROSS JOIN public.matches mm
        CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(mm.events_json) = 'array'
                 THEN mm.events_json ELSE '[]'::jsonb END
        ) AS ev
        WHERE tp.user_id = u.id
          AND tp.top_scorer_name IS NOT NULL
          AND COALESCE(ev->>'type', 'goal') = 'goal'
          AND COALESCE((ev->>'own_goal')::boolean, false) = false
          AND lower(btrim(ev->>'player')) = lower(btrim(tp.top_scorer_name))
    ), 0)::int AS scorer_goals,
    -- ¿Acertó al campeón? (champion_points > 0)
    COALESCE((
        SELECT bool_or(tp.champion_points > 0)
        FROM public.tournament_predictions tp
        WHERE tp.user_id = u.id
    ), false) AS champion_hit

FROM public.users u
LEFT JOIN public.predictions p ON p.user_id = u.id
LEFT JOIN public.matches m ON p.match_id = m.id AND m.status = 'finished'
GROUP BY u.id, u.display_name, u.avatar_url, u.total_points, u.created_at
ORDER BY
    u.total_points DESC,
    exact_count    DESC,
    correct_count  DESC,
    scorer_goals   DESC,
    champion_hit   DESC,
    u.created_at   ASC;

-- Re-otorgar permisos de lectura (DROP elimina los grants anteriores)
GRANT SELECT ON public.user_badges_view TO anon, authenticated;

-- Refrescar la caché de PostgREST
NOTIFY pgrst, 'reload schema';
