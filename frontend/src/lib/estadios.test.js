import { describe, it, expect } from 'vitest'
import { normalizarEstadio, fotoDeEstadio } from './estadios'

describe('normalizarEstadio', () => {
  it('iguala las grafías que manda la fuente para el mismo estadio', () => {
    // ESPN escribe el mismo estadio con y sin tildes, y con mayúsculas.
    const esperado = 'estadio ricardo saprissa ayma'
    expect(normalizarEstadio('Estadio Ricardo Saprissa Aymá')).toBe(esperado)
    expect(normalizarEstadio('ESTADIO RICARDO SAPRISSA AYMA')).toBe(esperado)
    expect(normalizarEstadio('  Estadio   Ricardo  Saprissa   Aymá  ')).toBe(esperado)
  })

  it('quita la puntuación sin pegar las palabras', () => {
    expect(normalizarEstadio('Estadio "Fello" Meza')).toBe('estadio fello meza')
    expect(normalizarEstadio('Morera-Soto')).toBe('morera soto')
  })

  it('aguanta valores vacíos, que es lo que manda ESPN cuando no sabe', () => {
    expect(normalizarEstadio(null)).toBe('')
    expect(normalizarEstadio(undefined)).toBe('')
    expect(normalizarEstadio('')).toBe('')
  })
})

describe('fotoDeEstadio', () => {
  it('devuelve null cuando no tenemos foto: la tarjeta se dibuja sin ella', () => {
    expect(fotoDeEstadio('Estadio que no existe')).toBeNull()
    expect(fotoDeEstadio(null)).toBeNull()
  })
})

describe('fotoDeEstadio empareja por trozo del nombre', () => {
  // No sabemos todavía cómo escribe ESPN cada estadio: el campo `venue` nunca
  // se había guardado. Por eso se empareja por trozo distintivo y no por
  // nombre completo — una tilde de más no puede dejarnos sin foto.
  it('reconoce el mismo estadio escrito de varias formas', () => {
    const esperado = '/estadios/saprissa.jpg'
    expect(fotoDeEstadio('Estadio Ricardo Saprissa Aymá')).toBe(esperado)
    expect(fotoDeEstadio('Ricardo Saprissa')).toBe(esperado)
    expect(fotoDeEstadio('ESTADIO RICARDO SAPRISSA AYMA')).toBe(esperado)
  })

  it('encuentra el Fello Meza con y sin comillas, y con el nombre largo', () => {
    expect(fotoDeEstadio('Estadio "Fello" Meza')).toBe('/estadios/fello-meza.jpg')
    expect(fotoDeEstadio('Estadio José Rafael Fello Meza Ivankovich')).toBe('/estadios/fello-meza.jpg')
  })

  it('cubre la cancha de Grecia, donde Sporting es local esta temporada', () => {
    expect(fotoDeEstadio('Cancha de La Argentina, Grecia')).toBe('/estadios/grecia.jpg')
    expect(fotoDeEstadio('Estadio Allen Riggioni')).toBe('/estadios/grecia.jpg')
  })

  it('no inventa una foto para un estadio que no conocemos', () => {
    expect(fotoDeEstadio('Estadio Azteca')).toBeNull()
  })
})
