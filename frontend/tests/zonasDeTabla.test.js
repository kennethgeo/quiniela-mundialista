/* Las zonas de clasificación de la tabla de posiciones.

   Lo que se protege acá es lo contrario de lo habitual: que NO se dibuje un
   corte donde no lo hay. Marcar «los 4 primeros» en una liga sin liguilla se
   lee como que tu equipo está clasificando, y eso es peor que no pintar nada.
*/
import { describe, expect, it } from 'vitest'
import { ZONAS_POR_TORNEO, esFinDeZona, zonaDe, zonasDe } from '../src/lib/zonasDeTabla'

describe('zonaDe', () => {
  it('la liga tica corta en cuatro: se juegan dos semifinales', () => {
    expect(zonaDe('crc.1', 4)?.etiqueta).toBe('Liguilla')
    expect(zonaDe('crc.1', 5)).toBeNull()
  })

  it('la Champions distingue el directo del repechaje', () => {
    expect(zonaDe('uefa.champions', 8)?.etiqueta).toBe('Octavos')
    expect(zonaDe('uefa.champions', 9)?.etiqueta).toBe('Repechaje')
    expect(zonaDe('uefa.champions', 24)?.etiqueta).toBe('Repechaje')
    expect(zonaDe('uefa.champions', 25)).toBeNull()
  })

  it('en el Mundial el tercero es «puede», no «clasifica»', () => {
    expect(zonaDe('fifa.world', 2)?.etiqueta).toBe('Clasifica')
    expect(zonaDe('fifa.world', 3)?.etiqueta).toBe('Mejor tercero')
    expect(zonaDe('fifa.world', 4)).toBeNull()
  })

  /* EL CASO QUE JUSTIFICA EL MAPA. LaLiga y la Premier no tienen liguilla, y
     sus cupos europeos cambian de temporada y dependen de la copa: cualquier
     número que pusiéramos sería inventado. */
  it('una liga sin corte conocido no recibe ninguna línea', () => {
    expect(zonaDe('esp.1', 1)).toBeNull()
    expect(zonaDe('eng.1', 4)).toBeNull()
    expect(zonaDe('un.torneo.nuevo', 1)).toBeNull()
    expect(zonaDe(undefined, 1)).toBeNull()
    expect(zonasDe('esp.1')).toEqual([])
  })

  it('sin posición no adivina', () => {
    expect(zonaDe('crc.1', 0)).toBeNull()
    expect(zonaDe('crc.1', undefined)).toBeNull()
  })
})

describe('esFinDeZona', () => {
  it('la raya va debajo del último que clasifica', () => {
    expect(esFinDeZona('crc.1', 4, 10)).toBe(true)
    expect(esFinDeZona('crc.1', 3, 10)).toBe(false)
    expect(esFinDeZona('crc.1', 5, 10)).toBe(false)
  })

  it('la Champions lleva DOS rayas, una por zona', () => {
    expect(esFinDeZona('uefa.champions', 8, 36)).toBe(true)
    expect(esFinDeZona('uefa.champions', 24, 36)).toBe(true)
    expect(esFinDeZona('uefa.champions', 12, 36)).toBe(false)
  })

  /* Una raya debajo del ÚLTIMO equipo es una raya al aire: no separa nada.
     Ojo con el caso de al lado, que me equivoqué al escribir esta prueba: en
     un grupo de 4 del Mundial la raya bajo el 3º SÍ separa algo —el que puede
     clasificar del eliminado—, así que esa va. */
  it('nunca se dibuja debajo del último equipo', () => {
    expect(esFinDeZona('crc.1', 4, 4)).toBe(false)
    expect(esFinDeZona('fifa.world', 2, 2)).toBe(false)
  })

  it('pero sí entre el que puede clasificar y el eliminado', () => {
    expect(esFinDeZona('fifa.world', 3, 4)).toBe(true)
  })

  it('sin corte conocido no hay raya', () => {
    expect(esFinDeZona('esp.1', 4, 20)).toBe(false)
  })
})

describe('el mapa', () => {
  /* Las zonas de un torneo se recorren en orden y la primera que abarca la
     posición gana, así que tienen que ir de menor a mayor. Al revés, el 8 de
     la Champions caería en «Repechaje». */
  it('las zonas de cada torneo van de menor a mayor', () => {
    for (const [ref, zonas] of Object.entries(ZONAS_POR_TORNEO)) {
      const cortes = zonas.map((z) => z.hasta)
      expect(cortes, `${ref} tiene las zonas desordenadas`).toEqual([...cortes].sort((a, b) => a - b))
    }
  })

  it('cada zona dice algo y tiene un tono conocido', () => {
    for (const zonas of Object.values(ZONAS_POR_TORNEO)) {
      for (const z of zonas) {
        expect(z.etiqueta.length).toBeGreaterThan(0)
        expect(['clasifica', 'repesca']).toContain(z.tono)
      }
    }
  })
})
