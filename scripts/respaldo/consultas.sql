-- Respaldo semanal de Tico Games: DOS consultas de SOLO LECTURA.
-- Se mandan por separado con la herramienta de Supabase (execute_sql).
-- El `repeat(' ', 120000)` fuerza que la respuesta, grande, se guarde en un
-- archivo en vez de entrar a la conversación; generar.py lo lee de ahí.
-- NO incluye correos ni llaves de push (ver README).

-- === CONSULTA 1: predicciones ===
select json_build_object(
 'predictions', (select json_agg(x order by x.league_id, x.match_id, x.user_id) from predictions x)
)::text || repeat(' ', 120000) as datos;

-- === CONSULTA 2: todo lo demás ===
select json_build_object(
 'generado_at', now(),
 'users', (select json_agg(x order by x.created_at) from (select id,display_name,avatar_url,total_points,points_adjustment,is_admin,anonimizado_at,created_at,updated_at from users) x),
 'tournaments', (select json_agg(x order by x.created_at) from (select id,name,slug,kind,status,source,external_ref,season,starts_at,ends_at,created_at,predictions_locked,actual_champion,actual_top_scorer,actual_top_assist,predictions_force_open,unafut_league_slug,unafut_competition_id from tournaments) x),
 'leagues', (select json_agg(x order by x.created_at) from leagues x),
 'league_members', (select json_agg(x order by x.league_id, x.joined_at) from league_members x),
 'tournament_predictions', (select json_agg(x order by x.league_id, x.user_id) from tournament_predictions x),
 'powerup_credits', (select json_agg(x order by x.created_at) from powerup_credits x),
 'compensaciones_x2', (select json_agg(x order by x.id) from compensaciones_x2 x),
 'alertas_de_puntaje', (select json_agg(x order by x.match_id) from alertas_de_puntaje x),
 'rule_proposals', (select json_agg(x order by x.created_at) from rule_proposals x),
 'rule_votes', (select json_agg(x) from rule_votes x),
 'rule_proposal_electores', (select json_agg(x) from rule_proposal_electores x),
 'global_settings', (select json_agg(x) from global_settings x),
 'tournament_settings', (select json_agg(x) from tournament_settings x),
 'global_chat', (select json_agg(x order by x.created_at) from global_chat x),
 'user_badges', (select json_agg(x order by x.user_id, x.league_id, x.badge_key) from user_badges x),
 'match_audit', (select json_agg(x order by x.changed_at) from match_audit x),
 'matches', (select json_agg(x order by x.tournament_id, x.kickoff_at, x.id) from (select id,tournament_id,external_id,home_team,away_team,home_team_code,away_team_code,kickoff_at,phase,stage,group_name,matchday,status,home_goals_actual,away_goals_actual,goes_to_penalties,penalties_winner_real,score_locked,predictions_force_open,venue,city,puntuado_con,puntuado_at,puntaje_pendiente_desde,created_at from matches) x),
 'conteos_excluidos', json_build_object(
    'banned_emails', (select count(*) from banned_emails),
    'push_subscriptions', (select count(*) from push_subscriptions),
    'prediction_logs', (select count(*) from prediction_logs),
    'players', (select count(*) from players),
    'match_details_cache', (select count(*) from match_details_cache),
    'notification_deliveries', (select count(*) from notification_deliveries),
    'powerup_limits', (select count(*) from powerup_limits))
)::text || repeat(' ', 120000) as datos;
