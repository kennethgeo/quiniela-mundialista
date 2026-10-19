import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO, respuestaFilas } from './apoyo.js'

const LIGA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const AHORA = new Date('2026-11-25T15:00:00Z')
const PERFIL = {
  id: USUARIO.id, display_name: 'Prueba', avatar_url: null, total_points: 5,
  points_adjustment: 0, is_admin: false, created_at: '2026-01-01', updated_at: '2026-01-01',
}
const GRUPO = {
  id: LIGA, name: 'Confianza', tournament_id: 7, invitation_code: 'ABC123',
  powerup_limit: 1, points_exact: 5, points_correct: 2,
  champion_points: 12, scorer_points: 12, assist_points: 12,
  is_admin: false, rules_accepted: true, rules: null, members_count: 3,
  tournament_kind: 'league', tournament_status: 'active',
  powerup_limits: { Semifinal: 2 }, tournament_ref: 'crc.1',
}
const PARTIDO = {
  id: '00000001-0000-4000-8000-000000000000', tournament_id: 7, phase: 'groups', matchday: 12,
  home_team: 'Saprissa', away_team: 'Alajuelense', home_team_code: 'xx', away_team_code: 'xx',
  status: 'pending', kickoff_at: '2026-11-29T01:00:00Z', stage: null,
  home_goals_actual: null, away_goals_actual: null, events_json: [],
}
const OTRO = { ...PARTIDO, id: '00000002-0000-4000-8000-000000000000', home_team: 'Herediano', away_team: 'Cartaginés' }
const pred = (m, extra = {}) => ({
  id: `p-${m.id}`, match_id: m.id, user_id: USUARIO.id, league_id: LIGA, prediction_type: 'Marcador',
  home_goals_pred: 0, away_goals_pred: 0, penalties_winner_pred: null, use_powerup_x2: false,
  points_earned: 0, ...extra,
})

async function montar(page, { partidos = [PARTIDO, OTRO], predicciones = [], propuestas = [], tab = 'matches',
  path, rechazar = false, demora = 0 } = {}) {
  const escrituras = []
  await sinRedExterna(page)
  await conSesion(page)
  await page.clock.setFixedTime(AHORA)
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_seen', 'true')
    localStorage.setItem('pwaPromptDismissed', 'true')
  })
  await interceptarSupabase(page, {
    '/rest/v1/users': PERFIL,
    'rpc/my_groups': [GRUPO], 'rpc/quiniela_por_id': GRUPO,
    '/rest/v1/matches': partidos, 'rpc/league_proposals': propuestas,
    'rpc/cupos_por_jornada': [], '/rest/v1/user_stats_view': null,
  })
  await page.route('**://pruebas.supabase.co/rest/v1/predictions**', async (route) => {
    const req = route.request()
    if (req.method() === 'POST') {
      escrituras.push(req.postDataJSON())
      if (rechazar) return route.fulfill({ status: 400, contentType: 'application/json',
        body: JSON.stringify({ code: 'P0001', message: 'Límite de comodines x2 alcanzado' }) })
      return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' })
    }
    if (demora) await new Promise((resolve) => setTimeout(resolve, demora))
    return route.fulfill(respuestaFilas(req, predicciones))
  })
  await page.goto(path || `/q/${LIGA}?tab=${tab}`)
  return escrituras
}

test('cuatro puntos por empate y penales no se etiquetan como marcador exacto', async ({ page }) => {
  const m = { ...PARTIDO, status: 'finished', home_goals_actual: 0, away_goals_actual: 0, kickoff_at: '2026-11-24T01:00:00Z' }
  const escrituras = await montar(page, { partidos: [m], predicciones: [pred(m, { home_goals_pred: 1, away_goals_pred: 1, points_earned: 4 })] })
  await expect(page.getByText('+4 · ACIERTO', { exact: true })).toBeVisible()
  await expect(page.getByText('+4 · EXACTO', { exact: true })).toHaveCount(0)
  expect(escrituras).toHaveLength(0)
})

test('un marcador exacto con regla personalizada de dos puntos sigue siendo exacto', async ({ page }) => {
  const m = { ...PARTIDO, status: 'finished', home_goals_actual: 0, away_goals_actual: 0, kickoff_at: '2026-11-24T01:00:00Z' }
  await montar(page, { partidos: [m], predicciones: [pred(m, { points_earned: 2 })] })
  await expect(page.getByText('+2 · EXACTO', { exact: true })).toBeVisible()
})

test('la predicción futura no reduce la efectividad del resumen', async ({ page }) => {
  const terminado = { ...PARTIDO, status: 'finished', home_goals_actual: 0, away_goals_actual: 0 }
  await montar(page, { tab: 'home', partidos: [terminado, OTRO], predicciones: [pred(terminado, { points_earned: 5 }), pred(OTRO)] })
  await expect(page.getByText('100%', { exact: true })).toBeVisible()
  await expect(page.getByText('1/1 finalizados', { exact: true })).toBeVisible()
})

test('el perfil cuenta una vez un exacto repetido entre dos quinielas', async ({ page }) => {
  const m = { ...PARTIDO, status: 'finished', home_goals_actual: 0, away_goals_actual: 0 }
  await montar(page, { path: '/profile', partidos: [m], predicciones: [pred(m, { points_earned: 5 }), pred(m, { id: 'otra', league_id: 'otra', points_earned: 10 })] })
  await expect(page.getByText('Exactos', { exact: true }).locator('..')).toContainText('1')
  await expect(page.getByText('Efectividad', { exact: true }).locator('..')).toContainText('100%')
})

test('la votación revela el asistidor y los cupos añadidos, eliminados y en cero', async ({ page }) => {
  await montar(page, { tab: 'rules', propuestas: [{
    id: 'propuesta', kind: 'scoring', status: 'open', members: 3, yes_count: 1, no_count: 0,
    payload: { assist_points: 0, powerup_limits: { Final: 0 } },
  }] })
  await expect(page.getByRole('heading', { name: 'Propuesta en votación' })).toBeVisible()
  const propuesta = page.getByRole('heading', { name: 'Propuesta en votación' }).locator('../..')
  await expect(propuesta.getByText('Acertar asistidor', { exact: true }).locator('..')).toContainText(/12\s*→\s*0/)
  await expect(propuesta.getByText('Comodines ×2 · Semifinal', { exact: true }).locator('..')).toContainText(/2\s*→\s*Cupo general/)
  await expect(propuesta.getByText('Comodines ×2 · Final', { exact: true }).locator('..')).toContainText(/Cupo general\s*→\s*0/)
  await expect(page.getByText('Sin cambios respecto al puntaje actual.')).toHaveCount(0)
})

test('el lote exige confirmar ceros y elegir penales; guarda todo en una sola petición', async ({ page }) => {
  const partidos = [PARTIDO, OTRO].map((m) => ({ ...m, phase: 'knockout', matchday: null, stage: 'Semifinal · Vuelta' }))
  const escrituras = await montar(page, { partidos })
  await page.getByRole('button', { name: 'LLENAR' }).click()
  const lote = page.getByRole('dialog', { name: /Predecir/ })
  const guardar = lote.getByRole('button', { name: 'Guardar los 2' })
  await expect(guardar).toBeDisabled()
  await lote.getByRole('checkbox', { name: /Confirmo los 2 marcadores/ }).check()
  await lote.getByRole('button', { name: 'Alajuelense', exact: true }).click()
  await expect(guardar).toBeDisabled()
  expect(escrituras).toHaveLength(0)
  await lote.getByRole('button', { name: 'Herediano', exact: true }).click()
  await guardar.click()
  await expect.poll(() => escrituras.length).toBe(1)
  expect(escrituras[0]).toHaveLength(2)
  expect(escrituras[0][0]).toMatchObject({ match_id: PARTIDO.id, penalties_winner_pred: 'Alajuelense' })
  expect(escrituras[0][1]).toMatchObject({ match_id: OTRO.id, penalties_winner_pred: 'Herediano' })
  await expect(lote).toHaveCount(0)
})

test('mover el ×2 conserva el orden del lote y un rechazo mantiene la edición abierta', async ({ page }) => {
  const escrituras = await montar(page, { rechazar: true,
    predicciones: [pred(PARTIDO, { use_powerup_x2: true }), pred(OTRO)] })
  await page.getByRole('button', { name: 'LLENAR' }).click()
  const lote = page.getByRole('dialog', { name: /Predecir/ })
  await lote.getByTitle('Quitar el comodín ×2').click()
  await lote.getByTitle('Usar el comodín ×2').last().click()
  await lote.getByRole('button', { name: 'Un gol más' }).first().click()
  await lote.getByRole('button', { name: 'Guardar los 2' }).click()
  await expect(lote.getByRole('alert')).toContainText(/comodines/i)
  expect(escrituras).toHaveLength(1)
  expect(escrituras[0].map((p) => p.use_powerup_x2)).toEqual([false, true])
  expect(escrituras[0][0]).toMatchObject({ match_id: PARTIDO.id, home_goals_pred: 1 })
  await expect(lote.getByRole('button', { name: 'Guardar los 2' })).toBeEnabled()
  await expect(lote).toBeVisible()
})

test('no abre un lote con datos vacíos mientras todavía se cargan las predicciones', async ({ page }) => {
  await montar(page, { demora: 1800, predicciones: [pred(PARTIDO, { home_goals_pred: 3 })] })
  await expect(page.getByRole('button', { name: 'Guardar predicción' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'LLENAR' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Actualizar predicción' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'LLENAR' })).toBeVisible()
})
