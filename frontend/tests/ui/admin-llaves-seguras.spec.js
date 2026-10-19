import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

const PARTIDOS = [
  { id: 1, tournament_id: 1, phase: 'quarter_finals', stage: null, status: 'pending',
    home_team: 'W74', away_team: 'W75', home_team_code: 'xx', away_team_code: 'xx',
    kickoff_at: '2026-11-29T01:00:00Z', score_locked: false, destapado_at: null },
  { id: 2, tournament_id: 7, phase: 'knockout', stage: 'Semifinal · Ida', status: 'pending',
    home_team: 'Saprissa', away_team: 'Alajuelense', home_team_code: 'xx', away_team_code: 'xx',
    kickoff_at: '2026-11-29T01:00:00Z', score_locked: false, destapado_at: null },
]

async function abrir(page, { rechazo = false, terminados = false } = {}) {
  const rows = structuredClone(PARTIDOS)
  if (terminados) rows[0].status = 'finished'
  const enviados = [], parches = []
  await sinRedExterna(page)
  await conSesion(page)
  await page.clock.setFixedTime(new Date('2026-11-25T15:00:00Z'))
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_seen', 'true'); localStorage.setItem('pwaPromptDismissed', 'true')
  })
  await interceptarSupabase(page, {
    '/rest/v1/users': { id: USUARIO.id, display_name: 'Admin', avatar_url: null, is_admin: true },
    '/rest/v1/tournaments': [{ id: 1, name: 'Mundial', kind: 'cup', status: 'active' }, { id: 7, name: 'Liga Tica', kind: 'league', status: 'active' }],
    'rpc/my_groups': [],
  })
  await page.route('**://pruebas.supabase.co/rest/v1/matches**', async (route) => {
    if (route.request().method() === 'PATCH') parches.push(route.request().postDataJSON())
    const url = new URL(route.request().url())
    const tid = url.searchParams.get('tournament_id')?.replace('eq.', '')
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows.filter((r) => !tid || String(r.tournament_id) === tid)) })
  })
  await page.route('**/_backend/api/admin/update-match-teams', async (route) => {
    const payload = route.request().postDataJSON()
    enviados.push({ payload, authorization: route.request().headers().authorization })
    if (rechazo) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ detail: 'El partido cambió mientras lo editabas. Recargá antes de guardar' }) })
    const match = rows.find((r) => r.id === payload.match_id && r.tournament_id === payload.tournament_id)
    for (const k of ['home_team', 'away_team', 'home_team_code', 'away_team_code']) match[k] = payload[k]
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ match }) })
  })
  await page.goto('/admin')
  await expect(page.getByRole('combobox', { name: 'Torneo de las llaves' })).toHaveValue('1')
  await expect(page.getByRole('group', { name: 'Cuartos · #1' })).toBeVisible()
  return { enviados, parches, rows }
}

const cruce = (page) => page.getByRole('group', { name: 'Cuartos · #1' })

test('seleccionar un torneo muestra sus cruces y guarda por backend con la versión vista', async ({ page }) => {
  const { enviados, parches, rows } = await abrir(page)
  await page.getByRole('combobox', { name: 'Torneo de las llaves' }).selectOption('7')
  const partido = page.getByRole('group', { name: 'Semifinal · Ida · #2' })
  await expect(partido.getByLabel('Equipo local')).toHaveValue('Saprissa')
  await expect(cruce(page)).toHaveCount(0)
  await partido.getByLabel('Equipo local').fill('Herediano')
  await partido.getByRole('button', { name: 'Guardar equipos' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Equipos actualizados' })).toBeVisible()
  expect(enviados).toHaveLength(1)
  expect(enviados[0].authorization).toBe('Bearer token-de-mentira')
  expect(enviados[0].payload).toMatchObject({ match_id: 2, tournament_id: 7, home_team: 'Herediano', expected: { home_team: 'Saprissa' } })
  expect(Object.keys(enviados[0].payload).sort()).toEqual(['away_team', 'away_team_code', 'expected', 'home_team', 'home_team_code', 'match_id', 'tournament_id'])
  expect(rows[0].home_team).toBe('W74')
  expect(parches).toHaveLength(0)
})

test('un conflicto conserva la edición y no anuncia éxito', async ({ page }) => {
  const { enviados } = await abrir(page, { rechazo: true })
  await cruce(page).getByLabel('Equipo local').fill('Argentina')
  await cruce(page).getByRole('button', { name: 'Guardar equipos' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'El partido cambió' })).toBeVisible()
  await expect(cruce(page).getByLabel('Equipo local')).toHaveValue('Argentina')
  await expect(page.getByText('Equipos actualizados.', { exact: false })).toHaveCount(0)
  expect(enviados).toHaveLength(1)
})

test('cambiar de torneo no descarta una edición sin avisar', async ({ page }) => {
  await abrir(page)
  await cruce(page).getByLabel('Equipo local').fill('Argentina')
  const selector = page.getByRole('combobox', { name: 'Torneo de las llaves' })
  await selector.selectOption('7')
  await expect(selector).toHaveValue('1')
  await expect(page.getByRole('alert').filter({ hasText: 'Guardá o descartá' })).toBeVisible()
  await expect(cruce(page).getByLabel('Equipo local')).toHaveValue('Argentina')
  await page.getByRole('button', { name: 'Descartar cambios' }).click()
  await selector.selectOption('7')
  await expect(page.getByRole('group', { name: 'Semifinal · Ida · #2' })).toBeVisible()
})

test('los cruces terminados son de lectura y el respaldo legado ya no existe', async ({ page }) => {
  const { enviados } = await abrir(page, { terminados: true })
  await expect(cruce(page).getByLabel('Equipo local')).toBeDisabled()
  await expect(cruce(page).getByRole('button', { name: 'Guardar equipos' })).toBeDisabled()
  await page.getByRole('button', { name: 'Resultados', exact: true }).click()
  await expect(page.getByPlaceholder('Buscar por equipo...')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Respaldo Mundial' })).toHaveCount(0)
  expect(enviados).toHaveLength(0)
})
