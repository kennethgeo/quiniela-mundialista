/* La tarjeta de notificaciones del Perfil, sobre la pantalla de verdad.

   POR QUÉ: era un interruptor chico al fondo del perfil, debajo de las
   medallas, y a más de la mitad del grupo no le llegaba ningún aviso. El dueño
   pidió hacerla «más llamativa». Lo que se afirma acá es lo que eso significa
   en la pantalla: que se vea arriba sin bajar, que diga qué se recibe, y que
   quien ya los tiene vea una confirmación chica y no un llamado.

   El permiso se fija SIEMPRE (en CI el navegador arranca con las
   notificaciones denegadas y en local no). */
import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

const PERFIL = {
  id: USUARIO.id, display_name: 'Prueba', avatar_url: null, total_points: 40,
  points_adjustment: 0, is_admin: false, created_at: '2026-01-01', updated_at: '2026-01-01',
}

/* Un service worker de mentira con o sin suscripción. Sin él, el de verdad
   puede o no registrarse según el entorno, y la prueba dependería de eso. */
async function montar (page, { permiso = 'default', suscrito = false, iphone = false, swNunca = false, registroFalla = false } = {}) {
  await sinRedExterna(page)
  await conSesion(page)
  await page.addInitScript(({ p, s, ios, nunca }) => {
    localStorage.setItem('tutorial_seen', 'true')
    localStorage.setItem('pwaPromptDismissed', 'true')
    if (ios) {
      // Safari en iPhone sin instalar: sin Notification ni PushManager.
      Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1',
      })
      delete window.PushManager
      delete window.Notification
      return
    }
    Object.defineProperty(Notification, 'permission', { get: () => p, configurable: true })
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      get: () => ({
        // `nunca`: un service worker que no se pone listo jamás.
        ready: nunca ? new Promise(() => {}) : Promise.resolve({
          pushManager: {
            getSubscription: async () => (s
              ? { endpoint: 'https://ejemplo/x', options: {}, toJSON: () => ({ endpoint: 'https://ejemplo/x', keys: { p256dh: 'a', auth: 'b' } }) }
              : null),
            subscribe: async () => { throw new Error('no en pruebas') },
          },
        }),
        register: async () => ({}),
        addEventListener: () => {},
      }),
    })
  }, { p: permiso, s: suscrito, ios: iphone, nunca: swNunca })
  await interceptarSupabase(page, {
    '/rest/v1/users': PERFIL,
    '/rest/v1/matches': [],
    '/rest/v1/predictions': [],
    '/rest/v1/user_stats_view': null,
    'rpc/my_groups': [],
    'rpc/my_medals': [],
  })
  if (registroFalla) {
    // La base no tiene la fila y guardarla falla: el navegador está suscrito
    // pero el backend no le puede escribir a esta persona.
    await page.route('**://pruebas.supabase.co/rest/v1/push_subscriptions**', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        : route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"falló"}' }))
  }
}

const llamado = (page) => page.getByText('Activá los avisos')

test('sin avisos: la tarjeta sale ARRIBA, en la primera pantalla, con lo que se recibe', async ({ page }) => {
  await montar(page)
  await page.goto('/profile')
  await expect(llamado(page)).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('A las 6 am, los partidos del día')).toBeVisible()
  await expect(page.getByText('45 min antes del saque, si te falta predecir')).toBeVisible()

  // Se mide la pantalla, no el orden del código: el botón entra sin bajar,
  // y está por encima de las medallas, que es donde antes nadie lo veía.
  const boton = page.getByRole('button', { name: 'Activar notificaciones' })
  await expect(boton).toBeVisible()
  const caja = await boton.boundingBox()
  const alto = page.viewportSize().height
  expect(caja.y + caja.height).toBeLessThanOrEqual(alto)
  const medallas = await page.getByText('Medallas', { exact: true }).first().boundingBox()
  if (medallas) expect(caja.y).toBeLessThan(medallas.y)
})

test('con avisos ya activos: una confirmación chica, sin llamado', async ({ page }) => {
  await montar(page, { permiso: 'granted', suscrito: true })
  await page.goto('/profile')
  await expect(page.getByText('Avisos activados', { exact: true })).toBeVisible({ timeout: 15000 })
  await expect(llamado(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Desactivar notificaciones' })).toBeVisible()
})

test('bloqueados: se explica dónde, sin un botón que no puede funcionar', async ({ page, context }) => {
  await context.clearPermissions()
  await montar(page, { permiso: 'denied' })
  await page.goto('/profile')
  await expect(page.getByText('Tenés los avisos bloqueados')).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole('button', { name: 'Activar notificaciones' })).toHaveCount(0)
})

test('iPhone sin instalar: se dice cómo instalar, en vez de no mostrar nada', async ({ page }) => {
  /* Safari sin instalar no expone Notification: antes la tarjeta devolvía
     null y a quien usa iPhone desde el navegador no se le decía nunca nada. */
  await montar(page, { iphone: true })
  await page.goto('/profile')
  await expect(page.getByText('En iPhone los avisos solo funcionan con la app instalada.')).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('Elegí «Agregar a inicio»')).toBeVisible()
})

for (const tema of ['light', 'dark']) {
  test(`la tarjeta se lee en el tema ${tema}`, async ({ page }) => {
    await montar(page)
    await page.addInitScript((t) => localStorage.setItem('qm_theme', t), tema)
    await page.goto('/profile')
    await expect(llamado(page)).toBeVisible({ timeout: 15000 })

    // Mismo método que aviso-notificaciones.spec.js: pintar en un canvas.
    const medidas = await page.evaluate(() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 1
      const cx = cv.getContext('2d', { willReadFrequently: true })
      const rgb = (color, sobre) => {
        cx.clearRect(0, 0, 1, 1)
        if (sobre) { cx.fillStyle = sobre; cx.fillRect(0, 0, 1, 1) }
        cx.fillStyle = color; cx.fillRect(0, 0, 1, 1)
        const d = cx.getImageData(0, 0, 1, 1).data
        return [d[0], d[1], d[2]]
      }
      const lum = ([r, g, b]) => [r, g, b]
        .map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 })
        .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0)
      const ratio = (a, b) => {
        const la = lum(a); const lb = lum(b)
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
      }
      /* La tarjeta tiene un degradado: se mide contra CADA parada del
         degradado y se exige el peor de los contrastes. */
      const base = getComputedStyle(document.body).backgroundColor
      const nodos = [...document.querySelectorAll('section[aria-label="Notificaciones"] p, section[aria-label="Notificaciones"] li, section[aria-label="Notificaciones"] button')]
      const seccion = document.querySelector('section[aria-label="Notificaciones"]')
      const img = getComputedStyle(seccion).backgroundImage
      const paradas = (img.match(/(?:rgba?|oklch|oklab|color)\([^)]*\)|#[0-9a-f]{3,8}/gi) || [])
      const fondos = paradas.length ? paradas : [getComputedStyle(seccion).backgroundColor]
      const fondoDe = (el) => {
        let f = el; let c = 'rgba(0, 0, 0, 0)'
        while (f && f !== seccion && (c === 'rgba(0, 0, 0, 0)' || c === 'transparent')) {
          c = getComputedStyle(f).backgroundColor; f = f.parentElement
        }
        return (c === 'rgba(0, 0, 0, 0)' || c === 'transparent') ? null : c
      }
      const de = (texto) => {
        const el = nodos.find((e) => e.textContent?.trim().startsWith(texto))
        if (!el) return null
        const propio = fondoDe(el)
        const lista = propio ? [propio] : fondos
        return Math.min(...lista.map((f) => {
          const fondo = rgb(f, base)
          return ratio(rgb(getComputedStyle(el).color, `rgb(${fondo.join(',')})`), fondo)
        }))
      }
      return {
        titulo: de('Activá los avisos'),
        cuerpo: de('Que no se te pase'),
        item: de('A las 6 am'),
        boton: de('Activar avisos'),
      }
    })

    for (const [parte, valor] of Object.entries(medidas)) {
      expect(valor, `${parte} en ${tema}`).not.toBeNull()
      expect(valor, `${parte} en ${tema}`).toBeGreaterThanOrEqual(4.5)
    }
  })
}

/* ── Novena auditoría ──────────────────────────────────────────────────────
   «Activo» tiene que significar que el backend PUEDE escribirle a esta
   persona: suscripción en el navegador Y fila en la base. Y ninguna espera
   del navegador puede dejar la tarjeta trabada. */
test('suscrito en el navegador pero SIN registro en la base: no dice «activados»', async ({ page }) => {
  await montar(page, { permiso: 'granted', suscrito: true, registroFalla: true })
  await page.goto('/profile')
  await expect(page.getByText(/No pudimos registrar este dispositivo/)).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('Avisos activados', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Activar notificaciones' })).toBeEnabled()
})

test('un service worker que nunca responde no deja el botón trabado', async ({ page }) => {
  await montar(page, { swNunca: true })
  await page.goto('/profile')
  await expect(page.getByText(/no terminó de preparar los avisos/)).toBeVisible({ timeout: 15000 })
  const boton = page.getByRole('button', { name: 'Activar notificaciones' })
  await expect(boton).toBeEnabled()
  await expect(boton).toHaveText(/Activar avisos/)
})

/* ── Décima auditoría: cerrar sesión desvincula el dispositivo ─────────────
   Antes la fila seguía a nombre de quien se fue, y en un celular compartido
   sus avisos le llegaban a quien lo usara después. */
test('cerrar sesión borra la suscripción de ESTE dispositivo a nombre de esta cuenta', async ({ page }) => {
  await montar(page, { permiso: 'granted', suscrito: true })
  const borrados = []
  await page.route('**://pruebas.supabase.co/rest/v1/push_subscriptions**', (route) => {
    const req = route.request()
    if (req.method() === 'DELETE') borrados.push(decodeURIComponent(req.url()))
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[{"id":"x"}]' })
  })
  await page.goto('/profile')
  await expect(page.getByText('Avisos activados', { exact: true })).toBeVisible({ timeout: 15000 })
  await page.getByRole('button', { name: /Cerrar sesión/ }).last().click()
  await expect.poll(() => borrados.length, { timeout: 10000 }).toBeGreaterThan(0)
  expect(borrados[0]).toContain('endpoint=eq.https://ejemplo/x')
  expect(borrados[0]).toContain(`user_id=eq.${USUARIO.id}`)
})
