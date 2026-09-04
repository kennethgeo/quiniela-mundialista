import { matchStatus } from './matchStatus'

/* Un pendiente es un par (quiniela, partido), no solo un partido: la misma
   selección debe guardarse por separado en cada quiniela en la que se juega. */
export function buildPendingPredictions({ groups = [], matches = [], predictions = [], now = new Date() } = {}) {
  const activeGroups = groups.filter((group) => group.tournament_status !== 'finished')
  const predicted = new Set(predictions.map((prediction) => `${prediction.league_id}|${prediction.match_id}`))
  const groupsByTournament = new Map()

  for (const group of activeGroups) {
    const key = String(group.tournament_id)
    if (!groupsByTournament.has(key)) groupsByTournament.set(key, [])
    groupsByTournament.get(key).push(group)
  }

  const pending = []
  for (const match of matches) {
    if (!matchStatus(match, now).canPredict) continue
    for (const group of groupsByTournament.get(String(match.tournament_id)) || []) {
      if (predicted.has(`${group.id}|${match.id}`)) continue
      pending.push({ ...match, league_id: group.id, league_name: group.name })
    }
  }

  return pending.sort((a, b) => new Date(a.kickoff_at) - new Date(b.kickoff_at))
}
