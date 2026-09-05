import { describe, expect, it } from 'vitest'
import { matchStatus, predictionDeadline, timeUntilDeadline } from './matchStatus'

const now = new Date('2026-09-03T12:00:00Z')
const game = (kickoff_at, status = 'pending') => ({ kickoff_at, status })

describe('matchStatus', () => {
  it('distingue abierto, por cerrar y cerrado con el corte real de 15 minutos', () => {
    expect(matchStatus(game('2026-09-03T14:00:00Z'), now).key).toBe('open')
    expect(matchStatus(game('2026-09-03T12:45:00Z'), now).key).toBe('closing')
    expect(matchStatus(game('2026-09-03T12:15:00Z'), now).key).toBe('locked')
  })

  it('el estado de la base domina al reloj', () => {
    expect(matchStatus(game('2026-09-03T14:00:00Z', 'in_progress'), now).key).toBe('live')
    expect(matchStatus(game('2026-09-03T14:00:00Z', 'finished'), now).key).toBe('finished')
    expect(matchStatus(game('2026-09-03T14:00:00Z', 'postponed'), now).key).toBe('postponed')
  })

  it('calcula el plazo visible desde los mismos 15 minutos', () => {
    expect(predictionDeadline('2026-09-03T14:00:00Z').toISOString()).toBe('2026-09-03T13:45:00.000Z')
    expect(timeUntilDeadline('2026-09-03T14:00:00Z', now)).toBe('1 h 45 min')
  })

  it('respeta zonas negativas y no cierra antes de los 15 minutos exactos', () => {
    expect(predictionDeadline('2026-09-03T08:00:00-06:00').toISOString()).toBe('2026-09-03T13:45:00.000Z')
    expect(matchStatus(game('2026-09-03T12:15:00.001Z'), now).canPredict).toBe(true)
    expect(matchStatus(game('2026-09-03T12:15:00.000Z'), now).canPredict).toBe(false)
  })
})
