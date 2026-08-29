import { describe, it, expect, vi } from 'vitest'
import { conLimite, describirFallo, TiempoAgotado } from './loginResiliente'

describe('conLimite', () => {
  it('devuelve el valor si la promesa gana', async () => {
    await expect(conLimite(Promise.resolve('listo'), 50, 'x')).resolves.toBe('listo')
  })

  it('propaga el error real si la promesa falla antes del plazo', async () => {
    const fallo = new Error('credenciales')
    await expect(conLimite(Promise.reject(fallo), 50, 'x')).rejects.toBe(fallo)
  })

  it('rechaza con TiempoAgotado si la promesa nunca resuelve', async () => {
    vi.useFakeTimers()
    const nunca = new Promise(() => {})
    const carrera = conLimite(nunca, 1000, 'login')
    const esperado = expect(carrera).rejects.toBeInstanceOf(TiempoAgotado)
    await vi.advanceTimersByTimeAsync(1000)
    await esperado
    vi.useRealTimers()
  })

  it('marca el error con esTiempoAgotado para poder distinguirlo', async () => {
    vi.useFakeTimers()
    const carrera = conLimite(new Promise(() => {}), 100, 'login')
    const esperado = expect(carrera).rejects.toMatchObject({ esTiempoAgotado: true })
    await vi.advanceTimersByTimeAsync(100)
    await esperado
    vi.useRealTimers()
  })

  it('limpia el temporizador cuando gana la promesa', async () => {
    vi.useFakeTimers()
    const limpiar = vi.spyOn(globalThis, 'clearTimeout')
    await conLimite(Promise.resolve(1), 5000, 'x')
    expect(limpiar).toHaveBeenCalled()
    limpiar.mockRestore()
    vi.useRealTimers()
  })
})

describe('describirFallo', () => {
  it('no filtra el mensaje crudo del servidor', () => {
    const err = new Error('correo kg@ejemplo.com con token abc123 rechazado')
    expect(describirFallo(err)).not.toContain('kg@ejemplo.com')
    expect(describirFallo(err)).not.toContain('abc123')
  })

  it('reconoce las categorías que nos importan', () => {
    expect(describirFallo(new TiempoAgotado('x'))).toBe('tiempo-agotado')
    expect(describirFallo(new Error('Invalid login credentials'))).toBe('credenciales')
    expect(describirFallo(new Error('Email not confirmed'))).toBe('correo-sin-confirmar')
    expect(describirFallo(new Error('Failed to fetch'))).toBe('red')
    expect(describirFallo(new Error('Load failed'))).toBe('red')
  })

  it('usa el código HTTP cuando lo hay', () => {
    const err = new Error('vaya')
    err.status = 429
    expect(describirFallo(err)).toBe('http-429')
  })

  it('aguanta un fallo vacío', () => {
    expect(describirFallo(null)).toBe('desconocido')
    expect(describirFallo(undefined)).toBe('desconocido')
  })
})
