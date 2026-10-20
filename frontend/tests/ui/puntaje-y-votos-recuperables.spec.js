import { expect, test } from '@playwright/test'
import { env } from 'node:process'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

const LIGA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PROPUESTA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

async function abrir(page, { propuesta = false, votoFallido = false, guardarRetenido = false, futuros = false } = {}) {
  await sinRedExterna(page)
  await conSesion(page)
  await page.clock.setFixedTime(new Date('2026-10-20T03:00:00Z'))
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_seen', 'true')
    localStorage.setItem('pwaPromptDismissed', 'true')
  })
  const group = {
    id: LIGA, name: 'Bundestica', tournament_id: 2, invitation_code: '6BE60F',
    is_admin: true, soy_creador: true, members: 5, rules: 'Reglas del grupo', rules_accepted: true,
    tournament_name: 'Primera División', tournament_kind: 'league', tournament_ref: 'crc.1',
    points_exact: 3, points_correct: 1, powerup_limit: 2, powerup_por_partidos: null,
    champion_points: 12, scorer_points: 12, assist_points: 12,
  }
  const abierta = {
    id: PROPUESTA, kind: 'scoring', status: 'open', payload: { points_exact: 5 },
    members: 5, yes_count: 0, no_count: 0, my_vote: null, proposer_name: 'Caro',
    expires_at: '2026-10-22T03:00:00Z',
  }
  const votos = [], guardados = []
  let liberar
  const retenida = new Promise(resolve => { liberar = resolve })
  await page.route('**/_backend/api/**', r => r.fulfill({ json: { groups: [] } }))
  await interceptarSupabase(page, {
    '/rest/v1/users': { ...USUARIO, display_name: 'Prueba', is_admin: false },
    'rpc/my_groups': [group], 'rpc/quiniela_por_id': group,
    'rpc/league_proposals': () => propuesta ? [abierta] : [],
    '/rest/v1/matches': [{ id: 10, tournament_id: 2, phase: 'groups', matchday: 1,
      status: 'finished', home_team: 'Saprissa', away_team: 'Herediano',
      home_team_code: 'xx', away_team_code: 'xx', kickoff_at: '2026-09-01T01:00:00Z',
      home_goals_actual: 2, away_goals_actual: 0 }].flatMap(m => futuros
        ? [{ ...m, status: 'pending', kickoff_at: '2026-11-01T01:00:00Z' },
          { ...m, id: 11, status: 'pending', home_team: 'Alajuelense', away_team: 'Cartaginés', kickoff_at: '2026-11-01T03:00:00Z' }]
        : [m]),
  })
  await page.route('**/rest/v1/rpc/cast_rule_vote', async route => {
    const body = route.request().postDataJSON()
    votos.push(body)
    if (votoFallido && votos.length === 1) return route.fulfill({ status: 409, json: { message: 'No se guardó el voto de prueba' } })
    abierta.my_vote = body.p_vote
    abierta.yes_count = body.p_vote ? 1 : 0
    abierta.no_count = body.p_vote ? 0 : 1
    return route.fulfill({ json: null })
  })
  await page.route('**/rest/v1/rpc/propose_rule_change', async route => {
    guardados.push(route.request().postDataJSON())
    if (guardarRetenido && guardados.length === 1) {
      await retenida
      return route.fulfill({ status: 409, json: { message: 'El grupo cambió; revisá tu propuesta' } })
    }
    return route.fulfill({ json: PROPUESTA })
  })
  await page.goto(`/q/${LIGA}?tab=admin`)
  await expect(page.getByRole('heading', { name: 'Puntaje', exact: true })).toBeVisible()
  return { votos, guardados, liberar }
}

const puntaje = page => page.locator('.scoring-sheet')
const editor = page => puntaje(page).getByRole('button', { name: 'Proponer cambio', exact: true })

test('cambiar pestaña conserva el borrador; Cancelar descarta puntajes y motivo sin escribir', async ({ page }) => {
  const { guardados } = await abrir(page)
  if (env.QUINIELA_CAPTURAS) {
    for (const width of [390, 960]) {
      await page.setViewportSize({ width, height: 900 })
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme)
        await page.locator('.scoring-sheet').screenshot({ path: `node_modules/.cache/identidad-visual/puntaje-${width}-${theme}.png`, animations: 'disabled' })
      }
    }
  }
  await editor(page).click()
  await puntaje(page).getByLabel('Marcador exacto', { exact: true }).fill('9')
  await puntaje(page).getByLabel('Motivo del cambio').fill('Borrador para cancelar')
  await page.getByRole('button', { name: 'Reglas', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Enviar a votación' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Admin', exact: true }).click()
  await expect(puntaje(page).getByLabel('Marcador exacto', { exact: true })).toHaveValue('9')
  await expect(puntaje(page).getByLabel('Motivo del cambio')).toHaveValue('Borrador para cancelar')
  await puntaje(page).getByRole('button', { name: 'Cancelar', exact: true }).click()
  await editor(page).click()
  await expect(puntaje(page).getByLabel('Marcador exacto', { exact: true })).toHaveValue('3')
  await expect(puntaje(page).getByLabel('Motivo del cambio')).toHaveValue('')
  expect(guardados).toEqual([])
})

test('un rechazo conserva la propuesta, bloquea cambios en vuelo y permite reintentar', async ({ page }) => {
  const { guardados, liberar } = await abrir(page, { guardarRetenido: true })
  await editor(page).click()
  const campo = puntaje(page).getByLabel('Marcador exacto', { exact: true })
  await campo.fill('9')
  await puntaje(page).getByLabel('Motivo del cambio').fill('Probemos nueve')
  await puntaje(page).getByRole('button', { name: 'Enviar a votación' }).click()
  await expect(campo).toBeDisabled()
  await expect(puntaje(page).getByLabel('Motivo del cambio')).toBeDisabled()
  await expect(puntaje(page).getByRole('button', { name: 'Cancelar' })).toBeDisabled()
  await expect.poll(() => guardados.length).toBe(1)
  liberar()
  await expect(puntaje(page).getByRole('alert')).toContainText('El grupo cambió')
  await expect(campo).toHaveValue('9')
  await expect(puntaje(page).getByLabel('Motivo del cambio')).toHaveValue('Probemos nueve')
  await puntaje(page).getByRole('button', { name: 'Enviar a votación' }).click()
  await expect(editor(page)).toBeVisible()
  expect(guardados).toHaveLength(2)
  expect(guardados[1]).toEqual(guardados[0])
  expect(guardados[0]).toMatchObject({ p_league_id: LIGA, p_kind: 'scoring',
    p_payload: { points_exact: 9, powerup_por_partidos: null }, p_note: 'Probemos nueve' })
})

test('no trunca un decimal ni convierte un campo vacío en cero', async ({ page }) => {
  const { guardados } = await abrir(page)
  await editor(page).click()
  const campo = puntaje(page).getByLabel('Marcador exacto', { exact: true })
  for (const valor of ['3.5', '']) {
    await campo.fill(valor)
    await puntaje(page).getByRole('button', { name: 'Enviar a votación' }).click()
    await expect(puntaje(page).getByRole('alert')).toContainText('Marcador exacto: escribí un número entero')
    await expect(campo).toHaveValue(valor)
  }
  expect(guardados).toEqual([])
})

test('se puede cambiar el voto después del éxito sin recargar la página', async ({ page }) => {
  const { votos } = await abrir(page, { propuesta: true })
  const favor = page.getByRole('button', { name: 'A favor', exact: true })
  const contra = page.getByRole('button', { name: 'En contra', exact: true })
  await favor.click()
  await expect(favor).toHaveAttribute('aria-pressed', 'true')
  await expect(contra).toBeEnabled()
  await contra.click()
  await expect(contra).toHaveAttribute('aria-pressed', 'true')
  await expect(favor).toHaveAttribute('aria-pressed', 'false')
  await expect(favor).toBeEnabled()
  expect(votos).toEqual([{ p_proposal_id: PROPUESTA, p_vote: true }, { p_proposal_id: PROPUESTA, p_vote: false }])
  await expect(page.getByText('Tu voto:', { exact: false })).toContainText('en contra')
})

test('el voto rechazado muestra el error junto a los botones y permite reintentar', async ({ page }) => {
  const { votos } = await abrir(page, { propuesta: true, votoFallido: true })
  const favor = page.getByRole('button', { name: 'A favor', exact: true })
  await favor.click()
  await expect(page.locator('.voting-sheet').getByRole('alert')).toContainText('No se guardó el voto de prueba')
  await expect(favor).toBeEnabled()
  await expect(favor).toHaveAttribute('aria-pressed', 'false')
  await favor.click()
  await expect(favor).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.voting-sheet').getByRole('alert')).toHaveCount(0)
  expect(votos).toHaveLength(2)
})

test('un guardado rechazado señala su partido y conserva el marcador aunque se guarde otro', async ({ page }) => {
  await abrir(page, { futuros: true })
  const enviados = []
  await page.route('**/rest/v1/predictions*', async route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: [] })
    const body = route.request().postDataJSON()
    enviados.push(body)
    if (enviados.length === 1) return route.fulfill({ status: 409, json: { code: '40P01', message: 'deadlock detected' } })
    return route.fulfill({ json: [{ id: `pick-${body.match_id}`, ...body }] })
  })
  await page.getByRole('button', { name: 'Partidos', exact: true }).click()
  const primero = page.locator('[data-partido="10"]'), otro = page.locator('[data-partido="11"]')
  await primero.getByRole('button', { name: 'Sumar gol' }).first().click()
  await primero.getByRole('button', { name: 'Sumar gol' }).first().click()
  await primero.getByRole('button', { name: 'Guardar predicción', exact: true }).click()
  await expect(primero.getByRole('alert')).toContainText('se cruzó con otro cambio')
  await expect(otro.getByRole('alert')).toHaveCount(0)
  await otro.getByRole('button', { name: 'Guardar predicción', exact: true }).click()
  await expect(otro.getByRole('button', { name: 'Actualizar predicción' })).toBeVisible()
  await expect(primero.getByRole('alert')).toBeVisible()
  await primero.getByRole('button', { name: 'Guardar predicción', exact: true }).click()
  await expect(primero.getByRole('button', { name: 'Actualizar predicción' })).toBeVisible()
  await expect(primero.getByRole('alert')).toHaveCount(0)
  expect(enviados).toHaveLength(3)
  expect(enviados[0]).toMatchObject({ match_id: 10, home_goals_pred: 2, away_goals_pred: 0, league_id: LIGA, user_id: USUARIO.id })
  expect(enviados[2]).toEqual(enviados[0])
})
