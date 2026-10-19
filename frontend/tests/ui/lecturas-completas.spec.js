import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, respuestaFilas, USUARIO } from './apoyo.js'

const LIGA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const perfil = { id: USUARIO.id, display_name: 'Lecturas', is_admin: false, total_points: 0, avatar_url: null }
const partido = id => ({ id, tournament_id: 7, phase: 'groups', matchday: id,
  home_team: `Local ${id}`, away_team: `Visitante ${id}`, home_team_code: 'xx', away_team_code: 'xx',
  kickoff_at: '2026-09-01T01:00:00Z', status: 'finished', home_goals_actual: 2, away_goals_actual: 1, events_json: [],
})
const prediccion = id => ({ id: `p-${id}`, user_id: USUARIO.id, league_id: LIGA, match_id: id,
  home_goals_pred: id === 1201 ? 2 : 0, away_goals_pred: id === 1201 ? 1 : 0, points_earned: id === 1201 ? 3 : 0,
})
async function preparar(page) {
  await sinRedExterna(page)
  await conSesion(page)
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_seen', 'true'); localStorage.setItem('pwaPromptDismissed', 'true')
  })
  await interceptarSupabase(page, { '/rest/v1/users': perfil, '/rest/v1/user_stats_view': null })
}

async function perfilGrande(page, { fallar = () => false } = {}) {
  await preparar(page)
  const partidos = Array.from({ length: 1201 }, (_, i) => partido(i + 1))
  const predicciones = partidos.map(m => prediccion(m.id))
  const lecturas = { matches: [], predictions: [] }
  await page.route('**://pruebas.supabase.co/rest/v1/matches**', route => {
    const offset = Number(new URL(route.request().url()).searchParams.get('offset') || 0)
    lecturas.matches.push(offset)
    return route.fulfill(respuestaFilas(route.request(), partidos, { limiteServidor: 200 }))
  })
  await page.route('**://pruebas.supabase.co/rest/v1/predictions**', route => {
    const offset = Number(new URL(route.request().url()).searchParams.get('offset') || 0)
    lecturas.predictions.push(offset)
    if (fallar() && offset === 200) return route.fulfill({ status: 400, contentType: 'application/json', body: '{"message":"Página intermedia fallida"}' })
    return route.fulfill(respuestaFilas(route.request(), predicciones, { limiteServidor: 200 }))
  })
  return lecturas
}

test('el perfil cuenta 1201 partidos completos aunque la API entregue páginas de 200', async ({ page }) => {
  const lecturas = await perfilGrande(page)
  await page.goto('/profile')
  await expect(page.getByText('Exactos', { exact: true }).locator('..')).toContainText('1')
  await expect(page.getByText('Desaciertos', { exact: true }).locator('..')).toContainText('1200')
  await expect(page.getByRole('button', { name: 'Mostrar más predicciones (50 de 1201)' })).toBeVisible()
  // Todas las páginas participan del total; el DOM se amplía solo al pedirlo.
  await page.getByRole('button', { name: 'Mostrar más predicciones (50 de 1201)' }).click()
  await expect(page.getByRole('button', { name: 'Mostrar más predicciones (100 de 1201)' })).toBeVisible()
  expect([...new Set(lecturas.matches)]).toEqual([0, 200, 400, 600, 800, 1000, 1200])
  expect([...new Set(lecturas.predictions)]).toEqual([0, 200, 400, 600, 800, 1000, 1200])
})

test('un fallo intermedio no se presenta como total ni como historial vacío y permite recuperar', async ({ page }) => {
  let fallar = true
  await perfilGrande(page, { fallar: () => fallar })
  await page.goto('/profile')
  await expect(page.getByRole('alert')).toContainText('No pudimos cargar el perfil completo')
  await expect(page.getByText('Exactos', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Todavía no hiciste predicciones', { exact: true })).toHaveCount(0)
  fallar = false
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click()
  await expect(page.getByText('Desaciertos', { exact: true }).locator('..')).toContainText('1200')
})

test('Histórico consulta únicamente la jornada visible y cambia el filtro al navegar', async ({ page }) => {
  await preparar(page)
  const partidos = [partido(1), { ...partido(2), kickoff_at: '2026-08-01T01:00:00Z' },
    { ...partido(3), kickoff_at: '2099-01-01T01:00:00Z', status: 'pending' }]
  await interceptarSupabase(page, {
    '/rest/v1/users': perfil, '/rest/v1/matches': partidos,
    'rpc/my_groups': [{ id: LIGA, name: 'Datos completos', tournament_id: 7, is_admin: false,
      rules_accepted: true, tournament_kind: 'league', tournament_status: 'active', points_exact: 3, points_correct: 1 }],
    'rpc/group_standings': [{ user_id: USUARIO.id, display_name: 'Lecturas', points: 0 }],
  })
  const filtros = []
  await page.route('**://pruebas.supabase.co/rest/v1/predictions**', route => {
    const req = route.request()
    if (req.headers().prefer?.includes('count=exact')) filtros.push(new URL(req.url()).searchParams.get('match_id'))
    return route.fulfill(respuestaFilas(req, partidos.map(m => prediccion(m.id))))
  })
  await page.goto(`/q/${LIGA}?tab=historico`)
  await expect(page.getByRole('button', { name: 'Jornada anterior' })).toBeEnabled()
  expect(filtros).toEqual(['in.(1)'])
  await page.getByRole('button', { name: 'Jornada anterior' }).click()
  await expect(page.getByRole('button', { name: 'Jornada anterior' })).toBeDisabled()
  expect(filtros).toEqual(['in.(1)', 'in.(2)'])
  expect(filtros.join()).not.toContain('3')
})

test('una lectura fallida del Histórico impide exportar una matriz parcial', async ({ page }) => {
  await preparar(page)
  await interceptarSupabase(page, {
    '/rest/v1/users': perfil, '/rest/v1/matches': [partido(1)],
    'rpc/my_groups': [{ id: LIGA, name: 'Datos completos', tournament_id: 7, is_admin: false,
      rules_accepted: true, tournament_kind: 'league', tournament_status: 'active' }],
  })
  await page.route('**://pruebas.supabase.co/rest/v1/predictions**', route => route.request().headers().prefer?.includes('count=exact')
    ? route.fulfill({ status: 400, contentType: 'application/json', body: '{"message":"Error sintético"}' })
    : route.fulfill(respuestaFilas(route.request(), [])))
  await page.goto(`/q/${LIGA}?tab=historico`)
  await expect(page.getByRole('alert')).toContainText('No pudimos cargar el Histórico completo')
  await expect(page.getByTitle('Compartir esta jornada como imagen')).toHaveCount(0)
})
