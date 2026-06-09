import { supabase } from './supabase'

export async function calculateAndUpdateScores(matchId) {
  try {
    // 1. Obtener resultado real del partido
    const { data: match, error: matchError } = await supabase
      .from('matches')
      .select('id, home_goals_actual, away_goals_actual, status, goes_to_penalties, penalties_winner_real')
      .eq('id', matchId)
      .single()

    if (matchError || !match || match.status !== 'finished') {
      return { status: 'error', message: 'Partido no finalizado o no encontrado' }
    }

    const home_actual = match.home_goals_actual
    const away_actual = match.away_goals_actual
    const goes_to_penalties = match.goes_to_penalties || false
    const penalties_winner_real = match.penalties_winner_real

    if (home_actual === null || away_actual === null) {
      return { status: 'error', message: 'El partido no tiene resultado válido' }
    }

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
      const pts = evaluatePrediction(pred, home_actual, away_actual, goes_to_penalties, penalties_winner_real)
      const oldPoints = pred.points_earned || 0
      const delta = pts - oldPoints

      if (delta !== 0) {
        updates.push({ id: pred.id, points_earned: pts })
        const uid = pred.user_id
        userPointsDelta[uid] = (userPointsDelta[uid] || 0) + delta
      }
    }

    // 4. Guardar nuevos puntos en predicciones
    if (updates.length > 0) {
      await Promise.all(
        updates.map(u => 
          supabase.from('predictions').update({ points_earned: u.points_earned }).eq('id', u.id)
        )
      )
    }

    // 5. Actualizar usuarios
    let updatedUsers = 0
    for (const [userId, delta] of Object.entries(userPointsDelta)) {
      if (delta !== 0) {
        const { data: userRes } = await supabase
          .from('users')
          .select('total_points')
          .eq('id', userId)
          .single()
        
        if (userRes) {
          const currentTotal = userRes.total_points || 0
          await supabase
            .from('users')
            .update({ total_points: currentTotal + delta })
            .eq('id', userId)
          updatedUsers++
        }
      }
    }

    return { status: 'ok', updatedPredictions: updates.length, updatedUsers }
  } catch (err) {
    console.error('Scoring error', err)
    return { status: 'error', message: err.message }
  }
}

function evaluatePrediction(pred, home_actual, away_actual, goes_to_penalties, penalties_winner_real) {
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
        if (home_pred === home_actual && away_pred === away_actual) points = 6
        else if (pred_winner === 'tie') points = 3
        else points = 0

        if (goes_to_penalties && pred_winner === 'tie' && penalties_winner_pred && penalties_winner_real) {
          if (penalties_winner_pred === penalties_winner_real) points += 3
        }
      } else {
        if (home_pred === home_actual && away_pred === away_actual) points = 6
        else if (pred_winner === real_winner) {
          if (home_pred === home_actual || away_pred === away_actual) points = 4
          else points = 3
        } else {
          if (home_pred === home_actual || away_pred === away_actual) points = 1
          else points = 0
        }
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
        if (penalties_winner_pred && penalties_winner_real && penalties_winner_pred === penalties_winner_real) points = 5
        else points = 3
      } else {
        points = 0
      }
    } else {
      if (pred_winner === real_winner) points = 3
      else points = 0
    }
  }

  if (use_powerup) points *= 2

  return points
}
