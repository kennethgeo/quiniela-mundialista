import { describe, expect, it } from 'vitest'
import { friendlySaveError } from './saveError'

describe('friendlySaveError', () => {
  // Migración 100: si la base cancela el guardado por un cruce, no se muestra
  // «deadlock detected» en inglés: se dice qué pasó y que se puede reintentar.
  it('un guardado cancelado por un cruce invita a reintentar', () => {
    const m = friendlySaveError({ code: '40P01', message: 'deadlock detected' })
    expect(m).toMatch(/Intentá de nuevo/)
    expect(m).not.toMatch(/deadlock/)
  })

  it('el rechazo por RLS sigue diciendo que el partido está cerrado', () => {
    expect(friendlySaveError({ code: '42501', message: 'x' })).toMatch(/cerrado/)
  })

  it('el límite de ×2 se muestra tal cual', () => {
    const msg = 'Límite de comodines x2 alcanzado para esta jornada.'
    expect(friendlySaveError({ message: msg })).toBe(msg)
  })
})
