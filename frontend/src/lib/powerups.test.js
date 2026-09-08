/* La llave de cupo del navegador tiene que dar EXACTAMENTE lo mismo que
   `clave_fase` + jornada en Postgres. Los casos de abajo son los mismos que
   verifica la migración 73 en su bloque final: si alguien cambia una de las
   dos definiciones, una de las dos comprobaciones cae. */
import { describe, expect, it } from 'vitest'
import { claveDeFase, powerupKey, llaveDeCupo } from './powerups'

describe('claveDeFase — espejo de clave_fase() en Postgres', () => {
  it('la fase regular es siempre "groups", venga como venga', () => {
    expect(claveDeFase('groups', 'Jornada 7')).toBe('groups')
    expect(claveDeFase(null, null)).toBe('groups')
    expect(claveDeFase(undefined, 'Jornada 1')).toBe('groups')
  })

  it('una fase específica es su propia clave (Mundial)', () => {
    expect(claveDeFase('round_of_16', null)).toBe('round_of_16')
    expect(claveDeFase('semi_finals', null)).toBe('semi_finals')
    expect(claveDeFase('third_place', null)).toBe('third_place')
    expect(claveDeFase('final', null)).toBe('final')
  })

  it('con "knockout" manda la etiqueta, recortada en " · " (liga tica, Champions)', () => {
    // El cupo es de la RONDA: ida y vuelta comparten bolsa.
    expect(claveDeFase('knockout', 'Octavos · Ida')).toBe('Octavos')
    expect(claveDeFase('knockout', 'Octavos · Vuelta')).toBe('Octavos')
    expect(claveDeFase('knockout', 'Semifinal')).toBe('Semifinal')
    expect(claveDeFase('knockout', 'Gran final · Ida')).toBe('Gran final')
  })

  it('sin etiqueta cae en "knockout", que es una bolsa válida y no un vacío', () => {
    expect(claveDeFase('knockout', null)).toBe('knockout')
    expect(claveDeFase('knockout', '')).toBe('knockout')
  })
})

describe('powerupKey', () => {
  it('separa las jornadas de la fase regular', () => {
    expect(powerupKey('groups', 1)).toBe('groups|1')
    expect(powerupKey('groups', 2)).toBe('groups|2')
    expect(powerupKey('groups', 1)).not.toBe(powerupKey('groups', 2))
  })

  it('no mezcla tercer puesto y final', () => {
    expect(powerupKey('third_place', 0)).not.toBe(powerupKey('final', 0))
  })

  it('EL BUG: semifinal y final de una liga ya no comparten bolsa', () => {
    // Las dos llegan con phase='knockout' y jornada nula. Antes daban la misma
    // llave, así que gastar el cupo en semis dejaba la final sin comodines.
    const semi = powerupKey('knockout', null, 'Semifinal · Ida')
    const fin = powerupKey('knockout', null, 'Final · Vuelta')
    expect(semi).toBe('Semifinal|0')
    expect(fin).toBe('Final|0')
    expect(semi).not.toBe(fin)
  })

  it('la jornada nula y la cero son la misma bolsa, como COALESCE(matchday,0)', () => {
    expect(powerupKey('final', null)).toBe(powerupKey('final', 0))
  })
})

describe('llaveDeCupo', () => {
  it('saca la llave del partido entero, sin olvidar stage', () => {
    expect(llaveDeCupo({ phase: 'knockout', stage: 'Cuartos · Ida', matchday: null }))
      .toBe('Cuartos|0')
    expect(llaveDeCupo({ phase: 'groups', stage: 'Jornada 3', matchday: 3 }))
      .toBe('groups|3')
  })

  it('un partido vacío no revienta la pantalla', () => {
    expect(llaveDeCupo(undefined)).toBe('groups|0')
    expect(llaveDeCupo({})).toBe('groups|0')
  })
})

/* La pantalla busca el cupo en el mapa que devuelve `cupos_por_jornada`, y ese
   mapa viene con la CLAVE DE FASE (migración 73). Componer la llave a mano con
   `m.phase` daba «knockout|0» contra un mapa que tiene «Semifinal|0»: no
   encontraba nada y caía al cupo general, o sea la pantalla mostraba un número
   que el trigger no aplica — el fallo que este repo persigue desde la 48.

   En fase de grupos las dos formas coinciden, por eso no se veía. */
describe('la llave de la pantalla coincide con la del mapa de cupos', () => {
  // Tal como lo devuelve la RPC: llave = clave de fase + jornada.
  const mapa = { 'groups|1': 3, 'Semifinal|0': 2, 'Final|0': 1, 'round_of_16|0': 4 }
  const cupoDe = (m, fijo = 9) => mapa[llaveDeCupo(m)] ?? fijo

  it('la fase regular encuentra su cupo', () => {
    expect(cupoDe({ phase: 'groups', stage: 'Jornada 1', matchday: 1 })).toBe(3)
  })

  it('EL BUG: una eliminatoria de liga encontraba el cupo, no el general', () => {
    expect(cupoDe({ phase: 'knockout', stage: 'Semifinal · Ida', matchday: null })).toBe(2)
    expect(cupoDe({ phase: 'knockout', stage: 'Final · Vuelta', matchday: null })).toBe(1)
  })

  it('las rondas del Mundial también', () => {
    expect(cupoDe({ phase: 'round_of_16', stage: null, matchday: null })).toBe(4)
  })

  it('una fase sin cupo propio cae al número fijo, no a cero', () => {
    expect(cupoDe({ phase: 'knockout', stage: 'Cuartos', matchday: null })).toBe(9)
  })
})
