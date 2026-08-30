import { describe, it, expect, vi, afterEach } from 'vitest'
import { compartirImagen } from './shareCard'

/* Solo se prueba compartirImagen: es la parte con ramas de verdad. Dibujar el
   canvas no se prueba acá porque necesitaría un navegador — eso se verifica
   generando el PNG a mano.

   Las pruebas corren en Node (no hay jsdom en el proyecto), así que se simula
   lo mínimo que la función toca: navigator, File, URL y el <a> de la descarga.
   Simular de más escondería justo lo que se quiere ver. */

const blob = { size: 10, type: 'image/png' }

function montar({ acepta = () => true, share = vi.fn() } = {}) {
  const ancla = { href: '', download: '', click: vi.fn() }
  vi.stubGlobal('navigator', { canShare: (c) => acepta(c), share })
  vi.stubGlobal('File', class {
    constructor(partes, nombre, opts) { Object.assign(this, { partes, nombre, ...opts }) }
  })
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() })
  vi.stubGlobal('document', { createElement: () => ancla })
  return { share, ancla }
}

describe('compartirImagen', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('manda la imagen con el texto de pie de foto cuando el navegador lo acepta', async () => {
    const { share } = montar()
    const r = await compartirImagen(blob, 'p.png', 'Título', 'Partidos de hoy · https://app')
    expect(r).toBe('compartido')
    expect(share).toHaveBeenCalledTimes(1)
    expect(share.mock.calls[0][0]).toMatchObject({
      title: 'Título', text: 'Partidos de hoy · https://app',
    })
    expect(share.mock.calls[0][0].files).toHaveLength(1)
  })

  it('si el navegador rechaza archivo+texto, manda al menos la imagen', async () => {
    // Hay navegadores que aceptan { files } pero no { files, text }.
    const { share } = montar({ acepta: (c) => !('text' in c) })
    const r = await compartirImagen(blob, 'p.png', 'Título', 'con enlace')
    expect(r).toBe('compartido')
    expect(share).toHaveBeenCalledTimes(1)
    expect(share.mock.calls[0][0].text).toBeUndefined()
  })

  it('descarga cuando el navegador no comparte archivos (escritorio)', async () => {
    const { share, ancla } = montar({ acepta: () => false })
    const r = await compartirImagen(blob, 'p.png', 'p.png', 'txt')
    expect(r).toBe('descargado')
    expect(share).not.toHaveBeenCalled()
    expect(ancla.click).toHaveBeenCalled()
    expect(ancla.download).toBe('p.png')
  })

  it('cancelar la hoja de compartir no descarga nada por detrás', async () => {
    const abortar = Object.assign(new Error('cancelado'), { name: 'AbortError' })
    const { ancla } = montar({ share: vi.fn().mockRejectedValue(abortar) })
    const r = await compartirImagen(blob, 'p.png', 'Título', 'txt')
    expect(r).toBe('cancelado')
    expect(ancla.click).not.toHaveBeenCalled()
  })

  it('si compartir falla por otro motivo, reintenta sin texto y luego descarga', async () => {
    const { share, ancla } = montar({ share: vi.fn().mockRejectedValue(new Error('vaya')) })
    const r = await compartirImagen(blob, 'p.png', 'p.png', 'txt')
    expect(r).toBe('descargado')
    expect(share).toHaveBeenCalledTimes(2)
    expect(ancla.click).toHaveBeenCalled()
  })

  it('sin texto manda solo la imagen, sin intentar dos veces', async () => {
    const { share } = montar()
    const r = await compartirImagen(blob, 'p.png', 'Título')
    expect(r).toBe('compartido')
    expect(share).toHaveBeenCalledTimes(1)
    expect(share.mock.calls[0][0].text).toBeUndefined()
  })
})
