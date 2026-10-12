/* El Hub migra los dispositivos suscritos con la llave VAPID vieja
   (vigésima auditoría, 11 oct 2026).

   LO QUE PASÓ: el recordatorio del partido 293 salió con la llave confirmada
   y le llegó a 7 de 8 personas. Al octavo, un iPhone suscrito el 13 de junio,
   Apple le respondía `VapidPkHashMismatch` a cada aviso. La fila existía y el
   navegador tenía suscripción, así que la app decía «activo» y no llegaba
   nada. El Perfil ya sabía migrar una llave vieja; el Hub —que es donde entra
   la gente— no.

   Y la otra mitad: el backend ahora BORRA la fila de ese dispositivo. Si al
   abrir el Hub se volviera a guardar el mismo endpoint, la fila muerta
   volvería y el próximo envío la borraría otra vez, para siempre. Hay que
   suscribir de nuevo. */
import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

const PERFIL = { id: USUARIO.id, display_name: 'Prueba', avatar_url: null, total_points: 40, points_adjustment: 0, is_admin: false, created_at: '2026-01-01', updated_at: '2026-01-01' }
// La de `lib/notificaciones.js`: la que el backend usa para firmar.
const LLAVE_ACTUAL = 'BEZacx8-hHDBW6kekpy-K-ZBU4LRHttGOK32Bm5IsAGCkt_lhSGKaXpmhRJCQh3voZnWCHS7gv52_jCqkgP_4DQ'
const VIEJO = 'https://web.push.apple.com/QJunio'
const NUEVO = 'https://web.push.apple.com/QNuevo'

/* Navegador con permiso dado, una suscripción viva en `VIEJO` hecha con la
   llave `llave` ('vieja' | 'actual') y la marca de que esta cuenta los pidió.
   `subscribe` anota la llave con la que se pidió el alta.

   Como un navegador de verdad: la suscripción SOBREVIVE a recargar (vive en
   `sessionStorage`), y `subscribe` con una suscripción viva de la misma llave
   devuelve ESA, no otra. Cada suscripción realmente nueva tiene su propio
   endpoint (`NUEVO`, `NUEVO-2`…) y se cuenta en `prueba:creadas`. */
async function navegador (page, llave) {
  await page.addInitScript(([id, llave, actualB64, viejo, nuevo]) => {
    localStorage.setItem('tutorial_seen', 'true')
    localStorage.setItem('pwaPromptDismissed', 'true')
    localStorage.setItem(`avisosPush:activos:${id}`, '1')
    const bytes = (b64) => {
      const s = atob((b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'))
      return Uint8Array.from(s, (c) => c.charCodeAt(0))
    }
    const actual = bytes(actualB64)
    // Otra llave P-256 válida en forma: 65 bytes que empiezan con 0x04.
    const vieja = Uint8Array.from(actual, (b, i) => (i === 0 ? b : (b + 1) % 256))
    const guardarVigente = (v) => sessionStorage.setItem('prueba:vigente',
      JSON.stringify(v ? { endpoint: v.endpoint, llave: v.llave } : null))
    const crear = (endpoint, llaveNombre) => {
      const llaveBytes = llaveNombre === 'vieja' ? vieja : actual
      return {
        endpoint,
        llave: llaveNombre,
        // Como en un navegador real: un ArrayBuffer.
        options: { applicationServerKey: llaveBytes.buffer.slice(0) },
        unsubscribe: async () => {
          sessionStorage.setItem('prueba:baja', endpoint)
          if (vigente?.endpoint === endpoint) { vigente = null; guardarVigente(null) }
          return true
        },
        toJSON: () => ({ endpoint, keys: { p256dh: 'a', auth: 'b' } }),
      }
    }
    const guardado = sessionStorage.getItem('prueba:vigente')
    let vigente = guardado === null
      ? crear(viejo, llave)
      : (JSON.parse(guardado) && crear(JSON.parse(guardado).endpoint, JSON.parse(guardado).llave))
    Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true })
    const reg = { pushManager: {
      getSubscription: async () => vigente,
      subscribe: async (opciones) => {
        const pedida = btoa(String.fromCharCode(...new Uint8Array(opciones.applicationServerKey)))
          .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
        sessionStorage.setItem('prueba:llaveAlta', pedida)
        const nombre = pedida === actualB64 ? 'actual' : 'otra'
        if (vigente && vigente.llave === nombre) return vigente
        const n = Number(sessionStorage.getItem('prueba:creadas') || 0) + 1
        sessionStorage.setItem('prueba:creadas', String(n))
        vigente = crear(n === 1 ? nuevo : `${nuevo}-${n}`, nombre)
        guardarVigente(vigente)
        return vigente
      },
    } }
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      get: () => ({ ready: Promise.resolve(reg), getRegistrations: async () => [], register: async () => ({}), addEventListener: () => {} }),
    })
  }, [USUARIO.id, llave, LLAVE_ACTUAL, VIEJO, NUEVO])
}

/* La tabla `push_subscriptions` con la RLS de verdad para lo que importa: el
   GET por (user_id, endpoint) devuelve la fila solo si existe; el POST la
   crea y el DELETE la borra. */
async function base (page, filas, { altaFalla = false } = {}) {
  const pedidos = { altas: [], bajas: [] }
  await interceptarSupabase(page, {
    '/rest/v1/users': PERFIL,
    '/rest/v1/user_stats_view': null,
  })
  await page.route('**://pruebas.supabase.co/rest/v1/push_subscriptions**', (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const endpoint = (url.searchParams.get('endpoint') || '').replace(/^eq\./, '')
    if (req.method() === 'POST') {
      const fila = JSON.parse(req.postData())
      pedidos.altas.push(fila.endpoint)
      if (altaFalla) {
        // Lo que responde PostgREST cuando la lista blanca de la 105 no
        // conoce el endpoint: un fallo que se repite en cada intento.
        return route.fulfill({
          status: 400, contentType: 'application/json',
          body: JSON.stringify({ code: '23514', message: 'new row for relation "push_subscriptions" violates check constraint "push_endpoint_conocido"' }),
        })
      }
      filas.add(fila.endpoint)
      return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' })
    }
    if (req.method() === 'DELETE') {
      pedidos.bajas.push({ endpoint, user: url.searchParams.get('user_id') })
      filas.delete(endpoint)
      return route.fulfill({ status: 204, body: '' })
    }
    const hay = filas.has(endpoint) && url.searchParams.get('user_id') === `eq.${USUARIO.id}`
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(hay ? [{ id: 'x' }] : []) })
  })
  return pedidos
}

const sesion = (page, clave) => page.evaluate((c) => sessionStorage.getItem(c), clave)
const decidioNoOfrecer = (page) => page.locator('[data-aviso-push="no-se-ofrece"]')

test('con la llave VIEJA: se da de baja, se suscribe con la actual, se guarda y se borra la fila vieja', async ({ page }) => {
  await sinRedExterna(page)
  await conSesion(page)
  await navegador(page, 'vieja')
  const pedidos = await base(page, new Set([VIEJO]))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Mis quinielas' })).toBeVisible({ timeout: 10000 })
  await expect.poll(() => pedidos.bajas.some((b) => b.endpoint === VIEJO), { timeout: 10000 }).toBe(true)
  expect(await sesion(page, 'prueba:baja')).toBe(VIEJO)
  expect(await sesion(page, 'prueba:llaveAlta')).toBe(LLAVE_ACTUAL)
  expect(pedidos.altas).toContain(NUEVO)
  expect(pedidos.altas).not.toContain(VIEJO)
  // Solo la fila propia: la RLS no deja más, y el filtro tiene que decirlo.
  for (const b of pedidos.bajas) expect(b.user).toBe(`eq.${USUARIO.id}`)
  // Ya migrado, no se ofrece activar: quedó activo.
  await expect(decidioNoOfrecer(page)).toHaveCount(1)
})

test('con la llave ACTUAL no se toca nada', async ({ page }) => {
  await sinRedExterna(page)
  await conSesion(page)
  await navegador(page, 'actual')
  const pedidos = await base(page, new Set([VIEJO]))
  await page.goto('/')
  // La ausencia solo vale después de que el aviso decidió.
  await expect(decidioNoOfrecer(page)).toHaveCount(1, { timeout: 10000 })
  await page.waitForTimeout(500)
  expect(await sesion(page, 'prueba:baja')).toBeNull()
  expect(await sesion(page, 'prueba:llaveAlta')).toBeNull()
  expect(pedidos.altas).toEqual([])
  expect(pedidos.bajas).toEqual([])
})

test('si el backend borró la fila (dispositivo muerto), se suscribe DE NUEVO en vez de volver a guardar el mismo endpoint', async ({ page }) => {
  await sinRedExterna(page)
  await conSesion(page)
  await navegador(page, 'actual')
  const pedidos = await base(page, new Set())
  await page.goto('/')
  await expect.poll(() => pedidos.altas.length, { timeout: 10000 }).toBeGreaterThanOrEqual(1)
  expect(await sesion(page, 'prueba:baja')).toBe(VIEJO)
  expect(pedidos.altas).not.toContain(VIEJO)
  expect(pedidos.altas).toContain(NUEVO)
  await expect(decidioNoOfrecer(page)).toHaveCount(1)
})

/* Revisión de la vigésima auditoría: si guardar la suscripción NUEVA falla
   siempre (un 23514 de la lista blanca, que no está comprobada contra todos
   los navegadores), cada apertura daba de baja la recién creada y creaba
   otra. Ahora se recuerda que esa no se pudo guardar y se reintenta guardar
   LA MISMA. */
test('si guardar la suscripción nueva falla, la próxima apertura reintenta guardar ESA y no crea otra', async ({ page }) => {
  await sinRedExterna(page)
  await conSesion(page)
  await navegador(page, 'actual')
  const pedidos = await base(page, new Set(), { altaFalla: true })
  await page.goto('/')
  await expect.poll(() => pedidos.altas.includes(NUEVO), { timeout: 10000 }).toBe(true)
  // No quedó activo: se le ofrece activar (y ahí verá el error).
  await expect(page.getByRole('button', { name: 'Activar avisos' })).toBeVisible({ timeout: 10000 })
  expect(await sesion(page, 'prueba:creadas')).toBe('1')
  const antes = pedidos.altas.length

  await page.reload()
  await expect(page.getByRole('button', { name: 'Activar avisos' })).toBeVisible({ timeout: 10000 })
  await expect.poll(() => pedidos.altas.length, { timeout: 10000 }).toBeGreaterThan(antes)
  await page.waitForTimeout(500)
  expect(await sesion(page, 'prueba:creadas')).toBe('1')
  expect(await sesion(page, 'prueba:baja')).toBe(VIEJO)
  for (const e of pedidos.altas.slice(antes)) expect(e).toBe(NUEVO)
})

/* Y el Perfil decide IGUAL que el Hub: antes, con la fila borrada por el
   backend, volvía a guardar el endpoint muerto. */
test('el Perfil, con la fila borrada por el backend, también suscribe de nuevo', async ({ page }) => {
  await sinRedExterna(page)
  await conSesion(page)
  await navegador(page, 'actual')
  const pedidos = await base(page, new Set())
  await page.goto('/profile')
  await expect(page.getByText('Avisos activados', { exact: true })).toBeVisible({ timeout: 15000 })
  expect(pedidos.altas).toContain(NUEVO)
  expect(pedidos.altas).not.toContain(VIEJO)
  expect(await sesion(page, 'prueba:baja')).toBe(VIEJO)
})
