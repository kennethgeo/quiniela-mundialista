/* ¿Se pregunta «quién pasa por penales»? El porqué está en lib/penales.js.
   Los `stage` son los que escribe el sync de ESPN (« · » + la pierna) y los
   que ya hay en la base: el Mundial trae `stage` nulo y la fase en `phase`. */
import { describe, it, expect } from 'vitest'
import { esIda, puedeIrAPenales, tandaQueSeGuarda } from './penales'

const ko = (stage) => ({ phase: 'knockout', stage })

describe('puedeIrAPenales', () => {
  it('la fase regular nunca va a penales', () => {
    expect(puedeIrAPenales({ phase: 'groups', stage: 'Jornada 7' })).toBe(false)
  })

  it('una eliminatoria del Mundial (stage nulo) sí', () => {
    expect(puedeIrAPenales({ phase: 'round_of_16', stage: null })).toBe(true)
    expect(puedeIrAPenales({ phase: 'final', stage: null })).toBe(true)
  })

  it('una final única y la vuelta sí', () => {
    expect(puedeIrAPenales(ko('Final'))).toBe(true)
    expect(puedeIrAPenales(ko('Gran final'))).toBe(true)
    expect(puedeIrAPenales(ko('Semifinal · Vuelta'))).toBe(true)
  })

  it('la ida NO, con la pierna traducida o con la nota cruda de antes', () => {
    expect(puedeIrAPenales(ko('Semifinal · Ida'))).toBe(false)
    expect(puedeIrAPenales(ko('Octavos · Ida'))).toBe(false)
    expect(puedeIrAPenales(ko('Semifinal · 1st Leg'))).toBe(false)
    expect(puedeIrAPenales(ko('Final · 1st Leg - Saprissa leads 2-1'))).toBe(false)
  })

  it('una ronda cuyo nombre contiene «ida» no es una ida', () => {
    // «Liguilla», «Partida»…: lo que manda es la pierna después del « · ».
    expect(esIda(ko('Liguilla'))).toBe(false)
    expect(esIda(ko('Semifinal · 2nd Leg - Saprissa advance 4-2 on aggregate'))).toBe(false)
  })
})

describe('tandaQueSeGuarda', () => {
  it('empate en un partido que puede ir a penales: se guarda la elección', () => {
    expect(tandaQueSeGuarda(ko('Final'), 1, 1, 'Saprissa')).toBe('Saprissa')
  })

  it('empate en una ida: null, aunque haya una elección vieja guardada', () => {
    expect(tandaQueSeGuarda(ko('Semifinal · Ida'), 1, 1, 'Saprissa')).toBe(null)
  })

  it('no es empate, o es fase regular: null', () => {
    expect(tandaQueSeGuarda(ko('Final'), 2, 1, 'Saprissa')).toBe(null)
    expect(tandaQueSeGuarda({ phase: 'groups', stage: 'Jornada 1' }, 0, 0, 'Saprissa')).toBe(null)
  })

  it('sin elección: null, no una cadena vacía', () => {
    expect(tandaQueSeGuarda(ko('Final'), 0, 0, '')).toBe(null)
    expect(tandaQueSeGuarda(ko('Final'), 0, 0, undefined)).toBe(null)
  })
})
