import { describe, expect, it } from 'vitest'
import { buildPowerupLimits, powerupKey } from './powerups'

describe('powerupKey', () => {
  it('usa la misma llave fase/jornada que valida Postgres', () => {
    expect(powerupKey('groups', 2)).toBe('groups_2')
    expect(powerupKey('third_place', 0)).toBe('third_place')
    expect(powerupKey('final', 0)).toBe('final')
  })
})

describe('buildPowerupLimits', () => {
  it('no mezcla tercer puesto y final', () => {
    const limits = buildPowerupLimits([
      { phase: 'third_place', matchday: 0, max_uses: 1 },
      { phase: 'final', matchday: 0, max_uses: 2 },
    ])

    expect(limits).toEqual({ third_place: 1, final: 2 })
  })
})
