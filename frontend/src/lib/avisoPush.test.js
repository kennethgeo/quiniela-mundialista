/* Cuándo se ofrece el aviso de notificaciones.

   Lo que se prueba acá es la DECISIÓN, no el envío: el resto (permisos,
   service worker, suscripción) es del navegador y no se puede simular con
   honestidad en vitest. Lo que sí puede fallar en silencio es ofrecerle el
   aviso a quien ya tiene avisos, o seguir insistiéndole a quien lo cerró. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  debeOfrecerse, posponerAviso, avisoPospuesto, CLAVE_POSPUESTO,
  situacionAvisos, olvidarPospuesto,
} from './avisoPush'

describe('situacionAvisos', () => {
  const base = { soporta: true, iosSinInstalar: false, permiso: 'default', suscrito: false }

  it('iPhone sin instalar pide instalar, AUNQUE parezca que no hay soporte', () => {
    /* Safari en iPhone sin instalar no expone Notification ni PushManager.
       Preguntando primero por el soporte, a esa persona no se le decía nunca
       que tenía que instalar la app: el texto existía y no se podía ver. */
    expect(situacionAvisos({ ...base, soporta: false, iosSinInstalar: true, permiso: null })).toBe('ios-instalar')
  })

  it('sin soporte (y sin iOS) no hay nada que ofrecer', () => {
    expect(situacionAvisos({ ...base, soporta: false, permiso: null })).toBe('sin-soporte')
  })

  it('bloqueado, activo y pendiente', () => {
    expect(situacionAvisos({ ...base, permiso: 'denied' })).toBe('bloqueado')
    expect(situacionAvisos({ ...base, permiso: 'granted', suscrito: true })).toBe('activo')
    expect(situacionAvisos({ ...base, permiso: 'default' })).toBe('pendiente')
  })

  it('permiso concedido pero SIN suscripción es pendiente, no activo', () => {
    /* Pasa al actualizar la app o el service worker: el permiso sigue, la
       suscripción se perdió. Esa persona cree tener avisos y no le llega
       ninguno, así que es justamente a quien hay que ofrecerle. */
    expect(situacionAvisos({ ...base, permiso: 'granted', suscrito: false })).toBe('pendiente')
  })
})

describe('debeOfrecerse', () => {
  it('no se ofrece sin soporte ni a quien YA tiene avisos', () => {
    expect(debeOfrecerse({ situacion: 'sin-soporte', pospuesto: false })).toBe(false)
    expect(debeOfrecerse({ situacion: 'activo', pospuesto: false })).toBe(false)
  })

  it('se ofrece a quien nunca decidió, a quien debe instalar y a quien los bloqueó', () => {
    // Al bloqueado el componente le explica cómo, sin un botón que no puede
    // funcionar: el navegador ya no vuelve a preguntar.
    for (const situacion of ['pendiente', 'ios-instalar', 'bloqueado']) {
      expect(debeOfrecerse({ situacion, pospuesto: false }), situacion).toBe(true)
    }
  })

  it('no se insiste a quien lo pospuso', () => {
    expect(debeOfrecerse({ situacion: 'pendiente', pospuesto: true })).toBe(false)
  })
})

describe('posponer', () => {
  const almacen = {}
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k) => (k in almacen ? almacen[k] : null),
      setItem: (k, v) => { almacen[k] = String(v) },
      removeItem: (k) => { delete almacen[k] },
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

  const dia = 24 * 60 * 60 * 1000
  const hora = 60 * 60 * 1000

  it('vuelve la PRÓXIMA vez que entra, no en la misma visita', () => {
    /* Pedido del dueño: insistir cuando la persona vuelva a entrar. Pero
       recargar o volver de un partido no es «volver a entrar»: a las 2 horas
       sigue pospuesto y al día siguiente se ofrece. */
    const ahora = Date.UTC(2026, 8, 8)
    posponerAviso(ahora)
    expect(avisoPospuesto(ahora + 2 * hora)).toBe(true)
    expect(avisoPospuesto(ahora + 19 * hora)).toBe(true)
    expect(avisoPospuesto(ahora + 21 * hora)).toBe(false)
  })

  it('cada «Ahora no» seguido espera más: 1, 3, 7 y 14 días, y ahí se queda', () => {
    /* Quien dijo que no varias veces no quiere que le insistan cada día: eso
       es lo que hace que la gente apague TODAS las notificaciones. Pero
       tampoco se le borra para siempre. */
    let t = Date.UTC(2026, 8, 8)
    const esperas = [1, 3, 7, 14, 14, 14]
    for (const dias of esperas) {
      posponerAviso(t)
      expect(avisoPospuesto(t + (dias - 0.5) * dia), `antes de ${dias} días`).toBe(true)
      t += dias * dia + hora
      expect(avisoPospuesto(t), `después de ${dias} días`).toBe(false)
    }
  })

  it('activar los avisos reinicia la insistencia desde el principio', () => {
    const t = Date.UTC(2026, 8, 8)
    posponerAviso(t); posponerAviso(t); posponerAviso(t)
    olvidarPospuesto()
    expect(avisoPospuesto(t)).toBe(false)
    posponerAviso(t)
    // Si no se hubiera olvidado, este sería el 4.º «Ahora no»: 14 días.
    expect(avisoPospuesto(t + 21 * hora)).toBe(false)
  })

  it('el formato viejo (solo el instante) cuenta como un «Ahora no»', () => {
    /* Hasta sep 2026 se guardaba el número pelado con 14 días fijos. A esa
       gente se le vuelve a ofrecer al día siguiente, que es lo que se quiere. */
    const t = Date.UTC(2026, 8, 8)
    almacen[CLAVE_POSPUESTO] = String(t)
    expect(avisoPospuesto(t + 2 * hora)).toBe(true)
    expect(avisoPospuesto(t + 21 * hora)).toBe(false)
    posponerAviso(t + 21 * hora)
    expect(JSON.parse(almacen[CLAVE_POSPUESTO]).veces).toBe(2)
  })

  it('un valor corrupto no deja a nadie sin aviso para siempre', () => {
    almacen[CLAVE_POSPUESTO] = 'cualquier cosa'
    expect(avisoPospuesto()).toBe(false)
    almacen[CLAVE_POSPUESTO] = JSON.stringify({ cuando: 'x', veces: 2 })
    expect(avisoPospuesto()).toBe(false)
  })

  it('si localStorage no se puede leer, se ofrece igual', () => {
    // Modo privado: el acceso lanza. Preferimos ofrecer de más que perder a
    // alguien por una excepción del navegador.
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('bloqueado') },
      setItem: () => { throw new Error('bloqueado') },
      removeItem: () => { throw new Error('bloqueado') },
    })
    expect(avisoPospuesto()).toBe(false)
    expect(() => posponerAviso()).not.toThrow()
    expect(() => olvidarPospuesto()).not.toThrow()
  })

  it('los «Ahora no» son de CADA cuenta, no del dispositivo', () => {
    /* Celular compartido: que Ana diga que no tres veces no puede dejar a
       Beto esperando una semana. */
    const t = Date.UTC(2026, 8, 8)
    posponerAviso(t, 'ana'); posponerAviso(t, 'ana'); posponerAviso(t, 'ana')
    expect(avisoPospuesto(t + 2 * dia, 'ana')).toBe(true)
    expect(avisoPospuesto(t + 2 * dia, 'beto')).toBe(false)
    posponerAviso(t, 'beto')
    expect(avisoPospuesto(t + 21 * hora, 'beto')).toBe(false)
    expect(avisoPospuesto(t + 21 * hora, 'ana')).toBe(true)
  })

  it('lo guardado ANTES de ser por cuenta se sigue leyendo', () => {
    const t = Date.UTC(2026, 8, 8)
    almacen[CLAVE_POSPUESTO] = JSON.stringify({ cuando: t, veces: 1 })
    expect(avisoPospuesto(t + 2 * hora, 'ana')).toBe(true)
    olvidarPospuesto('ana')
    expect(avisoPospuesto(t + 2 * hora, 'ana')).toBe(false)
  })
})
