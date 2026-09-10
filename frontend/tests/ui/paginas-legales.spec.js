/* Privacidad y Condiciones tienen que abrirse SIN SESIÓN.

   No es un detalle de estilo: Google exige una URL de política de privacidad
   válida para pasar la pantalla de consentimiento de OAuth a producción, y
   quien la abre para revisarla no tiene cuenta en la app. Si estas rutas
   quedaran detrás de ProtectedRoute, Google vería la pantalla de login y la
   rechazaría — y nadie se enteraría hasta intentar publicar.

   Comprobado el 10 sep 2026: sin ellas el botón «Publicar app» está
   deshabilitado y el tooltip pide «una URL de página principal y una URL de
   política de privacidad válidas». */
import { expect, test } from '@playwright/test'
import { interceptarSupabase, sinRedExterna } from './apoyo.js'

test.beforeEach(async ({ page }) => {
  await sinRedExterna(page)
  await interceptarSupabase(page)
})

const ruta = (page) => new URL(page.url()).pathname

for (const [camino, titulo] of [['/privacidad', /política de privacidad/i], ['/terminos', /condiciones del servicio/i]]) {
  test(`${camino} se abre sin sesión y no rebota a /auth`, async ({ page }) => {
    await page.goto(camino)
    await expect(page.getByRole('heading', { name: titulo, level: 1 })).toBeVisible({ timeout: 10000 })
    // Lo que rompería el trámite con Google: que la ruta mande al login.
    await page.waitForTimeout(1200)
    expect(ruta(page)).toBe(camino)
  })
}

test('la política dice qué comparte Google y qué NO', async ({ page }) => {
  await page.goto('/privacidad')
  const cuerpo = page.locator('body')
  await expect(cuerpo).toContainText(/correo/i)
  // El punto que a la gente le importa antes de pulsar «Entrar con Google».
  await expect(cuerpo).toContainText(/contactos/i)
  await expect(cuerpo).toContainText(/no vendemos/i)
})

/* En una quiniela por plata esto no puede quedar ambiguo: la app lleva la
   cuenta del pozo pero no cobra, no paga y no retiene nada. */
test('las condiciones dejan claro que la app no maneja dinero', async ({ page }) => {
  await page.goto('/terminos')
  await expect(page.locator('body')).toContainText(/no cobra, no paga, no retiene ni transfiere dinero/i)
})

test('se llega a las dos desde el login, no solo por URL', async ({ page }) => {
  await page.goto('/auth')
  await expect(page.getByRole('link', { name: /privacidad/i })).toBeVisible({ timeout: 10000 })
  await expect(page.getByRole('link', { name: /condiciones/i })).toBeVisible()
})
