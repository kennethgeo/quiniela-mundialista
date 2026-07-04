import { evaluatePrediction } from './scoring'

/**
 * Puntos PROVISIONALES (en vivo) por usuario, según el marcador ACTUAL de los
 * partidos en curso, evaluados con la misma lógica que al finalizar (incluye el
 * x2). Es parcial: solo para ir viendo cómo se podría mover el ranking. Los
 * penales no aplican en vivo (el partido aún no terminó).
 *
 * @param {Array} liveMatches  partidos en curso (con home_goals_actual/away_goals_actual)
 * @param {Array} predictions  predicciones de cualquier usuario sobre esos partidos
 * @returns {Object} mapa user_id -> puntos provisionales
 */
export function provisionalByUser(liveMatches, predictions) {
  const byUser = {}
  const byId = new Map((liveMatches || []).map((m) => [m.id, m]))
  for (const p of predictions || []) {
    const m = byId.get(p.match_id)
    if (!m || m.home_goals_actual == null || m.away_goals_actual == null) continue
    byUser[p.user_id] = (byUser[p.user_id] || 0) + evaluatePrediction(p, m.home_goals_actual, m.away_goals_actual, false, null, m.home_team, m.away_team)
  }
  return byUser
}
