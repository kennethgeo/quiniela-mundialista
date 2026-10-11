/* El service worker de push SIEMPRE muestra un aviso (10 oct 2026).
   Safari en iPhone revoca la suscripción de un sitio que recibe pushes sin
   mostrar nada; antes un payload vacío o que no era JSON no mostraba nada.
   Se corre el archivo real de `public/` con un `self` falso. */
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const FUENTE = readFileSync(new URL('../../public/push-sw.js', import.meta.url), 'utf8')

function cargar () {
  const manejadores = {}
  const mostrados = []
  const self = {
    addEventListener: (tipo, fn) => { manejadores[tipo] = fn },
    registration: { showNotification: async (titulo, opciones) => { mostrados.push({ titulo, ...opciones }) } },
  }
  runInNewContext(FUENTE, { self, clients: {}, console: { error: () => {} } })
  const empujar = async (data) => {
    let espera = null
    manejadores.push({ data, waitUntil: (p) => { espera = p } })
    expect(espera, 'sin waitUntil el navegador puede cortar el aviso').not.toBeNull()
    await espera
  }
  return { empujar, mostrados }
}

const datos = (texto) => ({
  json: () => JSON.parse(texto),
  text: () => texto,
})

describe('push-sw.js', () => {
  it('muestra el aviso que manda el backend', async () => {
    const { empujar, mostrados } = cargar()
    await empujar(datos(JSON.stringify({ title: '⚽ Arranca en 45 min', body: '14:00 A vs B', url: '/q/1' })))
    expect(mostrados).toHaveLength(1)
    expect(mostrados[0]).toMatchObject({ titulo: '⚽ Arranca en 45 min', body: '14:00 A vs B', data: { url: '/q/1' } })
  })

  it('un push SIN datos igual muestra algo', async () => {
    const { empujar, mostrados } = cargar()
    await empujar(null)
    expect(mostrados).toHaveLength(1)
    expect(mostrados[0].titulo).toBe('Tico Games')
  })

  it('un push que no es JSON muestra su texto', async () => {
    const { empujar, mostrados } = cargar()
    await empujar(datos('hola'))
    expect(mostrados).toHaveLength(1)
    expect(mostrados[0].body).toBe('hola')
  })
})
