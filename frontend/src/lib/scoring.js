import { supabase } from './supabase'

// --- Comparación tolerante de nombres (goleador) -----------------------------
// Los nombres del goleador se escriben a mano, así que la comparación exacta
// falla por acentos ("Mbappe" vs "Mbappé"), nombre parcial ("Mbappé"), o nombre
// completo ("Lionel Andres Messi Cuccitini" vs "Lionel Messi"). Misma lógica que
// la vista user_badges_view (database/20_fix_scorer_name_match.sql).
const normName = (s) =>
  (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita acentos
    .toLowerCase().trim().replace(/\s+/g, ' ')

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const lastToken = (s) => { const t = normName(s).split(' ').filter(Boolean); return t[t.length - 1] || '' }
const wordIn = (word, hay) => word.length >= 3 && new RegExp(`(^|\\s)${escapeRe(word)}(\\s|$)`).test(hay)

// El campeón sale de una lista fija (mismo dropdown), así que basta igualdad sin
// acentos (p. ej. "Türkiye"); NO se usa contención para no confundir equipos
// parecidos ("DR Congo" vs "Congo").
const championMatches = (actual, pick) => {
  const a = normName(actual), p = normName(pick)
  return !!a && !!p && a === p
}

// El goleador es texto libre: igualdad, contención en cualquier sentido, o
// coincidencia del apellido (última palabra) como palabra dentro del otro.
const scorerMatches = (actual, pick) => {
  const a = normName(actual), p = normName(pick)
  if (!a || !p) return false
  if (a === p) return true
  if (a.length >= 3 && p.includes(a)) return true
  if (p.length >= 3 && a.includes(p)) return true
  if (wordIn(lastToken(a), p)) return true
  if (wordIn(lastToken(p), a)) return true
  return false
}

/* NOTA: acá vivía calculateAndUpdateScores(), que recalculaba y GUARDABA los
   puntos desde el navegador. Se eliminó porque estaba roto: las políticas RLS
   de 'predictions' solo dejan escribir al dueño de la predicción o a
   service_role, y no hay política de admin. O sea que al corregir un resultado
   desde el panel, el admin actualizaba solo SUS puntos y los de los demás
   fallaban en silencio (0 filas, sin error). Por eso cada corrección terminaba
   haciéndose por SQL a mano.
   Ahora el recálculo lo hace el backend (POST /api/admin/recalc-match), que
   corre con service_role y usa el mismo motor que el sync.

   Lo que queda acá abajo es SOLO PARA MOSTRAR, nunca para guardar:
   evaluatePrediction() la usa lib/provisional.js para los puntos en vivo. Debe
   dar exactamente lo mismo que backend/app/services/scoring.py — eso lo
   verifica el corpus compartido de shared/scoring_cases.json en cada CI. */

export function evaluatePrediction(pred, home_actual, away_actual, goes_to_penalties, penalties_winner_real, home_team, away_team, config = null) {
  // Puntaje configurable por quiniela, igual que scoring.py. Por defecto 3/1.
  const cfg = config || {}
  const P_EXACT = cfg.points_exact ?? 3
  const P_CORRECT = cfg.points_correct ?? 1
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
      // Predijo un ganador y el partido se fue a penales (empate en 90'/120').
      // Si el equipo que eligió ganador es el que avanzó en penales, 1 punto
      // (acertó quién pasa). Si no, 0.
      const predTeam = pred_winner === 'home' ? home_team : away_team
      points = (penalties_winner_real && predTeam && predTeam === penalties_winner_real) ? P_CORRECT : 0
    } else {
      if (real_winner === 'tie') {
        if (home_pred === home_actual && away_pred === away_actual) points = P_EXACT
        else if (pred_winner === 'tie') points = P_CORRECT
        else points = 0

        // Penales: el marcador del empate vale igual (3 exacto / 1 empate),
        // aunque se falle el penal. Acertar quién pasa suma +1 a la base, así el
        // comodín x2 también lo duplica.
        if (goes_to_penalties && pred_winner === 'tie' && penalties_winner_pred && penalties_winner_real
            && penalties_winner_pred === penalties_winner_real) {
          points += 1
        }
      } else {
        if (home_pred === home_actual && away_pred === away_actual) points = P_EXACT
        else if (pred_winner === real_winner) points = P_CORRECT
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
        if (penalties_winner_pred && penalties_winner_real && penalties_winner_pred === penalties_winner_real) points = P_CORRECT
        else points = 0
      } else {
        points = 0
      }
    } else {
      if (pred_winner === real_winner) points = P_CORRECT
      else points = 0
    }
  }

  if (use_powerup) points *= 2

  return points
}

/* reconcileTotals vivía acá y se quitó a propósito.

   Estaba rota de tres formas a la vez: omitía los puntos de asistidor (así que
   "corregir" se los restaba a quien los había acertado), contaba como
   aplicadas escrituras que la RLS rechazaba en silencio — las promesas de
   supabase-js resuelven con {error} en vez de rechazar — y esa misma RLS solo
   deja escribir la fila propia, así que en la práctica únicamente podía tocar
   al admin mientras informaba "Totales sincronizados" para todo el grupo.

   Ahora lo hace el backend con service_role: POST /_backend/api/admin/reconcile-totals
*/
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

    // Puede haber EMPATE de goleador: el admin separa los nombres con coma (o ;
    // o /). Se otorgan los 12 pts si el pick coincide con CUALQUIERA de ellos.
    const topScorerNames = (actual_top_scorer || '').split(/[,;/]/).map((s) => s.trim()).filter(Boolean)

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

      if (actual_champion && pred.champion_team && championMatches(actual_champion, pred.champion_team)) {
        championPts = 12
      }

      if (pred.top_scorer_name && topScorerNames.some((n) => scorerMatches(n, pred.top_scorer_name))) {
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

