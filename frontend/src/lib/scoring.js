import { supabase } from './supabase'

export async function calculateAndUpdateScores(matchId) {
  try {
    // 1. Obtener resultado real del partido
    const { data: match, error: matchError } = await supabase
      .from('matches')
      .select('id, home_goals_actual, away_goals_actual, status, goes_to_penalties, penalties_winner_real')
      .eq('id', matchId)
      .single()

    if (matchError || !match) {
      return { status: 'error', message: 'Partido no encontrado' }
    }

    const isFinished = match.status === 'finished'
    const home_actual = match.home_goals_actual
    const away_actual = match.away_goals_actual
    const goes_to_penalties = match.goes_to_penalties || false
    const penalties_winner_real = match.penalties_winner_real

    // 2. Obtener predicciones
    const { data: predictions, error: predsError } = await supabase
      .from('predictions')
      .select('*')
      .eq('match_id', matchId)

    if (predsError || !predictions || predictions.length === 0) {
      return { status: 'ok', message: 'No hay predicciones' }
    }

    const updates = []
    const userPointsDelta = {}

    // 3. Evaluar
    for (const pred of predictions) {
      let pts = 0
      if (isFinished && home_actual !== null && away_actual !== null) {
        pts = evaluatePrediction(pred, home_actual, away_actual, goes_to_penalties, penalties_winner_real)
      }
      const oldPoints = pred.points_earned || 0
      const delta = pts - oldPoints

      if (delta !== 0) {
        updates.push({ id: pred.id, points_earned: pts })
        const uid = pred.user_id
        userPointsDelta[uid] = (userPointsDelta[uid] || 0) + delta
      }
    }

    // 4. Guardar nuevos puntos en predicciones.
    //    users.total_points lo mantiene SOLO la base de datos (trigger
    //    recompute_user_total). No lo tocamos aquí con deltas: ese patrón
    //    (leer-sumar-escribir) causaba "lost updates" bajo concurrencia.
    if (updates.length > 0) {
      await Promise.all(
        updates.map(u =>
          supabase.from('predictions').update({ points_earned: u.points_earned }).eq('id', u.id)
        )
      )
    }

    const affectedUsers = Object.keys(userPointsDelta).length
    return { status: 'ok', updatedPredictions: updates.length, updatedUsers: affectedUsers }
  } catch (err) {
    console.error('Scoring error', err)
    return { status: 'error', message: err.message }
  }
}

export function evaluatePrediction(pred, home_actual, away_actual, goes_to_penalties, penalties_winner_real) {
  const pred_type = pred.prediction_type || 'Marcador'
  const home_pred = pred.home_goals_pred
  const away_pred = pred.away_goals_pred
  const penalties_winner_pred = pred.penalties_winner_pred
  const use_powerup = pred.use_powerup_x2 || false

  let real_winner = 'tie'
  if (home_actual > away_actual) real_winner = 'home'
  else if (away_actual > home_actual) real_winner = 'away'

  let points = 0

  if (pred_type === 'Marcador') {
    if (home_pred === null || away_pred === null) return 0

    let pred_winner = 'tie'
    if (home_pred > away_pred) pred_winner = 'home'
    else if (away_pred > home_pred) pred_winner = 'away'

    if (goes_to_penalties && pred_winner !== 'tie') {
      points = 0
    } else {
      if (real_winner === 'tie') {
        if (home_pred === home_actual && away_pred === away_actual) points = 3
        else if (pred_winner === 'tie') points = 1
        else points = 0

        if (goes_to_penalties && pred_winner === 'tie' && penalties_winner_pred && penalties_winner_real) {
          // Si falló en los penales, pierde sus puntos de empate
          if (penalties_winner_pred !== penalties_winner_real) points = 0
        }
      } else {
        if (home_pred === home_actual && away_pred === away_actual) points = 3
        else if (pred_winner === real_winner) points = 1
        else points = 0
      }
    }
  } else if (pred_type === 'Solo_Ganador') {
    let pred_winner = 'tie'
    if (home_pred !== null && away_pred !== null) {
      if (home_pred > away_pred) pred_winner = 'home'
      else if (away_pred > home_pred) pred_winner = 'away'
    }

    if (goes_to_penalties) {
      if (pred_winner === 'tie') {
        if (penalties_winner_pred && penalties_winner_real && penalties_winner_pred === penalties_winner_real) points = 1
        else points = 0
      } else {
        points = 0
      }
    } else {
      if (pred_winner === real_winner) points = 1
      else points = 0
    }
  }

  if (use_powerup) points *= 2

  return points
}

/**
 * Reconcilia users.total_points con la suma autoritativa de puntos:
 *   total_points = Σ(predictions.points_earned)
 *                + Σ(tournament_predictions.champion_points + top_scorer_points)
 *
 * NO modifica points_earned ni las predicciones: solo corrige el agregado
 * cacheado en users.total_points cuando la lógica de deltas lo descuadró.
 * Con { apply: false } solo reporta; con { apply: true } aplica la corrección.
 */
export async function reconcileTotals({ apply = false } = {}) {
  try {
    const fetchAll = async (table, columns) => {
      const rows = []
      let from = 0
      const page = 1000
      // Paginación: Supabase devuelve máx. 1000 filas por consulta
      while (true) {
        const { data, error } = await supabase.from(table).select(columns).range(from, from + page - 1)
        if (error) throw error
        rows.push(...(data || []))
        if (!data || data.length < page) break
        from += page
      }
      return rows
    }

    const totals = {}
    for (const p of await fetchAll('predictions', 'user_id, points_earned')) {
      totals[p.user_id] = (totals[p.user_id] || 0) + (p.points_earned || 0)
    }
    for (const tp of await fetchAll('tournament_predictions', 'user_id, champion_points, top_scorer_points')) {
      totals[tp.user_id] = (totals[tp.user_id] || 0) + (tp.champion_points || 0) + (tp.top_scorer_points || 0)
    }

    const users = await fetchAll('users', 'id, display_name, total_points')

    const discrepancies = []
    for (const u of users) {
      const stored = u.total_points || 0
      const computed = totals[u.id] || 0
      if (stored !== computed) {
        discrepancies.push({ user_id: u.id, display_name: u.display_name, stored, computed, diff: computed - stored })
      }
    }

    let applied = 0
    if (apply && discrepancies.length > 0) {
      await Promise.all(
        discrepancies.map((d) => supabase.from('users').update({ total_points: d.computed }).eq('id', d.user_id))
      )
      applied = discrepancies.length
    }

    return { status: 'ok', usersChecked: users.length, discrepancies, applied }
  } catch (err) {
    console.error('Reconcile error', err)
    return { status: 'error', message: err.message }
  }
}

export async function calculateTournamentPredictions() {
  try {
    const { data: settings, error: settingsError } = await supabase
      .from('tournament_settings')
      .select('actual_champion, actual_top_scorer')
      .eq('id', 1)
      .single()

    if (settingsError || !settings) {
      return { status: 'error', message: 'Configuración no encontrada' }
    }

    const { actual_champion, actual_top_scorer } = settings

    if (!actual_champion && !actual_top_scorer) {
      return { status: 'ok', message: 'Resultados globales aún no definidos' }
    }

    const { data: predictions, error: predsError } = await supabase
      .from('tournament_predictions')
      .select('*')

    if (predsError || !predictions || predictions.length === 0) {
      return { status: 'ok', message: 'No hay predicciones globales' }
    }

    const updates = []
    const userPointsDelta = {}

    for (const pred of predictions) {
      let championPts = 0
      let topScorerPts = 0

      if (actual_champion && pred.champion_team && actual_champion.trim().toLowerCase() === pred.champion_team.trim().toLowerCase()) {
        championPts = 12
      }

      if (actual_top_scorer && pred.top_scorer_name && actual_top_scorer.trim().toLowerCase() === pred.top_scorer_name.trim().toLowerCase()) {
        topScorerPts = 12
      }

      const oldChampionPts = pred.champion_points || 0
      const oldTopScorerPts = pred.top_scorer_points || 0
      
      const championDelta = championPts - oldChampionPts
      const topScorerDelta = topScorerPts - oldTopScorerPts
      const delta = championDelta + topScorerDelta

      if (championDelta !== 0 || topScorerDelta !== 0) {
        updates.push({ 
          id: pred.id, 
          champion_points: championPts, 
          top_scorer_points: topScorerPts 
        })
        const uid = pred.user_id
        userPointsDelta[uid] = (userPointsDelta[uid] || 0) + delta
      }
    }

    if (updates.length > 0) {
      await Promise.all(
        updates.map(u =>
          supabase.from('tournament_predictions').update({
            champion_points: u.champion_points,
            top_scorer_points: u.top_scorer_points
          }).eq('id', u.id)
        )
      )
    }

    // users.total_points lo recalcula la base de datos (trigger). No usamos deltas.
    const affectedUsers = Object.keys(userPointsDelta).length
    return { status: 'ok', updatedPredictions: updates.length, updatedUsers: affectedUsers }
  } catch (err) {
    console.error('Tournament Scoring error', err)
    return { status: 'error', message: err.message }
  }
}

