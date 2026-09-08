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

async function montar (page) {
  await sinRedExterna(page)
  await conSesion(page)
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_seen', 'true')
    localStorage.setItem('pwaPromptDismissed', 'true')
  })
  await interceptarSupabase(page, {
    '/rest/v1/users': { id: USUARIO.id, display_name: 'Prueba', avatar_url: null, is_admin: false },
    '/rest/v1/rpc/my_groups': grupos,
    '/rest/v1/rpc/mi_resumen_global': { partidos: 0 },
    '/rest/v1/matches': [],
    '/rest/v1/predictions': [],
  })
}

const aviso = (page) => page.getByText('Que no se te pase una predicción')

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
  await expect(aviso(page)).toHaveCount(0)
})

test('con las notificaciones BLOQUEADAS se explica cómo, sin un botón muerto', async ({ page, context }) => {
  // El navegador ya no vuelve a preguntar: ofrecer "Activar" sería un botón
  // que no puede funcionar, y la persona concluiría que la app está rota.
  await context.clearPermissions()
  await montar(page)
  await page.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', { get: () => 'denied', configurable: true })
  })
  await page.goto('/')
  await expect(aviso(page)).toBeVisible({ timeout: 10000 })
  await expect(page.getByText(/bloqueadas para este sitio/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Activar avisos' })).toHaveCount(0)
})

test('a quien YA tiene avisos no se le muestra nada', async ({ page }) => {
  await montar(page)
  await page.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true })
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
