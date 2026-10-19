import { describe, expect, it } from 'vitest'
import { cambiosPuntaje } from './cambiosPuntaje'

describe('cambios que el grupo necesita ver antes de votar', () => {
  it('muestra el cambio del asistidor, incluso a cero', () => {
    expect(cambiosPuntaje({ assist_points: 0 }, { assist_points: 12 })).toEqual([
      { key: 'assist_points', label: 'Acertar asistidor', from: 12, to: 0 },
    ])
  })
  it('muestra cupos agregados, eliminados y cambiados a cero', () => {
    expect(cambiosPuntaje({ powerup_limits: { groups: 0, Final: 1 } }, { powerup_limits: { groups: 3, Semifinal: 2 } }))
      .toEqual([
        { key: 'fase:groups', label: 'Comodines ×2 · Jornadas regulares', from: 3, to: 0 },
        { key: 'fase:Semifinal', label: 'Comodines ×2 · Semifinal', from: 2, to: 'Cupo general' },
        { key: 'fase:Final', label: 'Comodines ×2 · Final', from: 'Cupo general', to: 1 },
      ])
  })
  it('vaciar el objeto no equivale a dejar los cupos intactos', () => {
    expect(cambiosPuntaje({ powerup_limits: {} }, { powerup_limits: { final: 1 } }))
      .toEqual([{ key: 'fase:final', label: 'Comodines ×2 · Final', from: 1, to: 'Cupo general' }])
  })
  it('no inventa cambios cuando no se enviaron cupos ni cuando el valor es equivalente', () => {
    expect(cambiosPuntaje({ points_correct: '2' }, { points_correct: 2, powerup_limits: { Final: 1 } })).toEqual([])
    expect(cambiosPuntaje({ powerup_limits: { Final: 1 } }, { powerup_limits: { Final: 1 } })).toEqual([])
  })
})
