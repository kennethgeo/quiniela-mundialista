/* Duodécima auditoría: si el cierre de sesión no pudo dar de baja la
   suscripción (sin red, `unsubscribe()` y el DELETE fallan), el celular seguía
   recibiendo los avisos de la cuenta que salió. Al abrir la app SIN sesión, la
   suscripción que quede en el navegador se da de baja. CON sesión, no se toca. */
import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

async function conSuscripcionViva (page) {
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_seen', 'true')
    localStorage.setItem('pwaPromptDismissed', 'true')
    Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true })
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      get: () => ({
        ready: Promise.resolve({
          pushManager: {
            getSubscription: async () => ({
              endpoint: 'https://ejemplo/x', options: {},
              unsubscribe: async () => { window.__bajaNavegador = true; return true },
              toJSON: () => ({ endpoint: 'https://ejemplo/x', keys: { p256dh: 'a', auth: 'b' } }),
            }),
          },
        }),
        register: async () => ({}),
        addEventListener: () => {},
      }),
    })
  })
}

test('sin sesión, la suscripción que quedó en el navegador se da de baja', async ({ page }) => {
  await sinRedExterna(page)
  await conSuscripcionViva(page)
  await interceptarSupabase(page, {})
  await page.goto('/auth')
  await expect.poll(() => page.evaluate(() => window.__bajaNavegador === true), { timeout: 10000 }).toBe(true)
})

test('con sesión, la suscripción NO se toca', async ({ page }) => {
  await sinRedExterna(page)
  await conSesion(page)
  await conSuscripcionViva(page)
  await interceptarSupabase(page, {
    '/rest/v1/users': { id: USUARIO.id, display_name: 'Prueba', avatar_url: null, is_admin: false },
    '/rest/v1/push_subscriptions': [{ id: 'x' }],
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Mis quinielas' })).toBeVisible({ timeout: 10000 })
  await page.waitForTimeout(1500)
  expect(await page.evaluate(() => window.__bajaNavegador === true)).toBe(false)
})
