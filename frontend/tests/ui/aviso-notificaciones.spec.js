/* El aviso para activar notificaciones, en el Hub.

   POR QUÉ ESTA PRUEBA ABRE LA PANTALLA: lo que puede salir mal no es la
   lógica —eso lo cubre avisoPush.test.js— sino que el aviso NO SE VEA, o que
   se le muestre a quien ya tiene avisos. Ninguna prueba de vitest puede ver
   eso, igual que no veía el editor de cupos bloqueado.

   El permiso de notificaciones se fija con el contexto de Playwright, que es
   la única forma honesta de simularlo: `Notification.permission` es de solo
   lectura. */
import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

const grupos = [{
  id: '00000000-0000-4000-8000-000000000002', name: 'Quiniela A', tournament_id: 1,
  tournament_status: 'active', tournament_kind: 'cup', tournament_name: 'Prueba',
  members: 1, my_points: 0, my_rank: 1,
}]

/* EL PERMISO SE FIJA SIEMPRE, nunca se hereda del entorno. En CI el navegador
   arranca con las notificaciones DENEGADAS y en local no: las mismas pruebas
   pasaban acá y caían allá, y el fallo era de la prueba, no de la app. */
async function montar (page, permiso = 'default') {
  await sinRedExterna(page)
  await conSesion(page)
  await page.addInitScript((p) => {
    localStorage.setItem('tutorial_seen', 'true')
    localStorage.setItem('pwaPromptDismissed', 'true')
    Object.defineProperty(Notification, 'permission', { get: () => p, configurable: true })
  }, permiso)
  await interceptarSupabase(page, {
    '/rest/v1/users': { id: USUARIO.id, display_name: 'Prueba', avatar_url: null, is_admin: false },
    '/rest/v1/rpc/my_groups': grupos,
    '/rest/v1/rpc/mi_resumen_global': { partidos: 0 },
    '/rest/v1/matches': [],
    '/rest/v1/predictions': [],
  })
}

const aviso = (page) => page.getByText('Que no se te pase una predicción')
// Una ausencia solo vale después de que el aviso DECIDIÓ: la decisión espera
// una consulta a la base y afirmar antes pasaría siempre.
const decidioNoOfrecer = (page) => page.locator('[data-aviso-push="no-se-ofrece"]')

test('a quien no decidió se le ofrece activar', async ({ page }) => {
  await montar(page)
  await page.goto('/')
  await expect(aviso(page)).toBeVisible({ timeout: 10000 })
  await expect(page.getByRole('button', { name: 'Activar avisos' })).toBeVisible()
})

test('«Ahora no» lo retira y no vuelve al recargar', async ({ page }) => {
  /* Si volviera en cada carga sería el aviso que hace que la gente apague
     TODAS las notificaciones, y ahí se pierden también las que importan. */
  await montar(page)
  await page.goto('/')
  await expect(aviso(page)).toBeVisible({ timeout: 10000 })

  await page.getByRole('button', { name: 'Ahora no' }).click()
  await expect(aviso(page)).toHaveCount(0)

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Mis quinielas' })).toBeVisible({ timeout: 10000 })
  await expect(decidioNoOfrecer(page)).toHaveCount(1, { timeout: 10000 })
  await expect(aviso(page)).toHaveCount(0)
})

test('con las notificaciones BLOQUEADAS se explica cómo, sin un botón muerto', async ({ page, context }) => {
  // El navegador ya no vuelve a preguntar: ofrecer "Activar" sería un botón
  // que no puede funcionar, y la persona concluiría que la app está rota.
  await context.clearPermissions()
  await montar(page, 'denied')
  await page.goto('/')
  await expect(aviso(page)).toBeVisible({ timeout: 10000 })
  await expect(page.getByText(/bloqueadas para este sitio/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Activar avisos' })).toHaveCount(0)
})

test('a quien YA tiene avisos no se le muestra nada', async ({ page }) => {
  await montar(page, 'granted')
  // Ya tiene avisos = suscripción en el navegador Y fila en la base.
  await page.route('**://pruebas.supabase.co/rest/v1/push_subscriptions**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[{"id":"x"}]' }))
  await page.addInitScript(() => {
    // Suscripción viva en este dispositivo.
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      get: () => ({
        ready: Promise.resolve({
          pushManager: { getSubscription: async () => ({ endpoint: 'https://ejemplo/x' }) },
        }),
      }),
    })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Mis quinielas' })).toBeVisible({ timeout: 10000 })
  await expect(decidioNoOfrecer(page)).toHaveCount(1, { timeout: 10000 })
  await expect(aviso(page)).toHaveCount(0)
})

/* El contraste se MIDE pintando el color en un canvas y leyendo el píxel.
   Parsear getComputedStyle no sirve: Tailwind v4 devuelve oklch(...) y leer
   esos tres números como si fueran RGB da ratios inventados — ya pasó en este
   repo y llevó a reportar un fallo que no existía.

   Sin esto el aviso nació con el botón principal a 1.74:1, o sea ilegible en
   el tema claro: el acento #2ED3B7 sobre su propio fondo al 12%. */
for (const tema of ['light', 'dark']) {
  test(`el aviso se lee en el tema ${tema}`, async ({ page }) => {
    await montar(page)
    await page.addInitScript((t) => localStorage.setItem('qm_theme', t), tema)
    await page.goto('/')
    await expect(aviso(page)).toBeVisible({ timeout: 10000 })

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
      // Se sube hasta un fondo NO transparente: leer rgba(0,0,0,0) como negro
      // da un contraste inventado.
      const fondoDe = (el) => {
        let f = el; let c = 'rgba(0, 0, 0, 0)'
        while (f && (c === 'rgba(0, 0, 0, 0)' || c === 'transparent')) {
          c = getComputedStyle(f).backgroundColor; f = f.parentElement
        }
        return c
      }
      const base = getComputedStyle(document.body).backgroundColor
      const nodos = [...document.querySelectorAll('p,button,span')]
      const de = (texto) => {
        const el = nodos.find((e) => e.textContent?.trim().startsWith(texto))
        if (!el) return null
        const f = fondoDe(el)
        return ratio(rgb(getComputedStyle(el).color, f), rgb(f, base))
      }
      return {
        titulo: de('Que no se te pase'),
        cuerpo: de('Activá las notificaciones'),
        activar: de('Activar avisos'),
        ahoraNo: de('Ahora no'),
      }
    })

    // WCAG AA para texto normal. Todo el aviso es texto chico.
    for (const [parte, valor] of Object.entries(medidas)) {
      expect(valor, `${parte} en ${tema}`).not.toBeNull()
      expect(valor, `${parte} en ${tema}`).toBeGreaterThanOrEqual(4.5)
    }
  })
}

/* ── Insistir la próxima vez que entra, sin ser spam ─────────────────────────
   Pedido del dueño: que el aviso vuelva cuando la persona vuelva a entrar.
   El «no vuelve al recargar» de arriba sigue valiendo (recargar no es volver
   a entrar); estas dos fijan el resto: al día siguiente sí vuelve, y a quien
   ya dijo que no varias veces se le espera más. */
async function pospuestoHace (page, horas, veces) {
  await page.addInitScript(({ h, v }) => {
    localStorage.setItem('avisoPushPospuesto',
      JSON.stringify({ cuando: Date.now() - h * 60 * 60 * 1000, veces: v }))
  }, { h: horas, v: veces })
}

test('pospuesto ayer: al volver a entrar se ofrece otra vez', async ({ page }) => {
  await montar(page)
  await pospuestoHace(page, 25, 1)
  await page.goto('/')
  await expect(aviso(page)).toBeVisible({ timeout: 10000 })
})

test('tres «Ahora no» seguidos: dos días después todavía no insiste', async ({ page }) => {
  await montar(page)
  await pospuestoHace(page, 48, 3)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Mis quinielas' })).toBeVisible({ timeout: 10000 })
  await expect(decidioNoOfrecer(page)).toHaveCount(1, { timeout: 10000 })
  await expect(aviso(page)).toHaveCount(0)
})

test('iPhone sin instalar: el aviso sale y explica que hay que instalar', async ({ page }) => {
  /* Safari sin instalar no expone Notification: el aviso se callaba y el
     texto para iPhone, que ya existía, no se veía nunca. */
  await sinRedExterna(page)
  await conSesion(page)
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_seen', 'true')
    localStorage.setItem('pwaPromptDismissed', 'true')
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1',
    })
    delete window.PushManager
    delete window.Notification
  })
  await interceptarSupabase(page, {
    '/rest/v1/users': { id: USUARIO.id, display_name: 'Prueba', avatar_url: null, is_admin: false },
    '/rest/v1/rpc/my_groups': grupos,
    '/rest/v1/rpc/mi_resumen_global': { partidos: 0 },
    '/rest/v1/matches': [],
    '/rest/v1/predictions': [],
  })
  await page.goto('/')
  await expect(aviso(page)).toBeVisible({ timeout: 10000 })
  await expect(page.getByText(/agregar la app a la pantalla de inicio/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Activar avisos' })).toHaveCount(0)
})

/* ── Novena auditoría: «activo» es navegador Y base ─────────────────────────
   Con la suscripción solo en el navegador, el Hub callaba el aviso a alguien
   a quien el backend no le puede escribir. */
async function suscritoEnElNavegador (page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      get: () => ({
        ready: Promise.resolve({
          pushManager: {
            getSubscription: async () => ({
              endpoint: 'https://ejemplo/x',
              toJSON: () => ({ endpoint: 'https://ejemplo/x', keys: { p256dh: 'a', auth: 'b' } }),
            }),
          },
        }),
      }),
    })
  })
}

test('suscrito en el navegador y sin fila en la base que se pueda guardar: se ofrece', async ({ page }) => {
  await montar(page, 'granted')
  await suscritoEnElNavegador(page)
  await page.route('**://pruebas.supabase.co/rest/v1/push_subscriptions**', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      : route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"falló"}' }))
  await page.goto('/')
  await expect(aviso(page)).toBeVisible({ timeout: 10000 })
})

test('suscrito en el navegador y sin fila, pero se puede guardar: se sana solo y no insiste', async ({ page }) => {
  await montar(page, 'granted')
  await suscritoEnElNavegador(page)
  let insertados = 0
  await page.route('**://pruebas.supabase.co/rest/v1/push_subscriptions**', (route) => {
    if (route.request().method() === 'POST') insertados++
    return route.fulfill({ status: route.request().method() === 'POST' ? 201 : 200, contentType: 'application/json', body: '[]' })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Mis quinielas' })).toBeVisible({ timeout: 10000 })
  await expect(decidioNoOfrecer(page)).toHaveCount(1, { timeout: 10000 })
  expect(insertados).toBeGreaterThan(0)
  await expect(aviso(page)).toHaveCount(0)
})

test('un service worker que nunca responde no esconde el aviso', async ({ page }) => {
  await montar(page, 'granted')
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true, get: () => ({ ready: new Promise(() => {}) }),
    })
  })
  await page.goto('/')
  await expect(aviso(page)).toBeVisible({ timeout: 15000 })
})

test('mientras OTRA pestaña cierra sesión, el Hub no vuelve a registrar el dispositivo', async ({ page }) => {
  /* Astra: la pestaña A borraba la fila y, antes de que terminara el cierre,
     la B veía «falta la fila» y la volvía a insertar. */
  await montar(page, 'granted')
  await suscritoEnElNavegador(page)
  await page.addInitScript(() => localStorage.setItem('avisosPush:cerrando', String(Date.now())))
  let insertados = 0
  await page.route('**://pruebas.supabase.co/rest/v1/push_subscriptions**', (route) => {
    if (route.request().method() === 'POST') insertados++
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await page.goto('/')
  await expect(aviso(page)).toBeVisible({ timeout: 10000 })
  expect(insertados).toBe(0)
})
