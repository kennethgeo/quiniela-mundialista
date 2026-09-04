import { describe, expect, it } from 'vitest'
import { buildPendingPredictions } from './pendingPredictions'

const now = new Date('2026-09-03T12:00:00Z')
const groups = [
  { id: 'a', name: 'Bundestica', tournament_id: 1, tournament_status: 'active' },
  { id: 'b', name: 'Amigos', tournament_id: 1, tournament_status: 'active' },
  { id: 'old', name: 'Pasada', tournament_id: 2, tournament_status: 'finished' },
]
const matches = [
  { id: 8, tournament_id: 1, status: 'pending', kickoff_at: '2026-09-03T13:00:00Z' },
  { id: 7, tournament_id: 1, status: 'pending', kickoff_at: '2026-09-03T12:10:00Z' },
  { id: 9, tournament_id: 2, status: 'pending', kickoff_at: '2026-09-03T15:00:00Z' },
]

describe('buildPendingPredictions', () => {
  it('cuenta cada par quiniela-partido y omite lo ya guardado', () => {
    const result = buildPendingPredictions({
      groups, matches, now,
      predictions: [{ league_id: 'a', match_id: 8 }],
    })
    expect(result.map((item) => `${item.league_id}|${item.id}`)).toEqual(['b|8'])
  })

  it('omite partidos cerrados y quinielas finalizadas', () => {
    const result = buildPendingPredictions({ groups, matches, now })
    expect(result.map((item) => `${item.league_id}|${item.id}`)).toEqual(['a|8', 'b|8'])
  })
})
