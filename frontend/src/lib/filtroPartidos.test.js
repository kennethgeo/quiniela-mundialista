import { describe, it, expect } from 'vitest'
import {
  FILTRO_TODOS, FILTROS, aplicarFiltro, contarFiltros, filtroEfectivo,
} from './filtroPartidos'

/* AHORA fijo: si la prueba dependiera del reloj, «hoy» cambiaría de resultado
   según a qué hora corra CI. 2026-09-09 15:00Z son las 9:00 am en Costa Rica
   (UTC-6 todo el año), o sea bien dentro del día natural. */
const AHORA = new Date('2026-09-09T15:00:00Z')

const partido = (id, extra = {}) => ({
  id, status: 'pending', matchday: 1, phase: 'groups', stage: 'Jornada 1',
  home_team: `Local ${id}`, away_team: `Visita ${id}`,
  kickoff_at: '2026-09-09T19:00:00Z', ...extra,
})

// Jornada 1 de la Champions en pequeño: unos ya jugados, otros hoy, otro mañana.
const JUGADO = partido('jugado', { status: 'finished', kickoff_at: '2026-09-08T19:00:00Z' })
const HOY_ABIERTO = partido('hoy-abierto')
const HOY_PREDICHO = partido('hoy-predicho')
const HOY_CERRADO = partido('hoy-cerrado', { kickoff_at: '2026-09-09T15:05:00Z' })
const MANANA = partido('manana', { kickoff_at: '2026-09-10T19:00:00Z' })
const TODOS = [JUGADO, HOY_ABIERTO, HOY_PREDICHO, HOY_CERRADO, MANANA]

const PREDICCIONES = [{ match_id: 'hoy-predicho', home_goals_pred: 1, away_goals_pred: 0 }]
const OPCIONES = { predictions: PREDICCIONES, now: AHORA }

const ids = (lista) => lista.map((m) => m.id)

describe('aplicarFiltro', () => {
  it('«todos» no toca la lista', () => {
    expect(aplicarFiltro(FILTRO_TODOS, TODOS, OPCIONES)).toEqual(TODOS)
  })

  it('un filtro desconocido tampoco: mejor de más que una pantalla vacía', () => {
    expect(aplicarFiltro('inventado', TODOS, OPCIONES)).toEqual(TODOS)
  })

  it('«por predecir» deja solo lo abierto y sin marcador puesto', () => {
    // Fuera: el jugado, el ya predicho y el que cierra en 5 min (corte de 15).
    expect(ids(aplicarFiltro('pendientes', TODOS, OPCIONES))).toEqual(['hoy-abierto', 'manana'])
  })

  it('una fila sin marcador NO cuenta como predicha', () => {
    const aMedias = [{ match_id: 'hoy-predicho', home_goals_pred: null, away_goals_pred: null }]
    const r = aplicarFiltro('pendientes', TODOS, { predictions: aMedias, now: AHORA })
    expect(ids(r)).toContain('hoy-predicho')
  })

  it('«hoy» usa el día natural de Costa Rica, no el UTC', () => {
    /* Un partido a las 2:00Z del 10 de septiembre son las 8 pm del 9 en Costa
       Rica: es de HOY. Con el día UTC se caería de la lista, que es justo el
       error que este proyecto ya cometió una vez. */
    const nocturno = partido('nocturno', { kickoff_at: '2026-09-10T02:00:00Z' })
    expect(ids(aplicarFiltro('hoy', [...TODOS, nocturno], OPCIONES)))
      .toEqual(['hoy-cerrado', 'hoy-abierto', 'hoy-predicho', 'nocturno'])
  })

  it('«por jugar» esconde terminados, cancelados y pospuestos', () => {
    const raros = [
      partido('cancelado', { status: 'cancelled' }),
      partido('pospuesto', { status: 'postponed' }),
      partido('envivo', { status: 'in_progress' }),
    ]
    const r = ids(aplicarFiltro('porjugar', [...TODOS, ...raros], OPCIONES))
    expect(r).not.toContain('jugado')
    expect(r).not.toContain('cancelado')
    expect(r).not.toContain('pospuesto')
    // En juego SÍ: no se puede predecir, pero es lo último que se quiere perder de vista.
    expect(r).toContain('envivo')
  })
})

describe('contarFiltros', () => {
  it('cuenta cada filtro y el total', () => {
    expect(contarFiltros(TODOS, OPCIONES)).toEqual({
      todos: 5, pendientes: 2, hoy: 3, porjugar: 4,
    })
  })

  it('devuelve una entrada por cada filtro declarado', () => {
    const c = contarFiltros([], OPCIONES)
    for (const f of FILTROS) expect(c[f.id]).toBe(0)
    expect(c[FILTRO_TODOS]).toBe(0)
  })
})

describe('filtroEfectivo', () => {
  const conteos = contarFiltros(TODOS, OPCIONES)

  it('respeta el filtro elegido cuando tiene partidos', () => {
    expect(filtroEfectivo('hoy', conteos)).toBe('hoy')
  })

  /* Lo que evita la pantalla en blanco: elegiste «Hoy» en la jornada 1 y te
     pasaste a la 5, donde hoy no se juega nada. */
  it('cae a «todos» cuando el filtro elegido se quedó sin partidos', () => {
    expect(filtroEfectivo('hoy', { todos: 3, pendientes: 0, hoy: 0, porjugar: 3 })).toBe(FILTRO_TODOS)
  })

  it('un filtro que no existe cae a «todos»', () => {
    expect(filtroEfectivo('inventado', conteos)).toBe(FILTRO_TODOS)
    expect(filtroEfectivo(null, conteos)).toBe(FILTRO_TODOS)
  })
})
