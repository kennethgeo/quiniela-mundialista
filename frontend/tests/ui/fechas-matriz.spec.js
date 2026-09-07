import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

test.use({ timezoneId: 'UTC' })
const LIGA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const variantes = [
  ['Z', '2026-09-06T20:00:00Z'],
  ['UTC', '2026-09-06T20:00:00+00:00'],
  ['CR', '2026-09-06T14:00:00-06:00'],
  ['null', null], ['invalida', 'sin fecha'],
]
const partido = (kickoff_at, status = 'pending') => ({
  id: 9001, tournament_id: 6, phase: 'groups', matchday: 1, stage: 'Jornada 1',
  kickoff_at, status, home_team: 'Local', away_team: 'Visita', events_json: [],
})

async function preparar(page, match, ahora = '2026-09-06T19:30:00Z', extra = {}) {
  const errores = [], consola = [], sensibles = []
  page.on('pageerror', error => errores.push(error.message))
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consola.push(msg.text())
      // Los CDN se bloquean a propósito. Cualquier otro error, incluido el
      // ErrorBoundary o una petición local fallida, hace fallar la prueba.
      if (!msg.text().includes('net::ERR_FAILED')) errores.push(msg.text())
    }
  })
  page.on('request', req => {
    if (req.url().includes('/rest/v1/predictions') || req.url().includes('/refresh-live')) sensibles.push(req.url())
  })
  await page.clock.setFixedTime(new Date(ahora))
  await conSesion(page)
  await sinRedExterna(page)
  await page.routeWebSocket('wss://pruebas.supabase.co/**', () => {})
  await page.route('**/_backend/**', route => route.fulfill({ json: {} }))
  const grupo = { id: LIGA, name: 'Fechas de prueba', tournament_id: 6,
    rules_accepted: true, is_admin: true, powerup_limit: 2, members: 1,
    my_rank: 1, tournament_kind: 'league', tournament_status: 'active' }
  await interceptarSupabase(page, {
    '/rest/v1/users': [{ id: USUARIO.id, display_name: 'Prueba', total_points: 0 }],
    'rpc/my_groups': [grupo],
    'rpc/group_standings': [{ user_id: USUARIO.id, display_name: 'Prueba', points: 0 }],
    '/rest/v1/matches': url => {
      const params = new URL(url).searchParams
      // La consulta global de partidos ya iniciados tiene filtros de fecha;
      // esta fixture solo contiene el partido futuro/sin fecha del escenario.
      if (params.get('select') === 'id') return []
      return params.has('id') ? match : [match]
    },
    '/rest/v1/predictions': [{ id: 1, user_id: USUARIO.id, match_id: match.id,
      home_goals_pred: 2, away_goals_pred: 1, users: { display_name: 'Prueba' } }],
    ...extra,
  })
  return { errores, consola, sensibles }
}

async function evidencia(page, info, nombre, captura) {
  // Las aserciones ya esperan el contenido. Esta pausa es solo para capturar
  // el final de las transiciones de Motion, no cuadros de entrada/salida.
  await page.waitForTimeout(500)
  const path = info.outputPath(`${nombre}.png`)
  await page.screenshot({ path, fullPage: true })
  await info.attach(nombre, { path, contentType: 'image/png' })
  await info.attach(`${nombre}-consola`, { body: JSON.stringify(captura, null, 2), contentType: 'application/json' })
  expect(captura.errores).toEqual([])
  await expect(page.getByText(/Algo salió mal/)).toHaveCount(0)
}

for (const [nombre, fecha] of variantes) {
  test(`detalle, resumen y mensajes del día con ${nombre}`, async ({ page }, info) => {
    const captura = await preparar(page, partido(fecha))
    await page.goto('/match/9001')
    await expect(page.getByRole('heading', { name: 'Detalles del Partido' })).toBeVisible()
    await expect(page.getByText('Modo Incógnito', { exact: true })).toBeVisible()
    await expect(page.getByText(fecha && nombre !== 'invalida' ? '20:00' : 'Por confirmar', { exact: true })).toBeVisible()
    expect(captura.sensibles).toEqual([])
    await evidencia(page, info, `detalle-${nombre}`, captura)

    await page.goto(`/q/${LIGA}`)
    const fila = page.getByRole('button').filter({ hasText: 'falta tu pick' })
    await expect(fila).toContainText(fecha && nombre !== 'invalida' ? '20:00' : 'Por confirmar')
    await evidencia(page, info, `resumen-${nombre}`, captura)
    await page.getByRole('button', { name: 'Admin', exact: true }).click()
    await expect(page.getByText(fecha && nombre !== 'invalida' ? '2:00 pm' : 'Hoy no se juega nada en esta quiniela.', { exact: true })).toBeVisible()
    await evidencia(page, info, `dia-${nombre}`, captura)
  })

  test(`Histórico con ${nombre} conserva el umbral aunque el estado sea finished`, async ({ page }, info) => {
    const captura = await preparar(page, partido(fecha, 'finished'), '2026-09-06T19:45:00Z')
    await page.goto(`/q/${LIGA}?tab=historico`)
    if (nombre === 'null' || nombre === 'invalida') {
      await expect(page.getByText('Todavía no hay nada que mostrar.')).toBeVisible()
      await expect(page.getByText('Jugador', { exact: true })).toHaveCount(0)
    } else {
      await expect(page.getByText('Jugador', { exact: true })).toBeVisible()
      await expect(page.getByText('1 partido · 1 jugador', { exact: true })).toBeVisible()
    }
    await evidencia(page, info, `historico-${nombre}`, captura)
  })
}

for (const [nombre, fecha] of variantes.slice(0, 3)) {
  for (const [instante, cerrado] of [['19:44:59.999', false], ['19:45:00.000', true], ['19:45:00.001', true]]) {
    test(`corte de 15 minutos ${nombre} a ${instante} en detalle e Histórico`, async ({ page }) => {
      const captura = await preparar(page, partido(fecha), `2026-09-06T${instante}Z`)
      await page.goto('/match/9001')
      await expect(page.getByRole('heading', { name: 'Detalles del Partido' })).toBeVisible()
      if (cerrado) await expect.poll(() => captura.sensibles.filter(url => url.includes('/predictions')).length).toBeGreaterThan(0)
      else {
        await expect(page.getByText('Modo Incógnito', { exact: true })).toBeVisible()
        expect(captura.sensibles).toEqual([])
      }
      expect(captura.sensibles.filter(url => url.includes('/refresh-live'))).toEqual([])
      await page.goto(`/q/${LIGA}?tab=historico`)
      await expect(page.getByText(cerrado ? 'Jugador' : 'Todavía no hay nada que mostrar.', { exact: true })).toBeVisible()
      expect(captura.errores).toEqual([])
    })
  }
}

for (const status of ['in_progress', 'finished', 'cancelled', 'postponed']) {
  test(`detalle sin fecha conserva revelado por estado ${status}`, async ({ page }) => {
    const captura = await preparar(page, partido(null, status))
    await page.goto('/match/9001')
    await expect(page.getByRole('heading', { name: 'Detalles del Partido' })).toBeVisible()
    if (status === 'in_progress' || status === 'finished') {
      await expect.poll(() => captura.sensibles.filter(url => url.includes('/predictions')).length).toBeGreaterThan(0)
    } else {
      await expect(page.getByText('Modo Incógnito', { exact: true })).toBeVisible()
      expect(captura.sensibles).toEqual([])
    }
    expect(captura.errores).toEqual([])
  })
}

test('Cara a cara ordena fechas mixtas y conserva el fallback de fechas desconocidas', async ({ page }, info) => {
  const fechas = [variantes[2], variantes[3], variantes[0], variantes[4], variantes[1]]
  const matches = fechas.map(([nombre, fecha], i) => ({ ...partido(fecha, 'finished'),
    id: 9100 + i, stage: `Fecha ${nombre}`, home_goals_actual: 2, away_goals_actual: 1 }))
  const captura = await preparar(page, matches[0], '2026-09-06T21:00:00Z', {
    '/rest/v1/matches': url => new URL(url).searchParams.get('select') === 'id' ? [] : matches,
    'rpc/group_standings': [
      { user_id: USUARIO.id, display_name: 'Prueba', points: 3, is_me: true },
      { user_id: 'rival', display_name: 'Rival', points: 0, is_me: false },
    ],
    'rpc/perfil_en_quiniela': { display_name: 'Rival', soy_yo: false,
      puntos: 0, miembros: 2, pos: 2, jugadas: 0, exactos: 0, aciertos: 0,
      error_goles: 0, x2_usados: 0, jornadas_ganadas: 0 },
  })
  await page.goto(`/q/${LIGA}?tab=standings`)
  await page.getByRole('button', { name: 'Tabla', exact: true }).click()
  await page.getByTitle('Ver a Rival en esta quiniela').click()
  await page.getByRole('button', { name: 'Cara a cara contra vos' }).click()
  await expect(page.getByRole('heading', { name: 'Cara a cara', exact: true })).toBeVisible()
  await expect(page.getByText(/^Fecha (null|invalida|CR|Z|UTC)$/)).toHaveText([
    'Fecha null', 'Fecha invalida', 'Fecha CR', 'Fecha Z', 'Fecha UTC',
  ])
  await evidencia(page, info, 'cara-a-cara-fechas-mixtas', captura)
})
