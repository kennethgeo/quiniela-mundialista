/* Que cada camino lleve a donde debe.

   Una regresión de navegación no falla: simplemente te deja en otro lado. Por
   eso lo que se afirma acá es SIEMPRE la URL final, no que algo se vea. */
import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

test.beforeEach(async ({ page }) => {
  await sinRedExterna(page)
  await interceptarSupabase(page)
})

const ruta = (page) => new URL(page.url()).pathname

test.describe('sin sesión', () => {
  test('una pantalla protegida manda a /auth', async ({ page }) => {
    await page.goto('/q/123')
    await expect.poll(() => ruta(page)).toBe('/auth')
  })

  test('la raíz manda a /auth', async ({ page }) => {
    await page.goto('/')
    await expect.poll(() => ruta(page)).toBe('/auth')
  })

  test('una ruta que no existe cae en la raíz, no en una pantalla en blanco', async ({ page }) => {
    await page.goto('/esta-ruta-no-existe')
    // Sin sesión termina en /auth, pero lo que importa es que NO se quede
    // colgada en la ruta inventada.
    await expect.poll(() => ruta(page)).not.toBe('/esta-ruta-no-existe')
  })

  test('/unirse guarda el código y manda a /auth', async ({ page }) => {
    await page.goto('/unirse/abc123')
    await expect.poll(() => ruta(page)).toBe('/auth')
    // Lo que hace que el enlace sirva: el código sobrevive al registro.
    const guardado = await page.evaluate(() => localStorage.getItem('tico:invitacion'))
    expect(guardado).toBe('ABC123')
  })

  test('/unirse normaliza el código a mayúsculas', async ({ page }) => {
    await page.goto('/unirse/aB-c1 2')
    await expect.poll(async () => page.evaluate(() => localStorage.getItem('tico:invitacion'))).toBe('ABC12')
  })

  test('la pantalla de login se ve y no queda en blanco', async ({ page }) => {
    await page.goto('/auth')
    await expect(page.getByPlaceholder(/correo/i)).toBeVisible()
    await expect(page.getByPlaceholder(/contraseña/i)).toBeVisible()
  })

  test('se puede ir a registrarse y volver', async ({ page }) => {
    await page.goto('/auth')
    await page.getByRole('button', { name: /registrate/i }).click()
    await expect(page.getByRole('button', { name: /crear cuenta/i })).toBeVisible()
    await page.getByRole('button', { name: /iniciá sesión|inicia sesión|entrar/i }).first().click()
    await expect(page.getByRole('button', { name: /^entrar$/i })).toBeVisible()
  })

  test('se puede ir a recuperar la contraseña', async ({ page }) => {
    await page.goto('/auth')
    await page.getByRole('button', { name: /olvidaste tu contraseña/i }).click()
    await expect(page.getByRole('button', { name: /enviar enlace/i })).toBeVisible()
  })
})

test.describe('con sesión', () => {
  test.beforeEach(async ({ page }) => {
    await conSesion(page)
    await interceptarSupabase(page, {
      // AuthContext pide el perfil; sin esto la app se queda cargando.
      '/rest/v1/users': [{
        id: USUARIO.id, display_name: 'Prueba', avatar_url: null,
        total_points: 0, points_adjustment: 0, is_admin: false,
        created_at: '2026-01-01', updated_at: '2026-01-01',
      }],
      '/rest/v1/rpc/my_groups': [],
    })
  })

  test('la raíz ya no manda a /auth', async ({ page }) => {
    await page.goto('/')
    // Se le da margen a que AuthContext resuelva la sesión.
    await page.waitForTimeout(1500)
    expect(ruta(page)).toBe('/')
  })

  test('/auth con sesión rebota a la raíz', async ({ page }) => {
    await page.goto('/auth')
    await expect.poll(() => ruta(page), { timeout: 8000 }).toBe('/')
  })

  test('/dashboard redirige a la raíz', async ({ page }) => {
    await page.goto('/dashboard')
    await expect.poll(() => ruta(page), { timeout: 8000 }).toBe('/')
  })

  test('las rutas viejas del Mundial redirigen a la raíz', async ({ page }) => {
    for (const vieja of ['/matches', '/leaderboard', '/bracket', '/torneo']) {
      await page.goto(vieja)
      await expect.poll(() => ruta(page), { timeout: 8000 }).toBe('/')
    }
  })
})
