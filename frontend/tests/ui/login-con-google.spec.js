/* El botón de Google solo existe si Google está ENCENDIDO en Supabase.

   Activarlo no se hace desde el repo: hay que crear un cliente OAuth en Google
   Cloud y pegar sus credenciales en el panel de Supabase. Si el botón se
   pintara siempre, existiría antes de ese paso y al tocarlo daría «Unsupported
   provider: provider is not enabled» — un botón que promete y no cumple, que
   es exactamente el fallo por el que se quitó el panel de cupos en la
   migración 48.

   La app lo pregunta en /auth/v1/settings, que es público. */
import { expect, test } from '@playwright/test'
import { sinRedExterna } from './apoyo.js'

const AJUSTES = (google) => ({
  external: { apple: false, github: false, google, email: true, phone: false, anonymous_users: false },
  disable_signup: false,
  mailer_autoconfirm: true,
})

async function abrirLogin(page, { google = false, ajustes = null } = {}) {
  await sinRedExterna(page)
  /* OJO CON EL ORDEN: en Playwright gana la ÚLTIMA ruta registrada. El
     comodín de Supabase va PRIMERO; si fuera al revés se tragaría
     /auth/v1/settings y el botón no aparecería nunca — comprobado, así
     fallaban dos de estas pruebas. */
  await page.route('**://pruebas.supabase.co/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/auth/v1/settings*', (route) => {
    if (ajustes === 'falla') return route.fulfill({ status: 500, body: '{}' })
    if (ajustes === 'cuelga') return new Promise(() => {})
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AJUSTES(google)) })
  })
  await page.goto('/auth')
  await expect(page.getByRole('button', { name: /^entrar$/i })).toBeVisible({ timeout: 10000 })
}

const botonGoogle = (page) => page.getByRole('button', { name: /entrar con google/i })

test('con Google apagado el botón NO existe', async ({ page }) => {
  await abrirLogin(page, { google: false })
  await expect(botonGoogle(page)).toHaveCount(0)
})

test('con Google encendido el botón aparece, sin desplegar nada', async ({ page }) => {
  await abrirLogin(page, { google: true })
  await expect(botonGoogle(page)).toBeVisible()
})

/* Es un extra, no un requisito: si la consulta falla, se entra por correo
   igual. Una pantalla de entrada no puede depender de que responda algo que
   solo decide si se dibuja un botón de más. */
test('si no se puede consultar, el login por correo sigue entero', async ({ page }) => {
  await abrirLogin(page, { ajustes: 'falla' })
  await expect(botonGoogle(page)).toHaveCount(0)
  await expect(page.getByPlaceholder(/correo/i)).toBeVisible()
  await expect(page.getByPlaceholder(/contraseña/i)).toBeVisible()
})

test('si la consulta se cuelga, la pantalla no se queda esperando', async ({ page }) => {
  await abrirLogin(page, { ajustes: 'cuelga' })
  await expect(page.getByRole('button', { name: /^entrar$/i })).toBeEnabled()
  await expect(botonGoogle(page)).toHaveCount(0)
})

test('el botón manda a Google, no a otro lado', async ({ page }) => {
  await abrirLogin(page, { google: true })

  const destinos = []
  await page.route('**://accounts.google.com/**', (route) => {
    destinos.push(route.request().url())
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>google</html>' })
  })
  await page.route('**/auth/v1/authorize*', (route) => {
    destinos.push(route.request().url())
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>authorize</html>' })
  })

  await botonGoogle(page).click()
  await expect.poll(() => destinos.length, { timeout: 10000 }).toBeGreaterThan(0)
  expect(destinos[0]).toContain('provider=google')
})

/* El enlace con una cuenta existente es POR CORREO. Quien entre con un Google
   de otra dirección cae en una cuenta nueva y vacía y va a creer que perdió
   sus quinielas. Medido el 9 sep 2026: 23 de 26 usan gmail, pero 3 usan
   hotmail, así que el caso no es hipotético. */
test('se avisa que hay que usar el mismo correo', async ({ page }) => {
  await abrirLogin(page, { google: true })
  await expect(page.getByText(/mismo correo con el que te registraste/i)).toBeVisible()
})
