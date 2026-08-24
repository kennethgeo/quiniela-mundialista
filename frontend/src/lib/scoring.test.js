/* Tests del motor de puntaje (JS).
   Corre el corpus compartido de shared/scoring_cases.json, el mismo que corre
   el motor de Python en backend/tests/test_scoring.py. Si los dos no dan lo
   mismo, el CI lo caza: esa es la única garantía real de que la lógica
   duplicada sigue siendo idéntica, que es lo que exige el CLAUDE.md. */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// scoring.js importa el cliente de supabase al cargar el módulo, y crearlo pide
// URL y key. Acá solo probamos la función pura, así que se mockea.
vi.mock('./supabase', () => ({ supabase: {} }))

const { evaluatePrediction } = await import('./scoring')

const aqui = dirname(fileURLToPath(import.meta.url))
const corpus = JSON.parse(
  readFileSync(resolve(aqui, '../../../shared/scoring_cases.json'), 'utf8'),
)

describe('evaluatePrediction — corpus compartido', () => {
  for (const c of corpus.casos) {
    it(c.nombre, () => {
      const penales = c.penales || { va: false, ganador_real: null }
      const puntos = evaluatePrediction(
        c.pred,
        c.real.home,
        c.real.away,
        penales.va || false,
        penales.ganador_real || null,
        'Local',
        'Visita',
      )
      expect(puntos).toBe(c.esperado)
    })
  }
})

describe('evaluatePrediction — casos borde', () => {
  it('una predicción sin comodín no duplica', () => {
    expect(evaluatePrediction({ home_goals_pred: 1, away_goals_pred: 0 }, 1, 0, false, null, 'Local', 'Visita')).toBe(3)
  })

  it('el comodín multiplica por 2, no suma', () => {
    const sin = evaluatePrediction({ home_goals_pred: 1, away_goals_pred: 0 }, 1, 0, false, null, 'Local', 'Visita')
    const con = evaluatePrediction({ home_goals_pred: 1, away_goals_pred: 0, use_powerup_x2: true }, 1, 0, false, null, 'Local', 'Visita')
    expect(con).toBe(sin * 2)
  })

  it('el comodín sobre un fallo sigue siendo 0 (no resta)', () => {
    expect(evaluatePrediction({ home_goals_pred: 0, away_goals_pred: 3, use_powerup_x2: true }, 3, 0, false, null, 'Local', 'Visita')).toBe(0)
  })
})

/* La divergencia del puntaje por quiniela quedó cerrada: evaluatePrediction
   ahora acepta config igual que scoring.py. Estos tests son el espejo exacto de
   TestPuntajePorQuiniela en backend/tests/test_scoring.py — si un motor cambia
   y el otro no, uno de los dos falla. */
describe('puntaje configurable por quiniela', () => {
  const cfg = { points_exact: 5, points_correct: 2 }

  it('usa points_exact de la config', () => {
    expect(evaluatePrediction({ home_goals_pred: 1, away_goals_pred: 0 }, 1, 0, false, null, 'Local', 'Visita', cfg)).toBe(5)
  })

  it('usa points_correct de la config', () => {
    expect(evaluatePrediction({ home_goals_pred: 3, away_goals_pred: 0 }, 2, 1, false, null, 'Local', 'Visita', cfg)).toBe(2)
  })

  it('la config también se duplica con el comodín', () => {
    expect(evaluatePrediction({ home_goals_pred: 1, away_goals_pred: 0, use_powerup_x2: true }, 1, 0, false, null, 'Local', 'Visita', cfg)).toBe(10)
  })

  it('sin config cae al default 3/1', () => {
    expect(evaluatePrediction({ home_goals_pred: 1, away_goals_pred: 0 }, 1, 0, false, null, 'Local', 'Visita')).toBe(3)
  })
})
