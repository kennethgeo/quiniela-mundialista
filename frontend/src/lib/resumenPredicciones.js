/* Presentación de resultados, no un motor de puntaje. Los puntos se leen de
   points_earned; un exacto se reconoce por los goles, aunque una quiniela
   otorgue 5 puntos o haya un bono por penales. */
export function esMarcadorExacto(prediction, match) {
  return !!prediction && match?.status === 'finished'
    && Number.isInteger(match.home_goals_actual) && Number.isInteger(match.away_goals_actual)
    && prediction.home_goals_pred === match.home_goals_actual
    && prediction.away_goals_pred === match.away_goals_actual
}

/* En el perfil un partido puede tener varias predicciones, una por quiniela.
   Se cuenta una vez: si acertó en alguna, cuenta como acierto, y si hizo un
   exacto en alguna, como exacto. No se elige una fila arbitraria ni se suman
   puntos. En el resumen de UNA quiniela se usa la misma clasificación. */
export function resumirPredicciones(predictions, matches) {
  const porId = new Map(matches.map((m) => [m.id, m]))
  const partidos = new Map()
  for (const p of predictions) {
    const m = porId.get(p.match_id)
    if (!m) continue
    const actual = partidos.get(m.id) || {
      finished: m.status === 'finished', exact: false, hit: false, x2: false,
    }
    actual.exact ||= esMarcadorExacto(p, m)
    actual.hit ||= actual.finished && (esMarcadorExacto(p, m) || (p.points_earned || 0) > 0)
    actual.x2 ||= !!p.use_powerup_x2
    partidos.set(m.id, actual)
  }
  const rows = [...partidos.values()]
  const finished = rows.filter((r) => r.finished)
  return {
    made: rows.length,
    finishedMade: finished.length,
    hits: finished.filter((r) => r.hit).length,
    exact: finished.filter((r) => r.exact).length,
    correct: finished.filter((r) => r.hit && !r.exact).length,
    miss: finished.filter((r) => !r.hit).length,
    x2: rows.filter((r) => r.x2).length,
  }
}
