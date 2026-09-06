/* Lo que se cuida acá: la puerta estaba abierta (la consulta a una columna
   inexistente fallaba y el catch dejaba pasar a todos), pero cerrarla de más
   dejaría afuera a gente legítima. Por eso hay tres estados y no dos. */
import { describe, it, expect } from 'vitest'
import { estadoVerificacionCorreo, puedeEntrar, verificarConAuth } from './verificacionCorreo'

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

  it('forma inesperada requiere comprobar Auth antes de entrar', () => {
    expect(puedeEntrar({ id: 'x' })).toBe(false)
  })

  it('sin sesión no entra (lo resuelve el redirect a /auth)', () => {
    expect(puedeEntrar(null)).toBe(false)
  })
})

 it.each([{ email_confirmed_at: null }, { confirmed_at: null }])('null explícito no se pierde si falta el campo alternativo: %j', user => {
  expect(estadoVerificacionCorreo(user)).toBe('sin-verificar')
  expect(puedeEntrar(user)).toBe(false)
 })
 it('completa un objeto incompleto consultando Auth', async () => {
  expect(await verificarConAuth({ id: 'A' }, async () => ({ data: { user: { id: 'A', email_confirmed_at: '2026-01-01' } } }))).toBe('verificado')
 })
 it.each([
  { data: { user: { id: 'B', email_confirmed_at: '2026-01-01' } } },
  { error: new Error('red') },
  { data: { user: { id: 'A' } } },
 ])('no autoriza respuestas de otra cuenta, inciertas o fallidas', async response => {
  await expect(verificarConAuth({ id: 'A' }, async () => response)).rejects.toThrow()
 })
