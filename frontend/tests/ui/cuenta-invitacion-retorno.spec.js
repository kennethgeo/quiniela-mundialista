import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO, respuestaFilas } from './apoyo.js'

const LIGA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PARTIDO = {
  id: '00000001-0000-4000-8000-000000000000', tournament_id: 7, phase: 'groups', matchday: 12,
  home_team: 'Saprissa', away_team: 'Alajuelense', home_team_code: 'xx', away_team_code: 'xx',
  status: 'finished', kickoff_at: '2026-09-01T01:00:00Z', home_goals_actual: 2, away_goals_actual: 1,
  home_flag_url: 'https://escudos.test/saprissa.png', events_json: [],
}
async function preparar(page, { admin = false, user = USUARIO } = {}) {
  await sinRedExterna(page)
  await conSesion(page)
  await page.addInitScript(user => {
    localStorage.setItem('tutorial_seen', 'true')
    localStorage.setItem('pwaPromptDismissed', 'true')
    const session = JSON.parse(localStorage.getItem('sb-pruebas-auth-token'))
    session.user = user
    localStorage.setItem('sb-pruebas-auth-token', JSON.stringify(session))
  }, user)
  const grupo = {
    id: LIGA, name: 'Pruebas UX', tournament_id: 7, invitation_code: 'ABC123',
    points_exact: 3, points_correct: 1, powerup_limit: 2, is_admin: admin,
    soy_creador: admin, rules_accepted: true, rules: 'Reglas iniciales',
    tournament_kind: 'league', tournament_status: 'active', tournament_ref: 'crc.1',
  }
  let perfil = { id: user.id, display_name: 'Prueba', avatar_url: null, total_points: 0, is_admin: false }
  const escrituras = []
  await interceptarSupabase(page, {
    'rpc/my_groups': [grupo], 'rpc/quiniela_por_id': [grupo],
    '/rest/v1/user_stats_view': { talisman_team: 'Saprissa', maldito_team: 'Club sin escudo' },
  })
  await page.route('**://pruebas.supabase.co/rest/v1/users**', route => {
    const req = route.request()
    if (req.method() === 'PATCH') {
      escrituras.push({ body: req.postDataJSON(), url: req.url() })
      perfil = { ...perfil, ...req.postDataJSON() }
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(perfil) })
  })
  await page.route('**://pruebas.supabase.co/rest/v1/matches**', route => {
    const url = new URL(route.request().url())
    const uno = url.searchParams.has('id')
    const cuerpo = uno ? (url.searchParams.get('id') === `eq.${PARTIDO.id}` ? PARTIDO : null) : [PARTIDO]
    return route.fulfill(respuestaFilas(route.request(), cuerpo))
  })
  return { escrituras }
}

test('editar nombre conserva el resto del perfil y ofrece el flujo de contraseña por correo', async ({ page }) => {
  const { escrituras } = await preparar(page)
  const correos = []
  await page.route('**://pruebas.supabase.co/auth/v1/recover**', route => {
    correos.push({ body: route.request().postDataJSON(), url: route.request().url() })
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await page.goto('/profile')
  await page.getByRole('button', { name: 'Editar nombre', exact: true }).click()
  await page.getByLabel('Nombre visible').fill('Nombre nuevo')
  await page.getByRole('button', { name: 'Guardar nombre', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Nombre nuevo', exact: true })).toBeVisible()
  expect(escrituras).toHaveLength(1)
  expect(escrituras[0].body).toEqual({ display_name: 'Nombre nuevo' })
  expect(escrituras[0].url).toContain(`id=eq.${USUARIO.id}`)
  expect(escrituras[0].url).toContain('display_name=eq.Prueba')
  await page.getByRole('button', { name: 'Cambiar contraseña por correo' }).click()
  await expect(page.getByRole('status')).toContainText(USUARIO.email)
  expect(correos).toHaveLength(1)
  expect(correos[0].body.email).toBe(USUARIO.email)
  expect(new URL(correos[0].url).searchParams.get('redirect_to')).toMatch(/\/reset-password$/)
})

test('un rechazo conserva el nombre escrito para corregirlo', async ({ page }) => {
  await preparar(page)
  await page.route('**://pruebas.supabase.co/rest/v1/users**', route => route.request().method() === 'PATCH'
    ? route.fulfill({ status: 409, contentType: 'application/json', body: '{"message":"Conflicto sintético"}' })
    : route.fallback())
  await page.goto('/profile')
  await page.getByRole('button', { name: 'Editar nombre', exact: true }).click()
  await page.getByLabel('Nombre visible').fill('Mi borrador')
  await page.getByRole('button', { name: 'Guardar nombre', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('No pudimos confirmar')
  await expect(page.getByLabel('Nombre visible')).toHaveValue('Mi borrador')
})

test('cambiar de cuenta descarta el formulario de la anterior', async ({ page }) => {
  const { escrituras } = await preparar(page)
  await page.goto('/profile')
  await page.getByRole('button', { name: 'Editar nombre', exact: true }).click()
  await page.getByLabel('Nombre visible').fill('Borrador privado A')
  const otra = { ...USUARIO, id: '00000000-0000-4000-8000-000000000002', email: 'otra@ticogames.test' }
  await page.route('**://pruebas.supabase.co/rest/v1/users**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ id: otra.id, display_name: 'Otra cuenta', is_admin: false, total_points: 0 }),
  }))
  await page.evaluate(user => {
    const session = JSON.parse(localStorage.getItem('sb-pruebas-auth-token'))
    session.user = user
    localStorage.setItem('sb-pruebas-auth-token', JSON.stringify(session))
    const channel = new BroadcastChannel('sb-pruebas-auth-token')
    channel.postMessage({ event: 'SIGNED_IN', session })
    channel.close()
  }, otra)
  await expect(page.getByRole('heading', { name: 'Otra cuenta', exact: true })).toBeVisible()
  await expect(page.getByLabel('Nombre visible')).toHaveCount(0)
  expect(escrituras).toHaveLength(0)
})

test('el perfil usa el escudo real y las iniciales cuando no conoce el equipo', async ({ page }) => {
  await preparar(page)
  await page.goto('/profile')
  await expect(page.getByAltText('Talisman')).toHaveAttribute('src', /saprissa\.png|data:image\/svg/)
  await expect(page.getByAltText('Maldito')).toHaveAttribute('src', /^data:image\/svg/)
})

for (const origen of ['hub', 'enlace']) test(`la invitación fallida permite reintentar desde ${origen}`, async ({ page }) => {
  await preparar(page)
  await page.addInitScript(codigo => localStorage.setItem('tico:invitacion', codigo), origen === 'hub' ? 'ABC123' : 'VIEJO1')
  let intentos = 0
  await page.route('**://pruebas.supabase.co/rest/v1/rpc/join_group_by_code', route => {
    intentos++
    expect(route.request().postDataJSON()).toEqual({ p_code: 'ABC123' })
    return route.fulfill({ status: intentos === 1 ? 400 : 200, contentType: 'application/json',
      body: JSON.stringify(intentos === 1 ? { message: 'Error sintético recuperable' } : { id: LIGA }) })
  })
  await page.goto(origen === 'hub' ? '/' : '/unirse/ABC123')
  await expect(page.getByText(/Error sintético recuperable/)).toBeVisible()
  expect(intentos).toBe(1)
  await page.getByRole('button', { name: 'Reintentar invitación' }).click()
  if (origen === 'hub') {
    await expect(page.getByLabel('Código de invitación')).toHaveValue('ABC123')
    await page.getByRole('button', { name: 'Unirme', exact: true }).click()
  }
  await expect(page.getByRole('heading', { name: 'Pruebas UX', exact: true })).toBeVisible()
  expect(intentos).toBe(2)
})

test('el detalle vuelve a la pestaña y jornada de origen', async ({ page }) => {
  await preparar(page)
  const origen = `/q/${LIGA}?tab=matches&jornada=12`
  await page.goto(origen)
  await page.getByRole('button', { name: 'Ver detalles del partido' }).click()
  await expect(page).toHaveURL(new RegExp(`/match/${PARTIDO.id}\\?group=${LIGA}`))
  await page.getByRole('button', { name: 'Volver a la quiniela' }).click()
  await expect(page).toHaveURL(origen)
})

test('un partido inexistente por enlace directo vuelve al grupo sin ruta rota', async ({ page }) => {
  await preparar(page)
  await page.goto(`/match/no-existe?group=${LIGA}`)
  await expect(page.getByText('Partido no encontrado.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Volver a Partidos' }).click()
  await expect(page).toHaveURL(`/q/${LIGA}`)
})

test('Reglas es de consulta, Admin conserva un borrador al cambiar de pestaña', async ({ page }) => {
  await preparar(page, { admin: true })
  await page.goto(`/q/${LIGA}?tab=rules`)
  await expect(page.getByText('Reglas iniciales', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Editar|Proponer cambio/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Admin', exact: true }).click()
  const reglas = page.getByRole('heading', { name: 'Reglas', exact: true }).locator('../../..')
  await reglas.getByRole('button', { name: 'Proponer cambio', exact: true }).click()
  await reglas.locator('textarea').first().fill('Borrador sin guardar')
  await page.getByRole('button', { name: 'Reglas', exact: true }).click()
  await expect(page.getByText('Reglas iniciales', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Enviar a votación/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Admin', exact: true }).click()
  await expect(reglas.locator('textarea').first()).toHaveValue('Borrador sin guardar')
})

test('un miembro no tiene editores ni pestaña Admin', async ({ page }) => {
  await preparar(page)
  await page.goto(`/q/${LIGA}?tab=rules`)
  await expect(page.getByText('Reglas iniciales', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Admin', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Editar|Proponer cambio|hacer admin/ })).toHaveCount(0)
})

for (const oscuro of [false, true]) test(`correo sin verificar: reintento y salida en tema ${oscuro ? 'oscuro' : 'claro'}`, async ({ page }) => {
  await preparar(page, { user: { ...USUARIO, email_confirmed_at: null } })
  await page.addInitScript(oscuro => localStorage.setItem('qm_theme', oscuro ? 'dark' : 'light'), oscuro)
  await page.route('**://pruebas.supabase.co/auth/v1/resend', route => route.fulfill({ status: 429, contentType: 'application/json', body: '{"message":"Límite sintético"}' }))
  await page.route('**://pruebas.supabase.co/auth/v1/logout**', route => route.fulfill({ status: 204 }))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Email no verificado' })).toBeVisible()
  await expect(page.locator('html')).toHaveClass(oscuro ? /dark/ : /^(?!.*dark)/)
  const color = await page.getByRole('heading', { name: 'Email no verificado' }).evaluate(el => getComputedStyle(el).color)
  if (oscuro) expect(color).toBe('rgb(255, 255, 255)')
  else expect(color).toMatch(/oklch\(0\.208|rgb\(15, 23, 42\)/)
  await page.getByRole('button', { name: 'Reenviar el correo' }).click()
  await expect(page.getByRole('alert')).toContainText('No pudimos reenviar')
  await page.screenshot({ path: `node_modules/.cache/qa-correo-${oscuro ? 'oscuro' : 'claro'}.png` })
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click()
  await expect(page).toHaveURL('/auth')
})

const jornada = (extra = {}) => ({ jkey: 'J12', label: 'Jornada 12', cerrada: true, partidos: 1, terminados: 1,
  ganador: { user_id: USUARIO.id, display_name: 'Ganador anterior', puntos: 7 }, ...extra })

test('la tarjeta consulta el ganador actualizado y descarga un PNG', async ({ page }) => {
  await preparar(page)
  await page.addInitScript(() => {
    window.textosTarjeta = []
    const original = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function (texto, ...args) {
      window.textosTarjeta.push(texto)
      return original.call(this, texto, ...args)
    }
  })
  let lecturas = 0
  await page.route('**://pruebas.supabase.co/rest/v1/rpc/league_jornadas', route => {
    lecturas++
    const j = lecturas === 1 ? jornada() : jornada({ ganador: { user_id: 'otra', display_name: 'Ganadora corregida', puntos: 8 } })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jornadas: [j], rachas: [] }) })
  })
  await page.goto(`/q/${LIGA}?tab=historico`)
  const descarga = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Compartir ganador de jornada' }).click()
  const png = await descarga
  await png.saveAs('node_modules/.cache/qa-ganador-jornada.png')
  expect([...readFileSync(await png.path()).subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(lecturas).toBe(2)
  const textos = await page.evaluate(() => window.textosTarjeta)
  expect(textos).toContain('Ganadora corregida')
  expect(textos).toContain('8 pts')
  expect(textos).not.toContain('Ganador anterior')
})

test('si una corrección reabre la jornada, no exporta el ganador anterior', async ({ page }) => {
  await preparar(page)
  let lecturas = 0
  let descargas = 0
  page.on('download', () => descargas++)
  await page.route('**://pruebas.supabase.co/rest/v1/rpc/league_jornadas', route => {
    lecturas++
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jornadas: [jornada({ cerrada: lecturas === 1 })], rachas: [] }) })
  })
  await page.goto(`/q/${LIGA}?tab=historico`)
  await page.getByRole('button', { name: 'Compartir ganador de jornada' }).click()
  await expect(page.getByRole('alert')).toContainText('ya no tiene un ganador confirmado')
  expect(descargas).toBe(0)
})

test('una jornada sin puntos queda sin ganador y no ofrece tarjeta', async ({ page }) => {
  await preparar(page)
  await page.route('**://pruebas.supabase.co/rest/v1/rpc/league_jornadas', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ jornadas: [jornada({ ganador: null })], rachas: [] }),
  }))
  await page.goto(`/q/${LIGA}?tab=historico`)
  await expect(page.getByText(/Última cerrada.*sin ganador/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Compartir ganador de jornada' })).toHaveCount(0)
})
