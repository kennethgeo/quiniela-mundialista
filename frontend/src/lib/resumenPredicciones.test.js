import { describe, expect, it } from 'vitest'
import { esMarcadorExacto, resumirPredicciones } from './resumenPredicciones'

const terminado = { id: 'a', status: 'finished', home_goals_actual: 0, away_goals_actual: 0 }
const pred = { match_id: 'a', home_goals_pred: 0, away_goals_pred: 0, points_earned: 5 }

describe('exactos y resumen sin volver a calcular puntos', () => {
  it.each([0, 2, 4, 5, 8, 10])('un marcador exacto se reconoce con %s puntos guardados', (points_earned) => {
    expect(esMarcadorExacto({ ...pred, points_earned }, terminado)).toBe(true)
  })
  it('el empate no exacto con tanda y ×2 no se convierte en exacto por sumar cuatro', () => {
    const p = { ...pred, home_goals_pred: 1, away_goals_pred: 1, points_earned: 4, use_powerup_x2: true }
    expect(esMarcadorExacto(p, terminado)).toBe(false)
    expect(resumirPredicciones([p], [terminado])).toMatchObject({ exact: 0, hits: 1, correct: 1 })
  })
  it.each([null, undefined])('un resultado incompleto (%s) no es un exacto', (valor) => {
    expect(esMarcadorExacto({ ...pred, home_goals_pred: valor }, { ...terminado, home_goals_actual: valor })).toBe(false)
  })
  it('no clasifica como exacto un partido en vivo', () => {
    expect(esMarcadorExacto(pred, { ...terminado, status: 'in_progress' })).toBe(false)
  })
  it('las futuras y las anuladas no reducen la efectividad', () => {
    const matches = [terminado, { id: 'b', status: 'pending' }, { id: 'c', status: 'cancelled' }]
    const rows = [pred, { match_id: 'b' }, { match_id: 'c', points_earned: 6 }]
    expect(resumirPredicciones(rows, matches)).toMatchObject({ made: 3, finishedMade: 1, hits: 1, exact: 1 })
  })
  it('cuenta un partido una vez entre quinielas con elecciones diferentes, sin depender del orden', () => {
    const fallo = { ...pred, league_id: 'otra', home_goals_pred: 3, points_earned: 0, use_powerup_x2: true }
    const exacto = { ...pred, use_powerup_x2: true }
    const esperado = { made: 1, finishedMade: 1, hits: 1, exact: 1, correct: 0, miss: 0, x2: 1 }
    expect(resumirPredicciones([fallo, exacto], [terminado])).toEqual(esperado)
    expect(resumirPredicciones([exacto, fallo], [terminado])).toEqual(esperado)
  })
  it('cuenta los fallos una vez y no modifica las filas originales', () => {
    const rows = Object.freeze([Object.freeze({ ...pred, home_goals_pred: 3, points_earned: 0 })])
    expect(resumirPredicciones(rows, [terminado])).toMatchObject({ hits: 0, exact: 0, miss: 1 })
    expect(rows[0].points_earned).toBe(0)
  })
})
