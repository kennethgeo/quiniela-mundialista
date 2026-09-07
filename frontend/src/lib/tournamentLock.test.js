import { afterEach, describe, expect, it, vi } from 'vitest'
import { getTournamentLocked } from './tournamentLock'

const datos = vi.hoisted(() => ({ manual: false, inicio: null }))
vi.mock('./supabase', () => ({ supabase: {
  from: tabla => {
    const consulta = {
      select: () => consulta, eq: () => consulta, order: () => consulta, limit: () => consulta,
      maybeSingle: async () => ({ data: tabla === 'matches' ? { kickoff_at: datos.inicio } : { is_locked: datos.manual } }),
    }
    return consulta
  },
} }))
afterEach(() => { vi.useRealTimers(); datos.manual = false; datos.inicio = null })

describe('bloqueo global con la fecha compartida', () => {
  it('se activa en el instante exacto aunque el saque venga con zona negativa', async () => {
    vi.useFakeTimers()
    datos.inicio = '2026-09-06T14:00:00-06:00'
    vi.setSystemTime(new Date('2026-09-06T19:59:59.999Z'))
    expect(await getTournamentLocked()).toBe(false)
    vi.setSystemTime(new Date('2026-09-06T20:00:00Z'))
    expect(await getTournamentLocked()).toBe(true)
  })

  it('no trata una fecha desconocida como un torneo iniciado en 1970', async () => {
    for (const value of [null, 'sin fecha']) {
      datos.inicio = value
      expect(await getTournamentLocked()).toBe(false)
    }
  })

  it('conserva el bloqueo manual incluso sin fecha interpretable', async () => {
    datos.manual = true
    expect(await getTournamentLocked()).toBe(true)
  })
})
