import { expect, test } from '@playwright/test'
import { sinRedExterna, USUARIO } from './apoyo.js'

// Solo datos sintéticos contra pruebas.supabase.co. No requiere cuentas reales.
async function preparar(page, usuario, responderAuth) {
  await sinRedExterna(page)
  await page.addInitScript(user => {
    localStorage.setItem('pwaPromptDismissed', 'true')
    localStorage.setItem('tutorial_seen', 'true')
    localStorage.setItem('sb-pruebas-auth-token', JSON.stringify({
      user, access_token: 'token-sintetico', refresh_token: 'refresh-sintetico',
      token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600,
      expires_in: 3600,
    }))
  }, usuario)
  await page.route('**://pruebas.supabase.co/**', async route => {
    const url = new URL(route.request().url())
    const dar = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname === '/auth/v1/user') return responderAuth(route, dar)
    if (url.pathname === '/rest/v1/users') {
      const perfil = { id: USUARIO.id, display_name: 'Perfil cargado', is_admin: false, total_points: 0 }
      return dar((route.request().headers().accept || '').includes('vnd.pgrst.object') ? perfil : [perfil])
    }
    if (url.pathname.endsWith('/mi_resumen_global')) return dar({ partidos: 0, puntos: 0 })
    return dar([])
  })
}

const incompleto = () => {
  const user = { ...USUARIO }
  delete user.email_confirmed_at
  return user
}

test('la sesión inicial carga el perfil sin una consulta adicional a Auth', async ({ page }) => {
  let consultas = 0
  await preparar(page, USUARIO, (_route, dar) => { consultas++; return dar(USUARIO) })
  await page.goto('/')
  await expect(page.getByText('Hola, Perfil cargado', { exact: false })).toBeVisible()
  expect(consultas).toBe(0)
})

test('un usuario incompleto espera la comprobación antes de abrir el Hub', async ({ page }) => {
  let liberar
  const respuesta = new Promise(resolve => { liberar = resolve })
  await preparar(page, incompleto(), async (_route, dar) => { await respuesta; return dar(USUARIO) })
  await page.goto('/')
  try {
    await expect(page.getByRole('status')).toHaveText('Comprobando tu sesión…')
    await expect(page.getByRole('heading', { name: 'Mis quinielas', exact: true })).toHaveCount(0)
  } finally { liberar() }
  await expect(page.getByText('Hola, Perfil cargado', { exact: false })).toBeVisible()
})

test('null explícito conserva la pantalla de correo sin verificar', async ({ page }) => {
  let consultas = 0
  await preparar(page, { ...USUARIO, email_confirmed_at: null }, (_route, dar) => { consultas++; return dar(USUARIO) })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Email no verificado' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Mis quinielas', exact: true })).toHaveCount(0)
  expect(consultas).toBe(0)
})

test('el fallo de verificación permite reintentar y recuperar la entrada', async ({ page }) => {
  let fallar = true
  await preparar(page, incompleto(), (route, dar) => fallar
    ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'Respuesta sintética fallida', code: 'unexpected_failure' }) })
    : dar(USUARIO))
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('No pudimos comprobar tu sesión')
  await expect(page.getByRole('heading', { name: 'Mis quinielas', exact: true })).toHaveCount(0)
  fallar = false
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click()
  await expect(page.getByText('Hola, Perfil cargado', { exact: false })).toBeVisible()
})

test('una respuesta verificada de otra cuenta no abre el Hub', async ({ page }) => {
  await preparar(page, incompleto(), (_route, dar) => dar({ ...USUARIO, id: '00000000-0000-4000-8000-000000000002' }))
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('No pudimos comprobar tu sesión')
  await expect(page.getByRole('heading', { name: 'Mis quinielas', exact: true })).toHaveCount(0)
})
