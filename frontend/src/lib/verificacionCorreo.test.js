/* Lo que se cuida acá: la puerta estaba abierta (la consulta a una columna
   inexistente fallaba y el catch dejaba pasar a todos), pero cerrarla de más
   dejaría afuera a gente legítima. Por eso hay tres estados y no dos. */
import { describe, it, expect, vi } from 'vitest'
import { estadoVerificacionCorreo, puedeEntrar } from './verificacionCorreo'

describe('estadoVerificacionCorreo', () => {
  it('con timestamp está verificado', () => {
    expect(estadoVerificacionCorreo({ email_confirmed_at: '2026-01-01T00:00:00Z' })).toBe('verificado')
  })

  it('acepta confirmed_at como alternativa (OAuth, teléfono)', () => {
    expect(estadoVerificacionCorreo({ email_confirmed_at: null, confirmed_at: '2026-01-01T00:00:00Z' })).toBe('verificado')
  })

  it('null explícito es sin verificar', () => {
    expect(estadoVerificacionCorreo({ email_confirmed_at: null, confirmed_at: null })).toBe('sin-verificar')
  })

  it('sin las claves es desconocido, no sin-verificar', () => {
    expect(estadoVerificacionCorreo({ id: 'x' })).toBe('desconocido')
  })

  it('sin sesión', () => {
    expect(estadoVerificacionCorreo(null)).toBe('sin-sesion')
  })
})

describe('puedeEntrar', () => {
  it('verificado entra', () => {
    expect(puedeEntrar({ email_confirmed_at: '2026-01-01T00:00:00Z' })).toBe(true)
  })

  // El agujero que esto cierra.
  it('sin verificar NO entra', () => {
    expect(puedeEntrar({ email_confirmed_at: null, confirmed_at: null })).toBe(false)
  })

  // La válvula: no romper lo que hoy funciona.
  it('forma inesperada entra igual, avisando', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(puedeEntrar({ id: 'x' })).toBe(true)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('sin sesión no entra (lo resuelve el redirect a /auth)', () => {
    expect(puedeEntrar(null)).toBe(false)
  })
})
