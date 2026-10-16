/* Una revisión de avisos de la cuenta A no puede tocar el dispositivo cuando
   ya entró B (revisión de Codex, 12 oct 2026).

   EL FALLO: `revisarAvisos` espera al service worker y a la base, y nada de
   eso se cancela. Si A sale y entra B mientras la vuelta de A espera la
   lectura de `push_subscriptions`, la respuesta dice —con razón— que la
   suscripción del navegador no es de A. La vuelta vieja la daba de baja (era
   la de B) o la reemplazaba a nombre de A. La pantalla tenía su `vigente`,
   pero solo frenaba el `setState`.

   Se prueba la librería con un navegador y una base de mentira cuyas
   respuestas se sueltan a mano, para poder meter el cambio de cuenta justo en
   la espera. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  lecturas: [],   // promesas pendientes de `registrada`
  altas: [],
  bajas: [],
}))

vi.mock('./supabase', () => {
  const lectura = () => {
    let soltar
    const p = new Promise((resolve) => { soltar = resolve })
    db.lecturas.push((filas) => soltar({ data: filas, error: null }))
    return p
  }
  const cadena = {
    select: () => cadena,
    eq: () => cadena,
    limit: () => lectura(),
  }
  return {
    supabase: {
      from: () => ({
        ...cadena,
        insert: async (fila) => { db.altas.push(fila); return { error: null } },
        delete: () => {
          const d = { eq: () => d, then: (ok) => { db.bajas.push(true); return Promise.resolve({ error: null }).then(ok) } }
          return d
        },
      }),
    },
  }
})

const A = 'aaaaaaaa-0000-4000-8000-000000000000'
const B = 'bbbbbbbb-0000-4000-8000-000000000000'

let lib
let disp

function navegador () {
  const almacen = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
    setItem: (k, v) => almacen.set(k, String(v)),
    removeItem: (k) => almacen.delete(k),
  })
  const Notification = { permission: 'granted' }
  vi.stubGlobal('Notification', Notification)
  vi.stubGlobal('window', { PushManager: function PushManager () {}, Notification, atob: globalThis.atob })
  // La suscripción viva del dispositivo. `unsubscribe` se puede demorar.
  disp = {
    bajas: 0,
    altas: 0,
    demorarBaja: null,
    sub: null,
  }
  const crear = (endpoint) => ({
    endpoint,
    options: {},
    unsubscribe: async () => {
      disp.bajas++
      if (disp.demorarBaja) await disp.demorarBaja
      if (disp.sub?.endpoint === endpoint) disp.sub = null
      return true
    },
    toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
  })
  disp.sub = crear('https://fcm.googleapis.com/fcm/send/de-B')
  const reg = {
    pushManager: {
      getSubscription: async () => disp.sub,
      subscribe: async () => {
        disp.altas++
        disp.sub = disp.sub || crear(`https://fcm.googleapis.com/fcm/send/nueva-${disp.altas}`)
        return disp.sub
      },
    },
  }
  vi.stubGlobal('navigator', { userAgent: 'prueba', serviceWorker: { ready: Promise.resolve(reg) } })
}

// Deja correr las promesas ya resueltas hasta que aparezca la lectura.
async function hastaLaLectura () {
  for (let i = 0; i < 50 && db.lecturas.length === 0; i++) await new Promise((r) => setTimeout(r, 0))
  expect(db.lecturas.length).toBe(1)
  return db.lecturas.shift()
}

beforeEach(async () => {
  vi.resetModules()
  db.lecturas.length = 0; db.altas.length = 0; db.bajas.length = 0
  navegador()
  lib = await import('./notificaciones.js')
})

afterEach(() => { vi.unstubAllGlobals() })

describe('la vuelta de A no toca lo de B', () => {
  it('control: sin cambio de cuenta, una suscripción ajena que A no pidió se da de baja', async () => {
    lib.fijarCuentaEnSesion(A)
    const vuelta = lib.revisarAvisos(A)
    ;(await hastaLaLectura())([])
    expect(await vuelta).toEqual({ activo: false, error: null })
    expect(disp.bajas).toBe(1)
  })

  it('A no los pidió acá: entra B durante la lectura y la suscripción de B queda', async () => {
    lib.fijarCuentaEnSesion(A)
    const vuelta = lib.revisarAvisos(A)
    const soltar = await hastaLaLectura()
    lib.fijarCuentaEnSesion(B)
    soltar([])
    expect(await vuelta).toEqual({ activo: false, error: null })
    expect(disp.bajas).toBe(0)
    expect(disp.altas).toBe(0)
    expect(db.altas).toEqual([])
  })

  it('A los pidió acá: entra B durante la lectura y no se reemplaza nada a nombre de A', async () => {
    lib.marcarAvisosDeCuenta(A, true)
    lib.fijarCuentaEnSesion(A)
    const vuelta = lib.revisarAvisos(A)
    const soltar = await hastaLaLectura()
    lib.fijarCuentaEnSesion(B)
    soltar([])
    expect(await vuelta).toEqual({ activo: false, error: null })
    expect(disp.bajas).toBe(0)
    expect(disp.altas).toBe(0)
    expect(db.altas).toEqual([])
  })

  it('entra B mientras A da de baja la suya para suscribir de nuevo: A no suscribe ni guarda', async () => {
    lib.marcarAvisosDeCuenta(A, true)
    lib.fijarCuentaEnSesion(A)
    let soltarBaja
    disp.demorarBaja = new Promise((resolve) => { soltarBaja = resolve })
    const vuelta = lib.revisarAvisos(A)
    ;(await hastaLaLectura())([])          // la fila de A no está: suscribir de nuevo
    for (let i = 0; i < 20 && disp.bajas === 0; i++) await new Promise((r) => setTimeout(r, 0))
    expect(disp.bajas).toBe(1)
    lib.fijarCuentaEnSesion(B)
    soltarBaja()
    expect(await vuelta).toEqual({ activo: false, error: null })
    expect(disp.altas).toBe(0)
    expect(db.altas).toEqual([])
  })

  it('la pantalla que llamó se fue (sigueVigente = false): tampoco se toca nada', async () => {
    lib.fijarCuentaEnSesion(A)
    let vigente = true
    const vuelta = lib.revisarAvisos(A, () => vigente)
    const soltar = await hastaLaLectura()
    vigente = false
    soltar([])
    await vuelta
    expect(disp.bajas).toBe(0)
  })

  it('sin cuenta en sesión no se revisa nada', async () => {
    lib.fijarCuentaEnSesion(null)
    expect(await lib.revisarAvisos(A)).toEqual({ activo: false, error: null })
    expect(db.lecturas.length).toBe(0)
    expect(disp.bajas).toBe(0)
  })
})
