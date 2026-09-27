/* Duodécima auditoría: si el cierre de sesión no pudo dar de baja la
   suscripción (sin red, `unsubscribe()` y el DELETE fallan), el celular seguía
   recibiendo los avisos de la cuenta que salió. Al abrir la app SIN sesión, la
   suscripción que quede en el navegador se da de baja. CON sesión, no se toca. */
import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

async function conSuscripcionViva (page, { retenida = false } = {}) {
  await page.addInitScript((retenida) => {
    // `retenida`: el navegador tarda en contestar hasta que la prueba lo suelte.
    let soltar
    const suelta = new Promise((resolve) => { soltar = resolve })
    window.__soltarSW = () => soltar()
    localStorage.setItem('tutorial_seen', 'true')
    localStorage.setItem('pwaPromptDismissed', 'true')
    Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true })
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      get: () => ({
        ready: Promise.resolve({
          pushManager: {
            getSubscription: async () => {
              if (retenida) await suelta
              return {
                endpoint: 'https://ejemplo/x', options: {},
                unsubscribe: async () => { window.__bajaNavegador = true; return true },
                toJSON: () => ({ endpoint: 'https://ejemplo/x', keys: { p256dh: 'a', auth: 'b' } }),
              }
            },
          },
        }),
        register: async () => ({}),
        addEventListener: () => {},
      }),
    })
  }, retenida)
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

/* Decimotercera auditoría: la decisión «no hay sesión» se toma al abrir, pero
   la baja ocurre DESPUÉS de esperar al navegador. Si en ese hueco la persona
   entra, la baja se llevaba los avisos de quien acaba de iniciar sesión. */
test('si alguien entra mientras el navegador tarda, su suscripción NO se da de baja', async ({ page }) => {
  await sinRedExterna(page)
  await conSuscripcionViva(page, { retenida: true })
  const sesion = {
    access_token: 'token-de-mentira', refresh_token: 'refresh-de-mentira', token_type: 'bearer',
    expires_at: Math.floor(Date.now() / 1000) + 31536000, expires_in: 31536000, user: USUARIO,
  }
  await interceptarSupabase(page, {
    '/auth/v1/token': sesion,
    '/rest/v1/users': { id: USUARIO.id, display_name: 'Prueba', avatar_url: null, is_admin: false },
    '/rest/v1/push_subscriptions': [{ id: 'x' }],
  })
  await page.goto('/auth')
  await page.fill('#login-email', USUARIO.email)
  await page.fill('#login-password', 'clave-de-prueba')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Mis quinielas' })).toBeVisible({ timeout: 10000 })
  await page.evaluate(() => window.__soltarSW())
  await page.waitForTimeout(1500)
  expect(await page.evaluate(() => window.__bajaNavegador === true)).toBe(false)
})

/* Decimosexta auditoría: `Promise.race` limita la espera del cierre pero no
   cancela el trabajo. Si el navegador responde DESPUÉS de vencido el plazo y
   para entonces ya entró otra cuenta, la suscripción que aparece es la de la
   cuenta nueva: el cierre viejo no la puede tocar. */
test('un cierre de sesión vencido no le quita los avisos a quien entra después', async ({ page }) => {
  test.setTimeout(45000)
  await sinRedExterna(page)
  await conSesion(page)
  await conSuscripcionViva(page, { retenida: true })
  const sesion = {
    access_token: 'token-de-mentira', refresh_token: 'refresh-de-mentira', token_type: 'bearer',
    expires_at: Math.floor(Date.now() / 1000) + 31536000, expires_in: 31536000, user: USUARIO,
  }
  await interceptarSupabase(page, {
    '/auth/v1/token': sesion,
    '/auth/v1/logout': {},
    '/rest/v1/users': { id: USUARIO.id, display_name: 'Prueba', avatar_url: null, is_admin: false },
    '/rest/v1/push_subscriptions': [{ id: 'x' }],
  })
  await page.goto('/profile')
  await page.getByRole('button', { name: /Cerrar sesión/ }).last().click()
  // El navegador no contesta: vence el presupuesto y la sesión se cierra igual.
  await expect(page).toHaveURL(/\/auth/, { timeout: 15000 })
  await page.fill('#login-email', USUARIO.email)
  await page.fill('#login-password', 'clave-de-prueba')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Mis quinielas' })).toBeVisible({ timeout: 10000 })
  // Recién ahora responde el navegador: el cierre viejo sigue esperando.
  await page.evaluate(() => window.__soltarSW())
  await page.waitForTimeout(1500)
  expect(await page.evaluate(() => window.__bajaNavegador === true)).toBe(false)
})
