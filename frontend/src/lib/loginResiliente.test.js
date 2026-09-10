import { describe, it, expect, vi } from 'vitest'
import { conLimite, describirFallo, TiempoAgotado, mensajeDeFallo } from './loginResiliente'

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

describe('mensajeDeFallo', () => {
  /* Lo que el dueño vio en el celular: una alerta que decía «Network request
     failed». En inglés, técnica, y apuntando al lado equivocado — parece que
     la app está caída cuando lo que falló fue la red del teléfono. */
  it('un fallo de red se explica en español y dice qué hacer', () => {
    const texto = mensajeDeFallo(new TypeError('Network request failed'))
    expect(texto).toMatch(/internet/i)
    expect(texto).not.toMatch(/network request failed/i)
  })

  it('las otras formas en que los navegadores dicen «no hay red» dan lo mismo', () => {
    // Chrome, Safari y WebKit escriben esto distinto cada uno.
    const variantes = ['Failed to fetch', 'Load failed', 'Network request failed']
    const textos = variantes.map((m) => mensajeDeFallo(new TypeError(m)))
    expect(new Set(textos).size).toBe(1)
    expect(textos[0]).toMatch(/internet/i)
  })

  it('credenciales inválidas se dicen en español', () => {
    expect(mensajeDeFallo(new Error('Invalid login credentials')))
      .toMatch(/credenciales/i)
  })

  /* La pantalla comparaba el texto EXACTO en inglés. Basta una mayúscula
     distinta del servidor para que volviera a salir el mensaje crudo. */
  it('no depende de que el servidor escriba el texto igual', () => {
    expect(mensajeDeFallo(new Error('invalid login credentials')))
      .toMatch(/credenciales/i)
  })

  it('el correo sin confirmar se explica, no se muestra en inglés', () => {
    const texto = mensajeDeFallo(new Error('Email not confirmed'))
    expect(texto).toMatch(/confirmar/i)
    expect(texto).not.toMatch(/email not confirmed/i)
  })

  it('un error ya redactado por nosotros se respeta tal cual', () => {
    const err = new Error('La conexión está tardando demasiado. Revisá tu internet y probá de nuevo.')
    err.recuperable = true
    expect(mensajeDeFallo(err)).toBe(err.message)
  })

  /* Ni tragarse el error ni escupir el mensaje del servidor: se enseña la
     categoría, que es lo mismo que guardan los logs y no lleva datos. */
  it('un caso desconocido dice algo útil sin filtrar el mensaje del servidor', () => {
    const err = new Error('duplicate key value violates unique constraint "algo"')
    err.status = 500
    const texto = mensajeDeFallo(err)
    expect(texto).toMatch(/no pudimos iniciar sesión/i)
    expect(texto).toContain('http-500')
    expect(texto).not.toMatch(/duplicate key/i)
  })
})
