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
