-- =============================================================================
-- 20_fix_scorer_name_match.sql
-- =============================================================================
-- "Goles del goleador" marcaba 0 para casi todos porque el nombre del goleador
-- se escribe a mano y se comparaba EXACTO contra el nombre del autor del gol en
-- events_json (de ESPN). Fallaba por:
--   · acentos      -> "Kylian Mbappe"  vs  "Kylian Mbappé"
--   · nombre parcial -> "Mbappé"        vs  "Kylian Mbappé"
--   · nombre completo -> "Lionel Andres Messi Cuccitini" vs "Lionel Messi"
--
-- Se hace la comparación tolerante (idéntica al motor de puntaje conceptual):
--   1) igualdad sin acentos, o
--   2) el nombre del autor CONTIENE lo que el usuario escribió (parcial), o
--   3) el APELLIDO del autor (última palabra) aparece como palabra dentro de lo
--      que el usuario escribió (cubre nombres completos tipo Messi).
-- Todo sin acentos ni mayúsculas. No genera falsos positivos con los picks
-- actuales (verificado: Olise sigue en 0 porque no ha anotado).
--
-- Se mantiene idéntico el resto de la vista (badges, exact/correct, champion).
-- Se quita el ORDER BY interno (los consumidores ya ordenan por su cuenta y así
-- no hay que duplicar la lógica de match).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE VIEW public.user_badges_view AS
SELECT u.id,
    u.id AS user_id,
    u.display_name,
    u.avatar_url,
    u.total_points,
    u.created_at,
    count(p.id) FILTER (WHERE m.id IS NOT NULL AND p.prediction_type = 'Marcador'::prediction_type_enum AND p.home_goals_pred = m.home_goals_actual AND p.away_goals_pred = m.away_goals_actual) >= 3 AS is_nostradamus,
    count(p.id) FILTER (WHERE m.id IS NOT NULL AND p.home_goals_pred = p.away_goals_pred AND p.points_earned > 0) >= 3 AS is_rey_empate,
    count(p.id) FILTER (WHERE m.id IS NOT NULL AND p.use_powerup_x2 = true AND p.points_earned >= 3) >= 1 AS is_francotirador,
    count(p.id) FILTER (WHERE m.id IS NOT NULL AND p.use_powerup_x2 = true AND p.points_earned = 0) >= 1 AS is_pecho_frio,
    count(p.id) FILTER (WHERE m.id IS NOT NULL AND p.points_earned = 0) >= 5 AS is_mas_conocedor,
    (EXISTS ( SELECT 1
           FROM predictions p2
             JOIN matches m2 ON p2.match_id = m2.id
          WHERE p2.user_id = u.id AND m2.status = 'finished'::text AND (m2.kickoff_at - p2.updated_at) >= '00:15:00'::interval AND (m2.kickoff_at - p2.updated_at) <= '00:30:00'::interval)) AS is_tortuga,
    u.display_name ~~* '%Taylor%'::text AS is_taylor,
    count(p.id) FILTER (WHERE m.id IS NOT NULL AND (p.home_goals_pred + p.away_goals_pred) >= 5) >= 3 AS is_optimista,
    count(p.id) FILTER (WHERE m.id IS NOT NULL AND p.home_goals_pred = 0 AND p.away_goals_pred = 0) >= 2 AS is_aburrido,
    count(p.id) FILTER (WHERE m.id IS NOT NULL) = 0 AS is_fantasma,
    u.total_points = 0 AND count(p.id) FILTER (WHERE m.id IS NOT NULL) >= 5 AS is_calientabancas,
    count(p.id) FILTER (WHERE m.id IS NOT NULL AND p.use_powerup_x2 = true) = 0 AND count(p.id) FILTER (WHERE m.id IS NOT NULL) >= 10 AS is_gallina,
    count(p.id) FILTER (WHERE p.use_powerup_x2 = true) >= 5 AS is_ludopata,
    count(p.id) FILTER (WHERE m.id IS NOT NULL AND p.prediction_type = 'Marcador'::prediction_type_enum AND p.home_goals_pred = m.home_goals_actual AND p.away_goals_pred = m.away_goals_actual)::integer AS exact_count,
    count(p.id) FILTER (WHERE m.id IS NOT NULL AND p.points_earned > 0)::integer AS correct_count,
    COALESCE(( SELECT count(*) AS count
           FROM tournament_predictions tp
             CROSS JOIN matches mm
             CROSS JOIN LATERAL jsonb_array_elements(
                CASE WHEN jsonb_typeof(mm.events_json) = 'array'::text THEN mm.events_json ELSE '[]'::jsonb END) ev(value)
          WHERE tp.user_id = u.id
            AND tp.top_scorer_name IS NOT NULL
            AND COALESCE(ev.value ->> 'type'::text, 'goal'::text) = 'goal'::text
            AND COALESCE((ev.value ->> 'own_goal'::text)::boolean, false) = false
            AND (
                 unaccent(lower(btrim(ev.value ->> 'player'::text))) = unaccent(lower(btrim(tp.top_scorer_name)))
              OR unaccent(lower(ev.value ->> 'player'::text)) LIKE ('%' || unaccent(lower(btrim(tp.top_scorer_name))) || '%')
              OR unaccent(lower(btrim(tp.top_scorer_name))) ~ ('\m' || unaccent(lower(split_part(btrim(ev.value ->> 'player'::text), ' ', -1))) || '\M')
            )), 0::bigint)::integer AS scorer_goals,
    COALESCE(( SELECT bool_or(tp.champion_points > 0) AS bool_or
           FROM tournament_predictions tp
          WHERE tp.user_id = u.id), false) AS champion_hit
   FROM users u
     LEFT JOIN predictions p ON p.user_id = u.id
     LEFT JOIN matches m ON p.match_id = m.id AND m.status = 'finished'::text
  GROUP BY u.id, u.display_name, u.avatar_url, u.total_points, u.created_at;

GRANT SELECT ON public.user_badges_view TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
