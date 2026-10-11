/* Los avisos no se pierden sin que la persona lo elija (10 oct 2026).

   El dueño reportó «creo que las notificaciones no están saliendo». El backend
   y el disparador estaban bien: lo que pasaba es que los dispositivos se iban
   dando de baja SOLOS. Tres caminos, reproducidos con auth-js real:
   · quedarse sin sesión sin elegirlo (renovación rechazada, cierre en otro
     dispositivo) disparaba `bajaSinSesion`;
   · el Perfil tomaba un error de red como «la suscripción es de otra persona»;
   · el ErrorBoundary desregistraba el service worker al primer chunk viejo
     después de un despliegue, y con él la suscripción.
   Y nadie la recuperaba: el Hub no re-suscribía nunca. */
import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

const PERFIL = { id: USUARIO.id, display_name: 'Prueba', avatar_url: null, total_points: 40, points_adjustment: 0, is_admin: false, created_at: '2026-01-01', updated_at: '2026-01-01' }
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc'

/* Sesión guardada con el access token VENCIDO: al abrir, auth-js renueva. */
async function sesionVencida (page) {
  await page.addInitScript((usuario) => {
    localStorage.setItem('sb-pruebas-auth-token', JSON.stringify({
      access_token: 'viejo', refresh_token: 'refresh-revocado', token_type: 'bearer',
      expires_at: Math.floor(Date.now() / 1000) - 3600, expires_in: 3600, user: usuario,
    }))
  }, USUARIO)
}

/* Navegador con permiso dado. `suscrito`: hay una suscripción viva.
   `pidio`: esta cuenta los activó acá (marca de la auditoría 19).
   `bajaPendiente`: un cierre voluntario de este dispositivo quedó a medias. */
async function navegador (page, { suscrito = true, pidio = true, bajaPendiente = false } = {}) {
  await page.addInitScript(([id, suscrito, pidio, bajaPendiente, endpoint]) => {
    localStorage.setItem('tutorial_seen', 'true')
    localStorage.setItem('pwaPromptDismissed', 'true')
    if (pidio) localStorage.setItem(`avisosPush:activos:${id}`, '1')
    if (bajaPendiente) localStorage.setItem('avisosPush:bajaPendiente', '1')
    const sub = {
      endpoint, options: {},
      unsubscribe: async () => { sessionStorage.setItem('prueba:baja', '1'); return true },
      toJSON: () => ({ endpoint, keys: { p256dh: 'a', auth: 'b' } }),
    }
    let actual = suscrito ? sub : null
    Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true })
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      get: () => ({
        ready: Promise.resolve({ pushManager: {
          getSubscription: async () => actual,
          subscribe: async () => { sessionStorage.setItem('prueba:alta', '1'); actual = sub; return sub },
        } }),
        getRegistrations: async () => [{
          update: async () => { sessionStorage.setItem('prueba:update', '1') },
          unregister: async () => { sessionStorage.setItem('prueba:desregistro', '1'); return true },
        }],
        register: async () => ({}),
        addEventListener: () => {},
      }),
    })
  }, [USUARIO.id, suscrito, pidio, bajaPendiente, ENDPOINT])
}

const marca = (page, clave) => page.evaluate((c) => sessionStorage.getItem(c) === '1', clave)

for (const [nombre, status, cuerpo] of [
  ['refresh_token_not_found (cierre en OTRO dispositivo)', 400, { code: 'refresh_token_not_found', error: 'invalid_grant' }],
  ['session_not_found', 403, { code: 'session_not_found' }],
  ['un 500 pasajero de Auth', 500, { code: 'unexpected_failure' }],
  ['429', 429, { code: 'over_request_rate_limit' }],
]) {
  test(`perder la sesión por ${nombre} NO da de baja los avisos`, async ({ page }) => {
    await sinRedExterna(page)
    await sesionVencida(page)
    await navegador(page)
    await interceptarSupabase(page, { '/rest/v1/users': PERFIL })
    await page.route('**://pruebas.supabase.co/auth/v1/token**', (route) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(cuerpo) }))
    await page.goto('/')
    // Se asienta en el login: la sesión se perdió de verdad.
    await expect(page).toHaveURL(/\/auth/, { timeout: 15000 })
    await page.waitForTimeout(2500)
    expect(await marca(page, 'prueba:baja')).toBe(false)
  })
}

test('con un cierre VOLUNTARIO a medias, al abrir sin sesión SÍ se da de baja', async ({ page }) => {
  await sinRedExterna(page)
  await navegador(page, { bajaPendiente: true })
  await interceptarSupabase(page, {})
  await page.goto('/auth')
  await expect.poll(() => marca(page, 'prueba:baja'), { timeout: 10000 }).toBe(true)
  // Hecha la baja, la marca se va: no vuelve a actuar sobre una alta futura.
  expect(await page.evaluate(() => localStorage.getItem('avisosPush:bajaPendiente'))).toBeNull()
})

test('cerrar sesión cierra SOLO este dispositivo (scope local)', async ({ page }) => {
  await sinRedExterna(page)
  await conSesion(page)
  await navegador(page)
  const cierres = []
  await interceptarSupabase(page, {
    '/rest/v1/users': PERFIL,
    '/rest/v1/push_subscriptions': [{ id: 'x' }],
    '/auth/v1/logout': (url) => { cierres.push(url); return {} },
  })
  await page.goto('/profile')
  await page.getByRole('button', { name: /Cerrar sesión/ }).last().click()
  await expect(page).toHaveURL(/\/auth/, { timeout: 15000 })
  expect(cierres.length).toBe(1)
  expect(cierres[0]).toContain('scope=local')
})

test('el Hub vuelve a suscribir a quien los pidió y perdió la suscripción', async ({ page }) => {
  await sinRedExterna(page)
  await conSesion(page)
  await navegador(page, { suscrito: false, pidio: true })
  const altas = []
  // El comodín va PRIMERO: en Playwright gana la última ruta registrada.
  await interceptarSupabase(page, { '/rest/v1/users': PERFIL })
  await page.route('**://pruebas.supabase.co/rest/v1/push_subscriptions**', (route) => {
    if (route.request().method() === 'POST') {
      altas.push(JSON.parse(route.request().postData()))
      return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Mis quinielas' })).toBeVisible({ timeout: 10000 })
  // En desarrollo React monta los efectos dos veces (StrictMode) y puede
  // registrar dos veces; la base responde 23505 a la segunda y es idempotente.
  await expect.poll(() => altas.length, { timeout: 10000 }).toBeGreaterThanOrEqual(1)
  for (const alta of altas) expect(alta).toMatchObject({ user_id: USUARIO.id, endpoint: ENDPOINT })
  expect(await marca(page, 'prueba:alta')).toBe(true)
})

test('el Hub NO suscribe solo a una cuenta que no los pidió en este dispositivo', async ({ page }) => {
  await sinRedExterna(page)
  await conSesion(page)
  await navegador(page, { suscrito: false, pidio: false })
  await interceptarSupabase(page, { '/rest/v1/users': PERFIL })
  await page.goto('/')
  // Se le OFRECE activarlos (lo decide la persona), pero no se suscribe solo.
  await expect(page.getByRole('button', { name: 'Activar avisos' })).toBeVisible({ timeout: 10000 })
  expect(await marca(page, 'prueba:alta')).toBe(false)
})

test('el Perfil NO da de baja si no pudo comprobar de quién es la suscripción', async ({ page }) => {
  await sinRedExterna(page)
  await conSesion(page)
  await navegador(page, { pidio: false })
  await interceptarSupabase(page, { '/rest/v1/users': PERFIL })
  await page.route('**://pruebas.supabase.co/rest/v1/push_subscriptions**', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"timeout"}' }))
  await page.goto('/profile')
  await expect(page.getByRole('button', { name: /Cerrar sesión/ }).last()).toBeVisible({ timeout: 10000 })
  await page.waitForTimeout(2500)
  expect(await marca(page, 'prueba:baja')).toBe(false)
})

test('una versión vieja después de un despliegue NO desregistra el service worker', async ({ page }) => {
  await sinRedExterna(page)
  await navegador(page)
  await interceptarSupabase(page, {})
  // El chunk de la página ya no existe: lo que pasa después de cada despliegue.
  await page.route('**/src/pages/PrivacidadPage.jsx**', (route) => route.abort())
  await page.goto('/privacidad')
  // Recarga una vez buscando la versión nueva y, como sigue fallando, se queda
  // en el error con su botón en vez de entrar en un bucle.
  await expect(page.getByRole('button', { name: 'Recargar Aplicación' })).toBeVisible({ timeout: 15000 })
  expect(await marca(page, 'prueba:update')).toBe(true)
  expect(await marca(page, 'prueba:desregistro')).toBe(false)
})

/* La otra mitad: un cierre VOLUNTARIO que no pudo dar de baja el navegador
   (sin red) sí se completa en la próxima apertura sin sesión (duodécima
   auditoría). Sin la marca que deja `olvidarDispositivo`, eso ya no pasaría. */
test('un cierre voluntario cuya baja falló se completa ya sin sesión', async ({ page }) => {
  await sinRedExterna(page)
  await conSesion(page)
  await navegador(page)
  // La primera baja del navegador falla (sin red); la siguiente sale.
  await page.addInitScript(() => {
    const original = navigator.serviceWorker
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      get: () => ({
        ...original,
        ready: original.ready.then((reg) => ({ pushManager: {
          ...reg.pushManager,
          getSubscription: async () => {
            const sub = await reg.pushManager.getSubscription()
            if (!sub) return null
            return {
              ...sub,
              unsubscribe: async () => {
                if (sessionStorage.getItem('prueba:fallo') !== '1') {
                  sessionStorage.setItem('prueba:fallo', '1')
                  throw new Error('sin red')
                }
                return sub.unsubscribe()
              },
            }
          },
        } })),
      }),
    })
  })
  await interceptarSupabase(page, {
    '/rest/v1/users': PERFIL,
    '/rest/v1/push_subscriptions': [{ id: 'x' }],
    '/auth/v1/logout': {},
  })
  await page.goto('/profile')
  await page.getByRole('button', { name: /Cerrar sesión/ }).last().click()
  await expect(page).toHaveURL(/\/auth/, { timeout: 15000 })
  // Ya sin sesión (SIGNED_OUT o la próxima apertura) se reintenta y sale.
  await expect.poll(() => marca(page, 'prueba:baja'), { timeout: 10000 }).toBe(true)
  expect(await page.evaluate(() => sessionStorage.getItem('prueba:fallo'))).toBe('1')
})
