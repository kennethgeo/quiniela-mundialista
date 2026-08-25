/* Tests del recordatorio de predicciones pendientes.

   El módulo que prueba vive en supabase/functions/notify-upcoming/logica.js
   (una edge function de Deno). El test está acá porque este es el único
   proyecto con corredor de tests JS y es el que corre el CI; la lógica es JS
   plano y sin dependencias justamente para que los dos la puedan importar.

   Lo que se cuida: mandarle el aviso a quien ya predijo es molesto, pero NO
   mandárselo a quien no predijo le cuesta puntos a alguien. */
import { describe, it, expect } from 'vitest'
import { faltantesPorUsuario, armarPayload } from '../../../supabase/functions/notify-upcoming/logica.js'

const TORNEO = 7
const OTRO_TORNEO = 9

const partido = (id, kickoff, tid = TORNEO) => ({
  id, tournament_id: tid, kickoff_at: kickoff,
  home_team: `Local${id}`, away_team: `Visita${id}`,
})

describe('faltantesPorUsuario', () => {
  const ligas = [
    { id: 'L1', tournament_id: TORNEO },
    { id: 'L2', tournament_id: TORNEO },
    { id: 'L9', tournament_id: OTRO_TORNEO },
  ]

  it('avisa a quien no predijo', () => {
    const r = faltantesPorUsuario({
      partidos: [partido(1, '2026-01-01T20:00:00Z')],
      ligas, miembros: [{ league_id: 'L1', user_id: 'ana' }], predicciones: [],
    })
    expect([...r.keys()]).toEqual(['ana'])
    expect(r.get('ana').map((p) => p.id)).toEqual([1])
  })

  it('NO avisa a quien ya predijo', () => {
    const r = faltantesPorUsuario({
      partidos: [partido(1, '2026-01-01T20:00:00Z')],
      ligas, miembros: [{ league_id: 'L1', user_id: 'ana' }],
      predicciones: [{ league_id: 'L1', match_id: 1, user_id: 'ana' }],
    })
    expect(r.size).toBe(0)
  })

  // El caso que motiva contar pares (quiniela, partido) en vez de solo partidos.
  it('avisa si predijo en una quiniela pero le falta en la otra del mismo torneo', () => {
    const r = faltantesPorUsuario({
      partidos: [partido(1, '2026-01-01T20:00:00Z')],
      ligas,
      miembros: [
        { league_id: 'L1', user_id: 'ana' },
        { league_id: 'L2', user_id: 'ana' },
      ],
      predicciones: [{ league_id: 'L1', match_id: 1, user_id: 'ana' }],
    })
    expect(r.get('ana').map((p) => p.id)).toEqual([1])
  })

  it('no lista el mismo partido dos veces por estar en dos quinielas', () => {
    const r = faltantesPorUsuario({
      partidos: [partido(1, '2026-01-01T20:00:00Z')],
      ligas,
      miembros: [
        { league_id: 'L1', user_id: 'ana' },
        { league_id: 'L2', user_id: 'ana' },
      ],
      predicciones: [],
    })
    expect(r.get('ana')).toHaveLength(1)
  })

  it('la predicción de otra persona no tapa la mía', () => {
    const r = faltantesPorUsuario({
      partidos: [partido(1, '2026-01-01T20:00:00Z')],
      ligas,
      miembros: [
        { league_id: 'L1', user_id: 'ana' },
        { league_id: 'L1', user_id: 'beto' },
      ],
      predicciones: [{ league_id: 'L1', match_id: 1, user_id: 'beto' }],
    })
    expect([...r.keys()]).toEqual(['ana'])
  })

  // El bug viejo: llegaban avisos de ligas en las que uno ni juega.
  it('no avisa de un torneo en el que no tenés quiniela', () => {
    const r = faltantesPorUsuario({
      partidos: [partido(1, '2026-01-01T20:00:00Z', OTRO_TORNEO)],
      ligas, miembros: [{ league_id: 'L1', user_id: 'ana' }], predicciones: [],
    })
    expect(r.size).toBe(0)
  })

  it('ignora membresías de quinielas que no vinieron en la consulta', () => {
    const r = faltantesPorUsuario({
      partidos: [partido(1, '2026-01-01T20:00:00Z')],
      ligas, miembros: [{ league_id: 'DESCONOCIDA', user_id: 'ana' }], predicciones: [],
    })
    expect(r.size).toBe(0)
  })

  it('ordena los pendientes por hora de saque', () => {
    const r = faltantesPorUsuario({
      partidos: [
        partido(3, '2026-01-01T22:00:00Z'),
        partido(1, '2026-01-01T20:00:00Z'),
        partido(2, '2026-01-01T21:00:00Z'),
      ],
      ligas, miembros: [{ league_id: 'L1', user_id: 'ana' }], predicciones: [],
    })
    expect(r.get('ana').map((p) => p.id)).toEqual([1, 2, 3])
  })

  it('cuenta solo lo que falta cuando predijo algunos', () => {
    const r = faltantesPorUsuario({
      partidos: [partido(1, '2026-01-01T20:00:00Z'), partido(2, '2026-01-01T21:00:00Z')],
      ligas, miembros: [{ league_id: 'L1', user_id: 'ana' }],
      predicciones: [{ league_id: 'L1', match_id: 1, user_id: 'ana' }],
    })
    expect(r.get('ana').map((p) => p.id)).toEqual([2])
  })

  it('sin miembros no le avisa a nadie', () => {
    const r = faltantesPorUsuario({
      partidos: [partido(1, '2026-01-01T20:00:00Z')],
      ligas, miembros: [], predicciones: [],
    })
    expect(r.size).toBe(0)
  })
})

describe('armarPayload', () => {
  it('con un solo partido lo nombra y linkea al partido', () => {
    const p = armarPayload([partido(42, '2026-01-01T20:00:00Z')])
    expect(p.body).toContain('Local42 vs Visita42')
    expect(p.url).toBe('/match/42')
  })

  it('con varios dice cuántos y nombra el primero', () => {
    const p = armarPayload([
      partido(1, '2026-01-01T20:00:00Z'),
      partido(2, '2026-01-01T21:00:00Z'),
      partido(3, '2026-01-01T22:00:00Z'),
    ])
    expect(p.title).toContain('3 predicciones')
    expect(p.body).toContain('Local1 vs Visita1')
    expect(p.body).toContain('2 más')
    expect(p.url).toBe('/')
  })
})
