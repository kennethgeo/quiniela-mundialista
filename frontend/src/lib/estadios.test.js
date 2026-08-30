import { describe, it, expect } from 'vitest'
import { normalizarEstadio, fotoDeEstadio } from './estadios'

/* Los nombres de esta lista NO son inventados: son los que ESPN devuelve de
   verdad en `venue.fullName`, sacados de los 145 partidos de la temporada 2026
   de la liga tica. La primera versión del mapa dedujo las claves de qué equipo
   juega dónde y falló en tres de once. */
const VENUES_REALES = {
  'Estadio Ricardo Saprissa': '/estadios/saprissa.jpg',
  'Alejandro Morera Soto': '/estadios/morera-soto.jpg',
  'Estadio Carlos Alvarado': '/estadios/carlos-alvarado.jpg',
  'Estadio José Rafael "Fello" Meza Ivankovich': '/estadios/fello-meza.jpg',
  'Estadio Carlos Ugalde Álvarez': '/estadios/carlos-ugalde.jpg',
  'Estadio Lito Pérez': '/estadios/lito-perez.jpg',
  'Estadio Municipal de Pérez Zeledón': '/estadios/perez-zeledon.jpg',
  'Estadio Puente Piedra': '/estadios/puente-piedra.jpg',
  'Estadio Edgardo Baltodano Briceño': '/estadios/baltodano.jpg',
  'Estadio José Joaquín "Colleya" Fonseca': '/estadios/colleya-fonseca.jpg',
  'Estadio Rafael Bolaños': '/estadios/rafael-bolanos.jpg',
}

describe('fotoDeEstadio con los nombres que manda ESPN', () => {
  for (const [venue, esperado] of Object.entries(VENUES_REALES)) {
    it(`encuentra la foto de ${venue}`, () => {
      expect(fotoDeEstadio(venue)).toBe(esperado)
    })
  }

  it('cubre el Nacional, que se usa cuando sancionan un estadio', () => {
    expect(fotoDeEstadio('Estadio Nacional de Costa Rica')).toBe('/estadios/nacional.jpg')
  })

  it('devuelve null si ESPN no manda estadio, que pasa de vez en cuando', () => {
    // Visto en 2 de los 145 partidos de la temporada.
    expect(fotoDeEstadio(null)).toBeNull()
    expect(fotoDeEstadio(undefined)).toBeNull()
    expect(fotoDeEstadio('')).toBeNull()
  })

  it('no inventa una foto para un estadio que no conocemos', () => {
    expect(fotoDeEstadio('Estadio Azteca')).toBeNull()
  })
})

describe('normalizarEstadio', () => {
  it('iguala las grafías del mismo estadio', () => {
    const esperado = 'estadio ricardo saprissa ayma'
    expect(normalizarEstadio('Estadio Ricardo Saprissa Aymá')).toBe(esperado)
    expect(normalizarEstadio('ESTADIO RICARDO SAPRISSA AYMA')).toBe(esperado)
    expect(normalizarEstadio('  Estadio   Ricardo  Saprissa   Aymá  ')).toBe(esperado)
  })

  it('quita la puntuación sin pegar las palabras', () => {
    // Este caso es real: ESPN manda las comillas alrededor de "Fello".
    expect(normalizarEstadio('Estadio José Rafael "Fello" Meza Ivankovich'))
      .toBe('estadio jose rafael fello meza ivankovich')
  })

  it('aguanta valores vacíos', () => {
    expect(normalizarEstadio(null)).toBe('')
    expect(normalizarEstadio('')).toBe('')
  })
})
