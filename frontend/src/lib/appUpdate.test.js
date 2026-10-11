/* La recarga automática del ErrorBoundary no vacía el precache de Workbox
   (revisión del 11 oct 2026): sin él, la PWA instalada no abre sin conexión
   hasta el próximo despliegue. La herramienta manual del Perfil sí borra todo. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { refreshApplication } from './appUpdate'

function entorno () {
  const borrados = []
  vi.stubGlobal('caches', {
    keys: async () => ['workbox-precache-v2-https://x/', 'imagenes', 'api'],
    delete: async (k) => { borrados.push(k); return true },
  })
  vi.stubGlobal('location', { reload: vi.fn() })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker: { getRegistrations: async () => [{ update: async () => {} }] } } })
  vi.stubGlobal('window', { location: globalThis.location })
  return borrados
}

afterEach(() => vi.unstubAllGlobals())

describe('refreshApplication', () => {
  it('desde el ErrorBoundary conserva el precache', async () => {
    const borrados = entorno()
    await refreshApplication({ conservarPrecache: true })
    expect(borrados).toEqual(['imagenes', 'api'])
  })

  it('la herramienta manual borra todo', async () => {
    const borrados = entorno()
    await refreshApplication()
    expect(borrados).toHaveLength(3)
  })
})
