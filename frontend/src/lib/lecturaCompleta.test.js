import { expect, it, vi } from 'vitest'
import { leerTodasLasFilas } from './lecturaCompleta'

function fuente(filas, { limite = 500, fallo = -1, sinConteo = false, cambia = false } = {}) {
  const rangos = []
  const consultar = () => ({
    range(desde, hasta) {
      rangos.push([desde, hasta])
      return Promise.resolve({
        data: filas.slice(desde, Math.min(hasta + 1, desde + limite)),
        count: sinConteo ? null : filas.length + (cambia && desde > 0 ? 1 : 0),
        error: desde === fallo ? new Error('Fallo intermedio') : null,
      })
    },
  })
  return { consultar, rangos }
}
const filas = Array.from({ length: 1250 }, (_, id) => ({ id }))

it('recupera más de mil filas aunque el servidor reduzca el tamaño de página', async () => {
  const { consultar, rangos } = fuente(filas, { limite: 200 })
  await expect(leerTodasLasFilas(consultar)).resolves.toEqual(filas)
  expect(rangos.map(r => r[0])).toEqual([0, 200, 400, 600, 800, 1000, 1200])
})
it('no devuelve un prefijo si falla otra página', async () => {
  const { consultar } = fuente(filas, { fallo: 500 })
  await expect(leerTodasLasFilas(consultar)).rejects.toThrow('Fallo intermedio')
})
it('rechaza conteos que cambian durante la lectura', async () => {
  const { consultar } = fuente(filas, { cambia: true })
  await expect(leerTodasLasFilas(consultar)).rejects.toThrow('cambió')
})
it('no acepta una respuesta truncada sin conteo exacto', async () => {
  const { consultar } = fuente(filas, { sinConteo: true })
  await expect(leerTodasLasFilas(consultar)).rejects.toThrow('completa')
})
it('acepta una lista vacía', async () => {
  await expect(leerTodasLasFilas(fuente([]).consultar)).resolves.toEqual([])
})
it('detiene páginas repetidas en lugar de duplicar estadísticas', async () => {
  const consultar = () => ({ range: () => Promise.resolve({ data: [{ id: 1 }], count: 2 }) })
  await expect(leerTodasLasFilas(consultar)).rejects.toThrow('repetidas')
})
it('no anuncia éxito si el servidor corta la lista antes del conteo', async () => {
  const consultar = () => ({ range: () => Promise.resolve({ data: [], count: 2 }) })
  await expect(leerTodasLasFilas(consultar)).rejects.toThrow('Faltan filas')
})
it('rechaza un volumen excesivo antes de acumularlo', async () => {
  await expect(leerTodasLasFilas(fuente(filas).consultar, { maximo: 100 })).rejects.toThrow('demasiado grande')
})
it('una cancelación no publica datos ni inicia otra petición', async () => {
  const controller = new AbortController()
  controller.abort()
  const consultar = vi.fn()
  await expect(leerTodasLasFilas(consultar, { signal: controller.signal })).rejects.toThrow()
  expect(consultar).not.toHaveBeenCalled()
})
