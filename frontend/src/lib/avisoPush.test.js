/* Cuándo se ofrece el aviso de notificaciones.

   Lo que se prueba acá es la DECISIÓN, no el envío: el resto (permisos,
   service worker, suscripción) es del navegador y no se puede simular con
   honestidad en vitest. Lo que sí puede fallar en silencio es ofrecerle el
   aviso a quien ya tiene avisos, o seguir insistiéndole a quien lo cerró. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  debeOfrecerse, posponerAviso, avisoPospuesto, CLAVE_POSPUESTO,
} from './avisoPush'

describe('debeOfrecerse', () => {
  it('no se ofrece si el navegador no admite push', () => {
    expect(debeOfrecerse({ permiso: null, suscrito: false, pospuesto: false })).toBe(false)
  })

  it('no se ofrece a quien YA tiene avisos en este dispositivo', () => {
    expect(debeOfrecerse({ permiso: 'granted', suscrito: true, pospuesto: false })).toBe(false)
  })

  it('SÍ se ofrece con permiso concedido pero sin suscripción', () => {
    /* Pasa al actualizar la app o el service worker: el permiso sigue, la
       suscripción se perdió. Esa persona cree tener avisos y no le llega
       ninguno, así que es justamente a quien hay que ofrecerle. */
    expect(debeOfrecerse({ permiso: 'granted', suscrito: false, pospuesto: false })).toBe(true)
  })

  it('se ofrece a quien nunca decidió', () => {
    expect(debeOfrecerse({ permiso: 'default', suscrito: false, pospuesto: false })).toBe(true)
  })

  it('se ofrece a quien los tiene bloqueados, pero para explicarle cómo', () => {
    // El componente muestra las instrucciones y NO un botón que no puede
    // funcionar: el navegador ya no vuelve a preguntar.
    expect(debeOfrecerse({ permiso: 'denied', suscrito: false, pospuesto: false })).toBe(true)
  })

  it('no se insiste a quien lo pospuso', () => {
    expect(debeOfrecerse({ permiso: 'default', suscrito: false, pospuesto: true })).toBe(false)
  })
})

describe('posponer', () => {
  const almacen = {}
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k) => (k in almacen ? almacen[k] : null),
      setItem: (k, v) => { almacen[k] = String(v) },
    })
    for (const k of Object.keys(almacen)) delete almacen[k]
  })
  afterEach(() => vi.unstubAllGlobals())

  it('sin nada guardado, se ofrece', () => {
    expect(avisoPospuesto()).toBe(false)
  })

  it('recién pospuesto, no se ofrece', () => {
    const ahora = Date.UTC(2026, 8, 8)
    posponerAviso(ahora)
    expect(avisoPospuesto(ahora + 1000)).toBe(true)
  })

  it('a los 13 días sigue pospuesto; a los 15 vuelve', () => {
    /* Vuelve a propósito: alguien que lo cerró sin pensar no debería quedarse
       sin avisos toda la temporada. Pero no antes de dos semanas, porque un
       aviso que reaparece siempre hace que se apaguen TODAS las
       notificaciones. */
    const ahora = Date.UTC(2026, 8, 8)
    const dia = 24 * 60 * 60 * 1000
    posponerAviso(ahora)
    expect(avisoPospuesto(ahora + 13 * dia)).toBe(true)
    expect(avisoPospuesto(ahora + 15 * dia)).toBe(false)
  })

  it('un valor corrupto no deja a nadie sin aviso para siempre', () => {
    almacen[CLAVE_POSPUESTO] = 'cualquier cosa'
    expect(avisoPospuesto()).toBe(false)
  })

  it('si localStorage no se puede leer, se ofrece igual', () => {
    // Modo privado: el acceso lanza. Preferimos ofrecer de más que perder a
    // alguien por una excepción del navegador.
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('bloqueado') },
      setItem: () => { throw new Error('bloqueado') },
    })
    expect(avisoPospuesto()).toBe(false)
    expect(() => posponerAviso()).not.toThrow()
  })
})
