/* El filtro de la pestaña Partidos, sobre la pantalla de verdad.

   Ninguna prueba de vitest puede ver esto: `filtroPartidos.js` está probado
   aparte y pasa igual aunque la pantalla no lo llame, o aunque llame al filtro
   y siga pintando la lista entera. Lo que se afirma acá es SIEMPRE qué
   partidos se ven — no los query params, que la URL conserva aunque la app los
   ignore. */
import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

const LIGA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

/* Reloj clavado: «hoy» depende de la fecha, así que sin esto la prueba
   cambiaría de resultado según a qué hora corra CI. 15:00Z son las 9:00 am en
   Costa Rica (UTC-6 todo el año). */
const AHORA = new Date('2026-09-09T15:00:00Z')

const uuid = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`

const partido = (n, nombre, extra) => ({
  id: uuid(n), tournament_id: 6, phase: 'groups', matchday: 1, stage: 'Jornada 1',
  home_team: nombre, away_team: `Rival ${n}`, home_team_code: 'xx', away_team_code: 'xx',
  status: 'pending', kickoff_at: '2026-09-09T19:00:00Z',
  home_goals_actual: null, away_goals_actual: null, events_json: [], ...extra,
})

/* Una jornada como la de la Champions en pequeño: lo ya jugado por delante de
   lo de hoy, que es exactamente el problema — hay que bajar por los partidos
   terminados para llegar a los que todavía se pueden predecir. */
const PARTIDOS = [
  partido(1, 'Jugado uno', { status: 'finished', kickoff_at: '2026-09-08T19:00:00Z', home_goals_actual: 2, away_goals_actual: 1 }),
  partido(2, 'Jugado dos', { status: 'finished', kickoff_at: '2026-09-08T19:00:00Z', home_goals_actual: 0, away_goals_actual: 0 }),
  partido(3, 'Hoy abierto'),
  partido(4, 'Hoy tambien'),
  partido(5, 'Hoy predicho'),
  // Jornada 2: sirve para comprobar que el filtro no deja la pantalla vacía.
  partido(6, 'Semana que viene', { matchday: 2, stage: 'Jornada 2', kickoff_at: '2026-09-16T19:00:00Z' }),
  partido(7, 'Semana que viene dos', { matchday: 2, stage: 'Jornada 2', kickoff_at: '2026-09-16T19:00:00Z' }),
]

const GRUPO = {
  id: LIGA, name: 'Champions 26-27', tournament_id: 6, invitation_code: 'ABC123',
  powerup_limit: 2, points_exact: 3, points_correct: 1,
  champion_points: 12, scorer_points: 12, assist_points: 12,
  is_admin: false, rules_accepted: true, rules: null, members_count: 7,
  tournament_kind: 'league', tournament_status: 'active',
}

test.beforeEach(async ({ page }) => {
  await sinRedExterna(page)
  await conSesion(page)
  await page.clock.setFixedTime(AHORA)
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_seen', 'true')
    localStorage.setItem('pwaPromptDismissed', 'true')
  })
  await interceptarSupabase(page, {
    /* OBJETO, no lista: AuthContext lo pide con `.single()` y con una lista
       el perfil queda en null — y sin perfil la app ni siquiera consulta las
       predicciones, así que «Por predecir» las contaría todas. */
    '/rest/v1/users': {
      id: USUARIO.id, display_name: 'Prueba', avatar_url: null,
      total_points: 0, points_adjustment: 0, is_admin: false,
      created_at: '2026-01-01', updated_at: '2026-01-01',
    },
    'rpc/my_groups': [GRUPO],
    'rpc/quiniela_por_id': GRUPO,
    '/rest/v1/matches': PARTIDOS,
    '/rest/v1/predictions': [{
      id: 'p1', league_id: LIGA, user_id: USUARIO.id, match_id: uuid(5),
      home_goals_pred: 1, away_goals_pred: 0, use_powerup_x2: false, points_earned: null,
    }],
    'rpc/cupos_por_jornada': [],
  })
})

const abrir = (page, extra = '') => page.goto(`/q/${LIGA}?tab=matches&j=Jornada+1${extra}`)
const tarjeta = (page, nombre) => page.getByText(nombre, { exact: true })
const chip = (page, nombre) => page.getByRole('group', { name: 'Filtrar partidos' }).getByRole('button', { name: nombre })

test('sin filtro se ve la jornada entera, jugados incluidos', async ({ page }) => {
  await abrir(page)
  await expect(tarjeta(page, 'Hoy abierto')).toBeVisible({ timeout: 15000 })
  await expect(tarjeta(page, 'Jugado uno')).toBeVisible()
})

test('«Hoy» esconde lo ya jugado y deja solo los de hoy', async ({ page }) => {
  await abrir(page)
  await expect(tarjeta(page, 'Jugado uno')).toBeVisible({ timeout: 15000 })

  await chip(page, /^Hoy/).click()

  await expect(tarjeta(page, 'Hoy abierto')).toBeVisible()
  await expect(tarjeta(page, 'Hoy tambien')).toBeVisible()
  await expect(tarjeta(page, 'Hoy predicho')).toBeVisible()
  // Lo que se venía a resolver: no bajar por los terminados.
  await expect(tarjeta(page, 'Jugado uno')).toHaveCount(0)
  await expect(tarjeta(page, 'Jugado dos')).toHaveCount(0)
})

test('«Por predecir» deja solo lo que falta, sin lo ya predicho', async ({ page }) => {
  await abrir(page)
  await expect(tarjeta(page, 'Jugado uno')).toBeVisible({ timeout: 15000 })

  await chip(page, /^Por predecir/).click()

  await expect(tarjeta(page, 'Hoy abierto')).toBeVisible()
  await expect(tarjeta(page, 'Hoy tambien')).toBeVisible()
  await expect(tarjeta(page, 'Hoy predicho')).toHaveCount(0)
  await expect(tarjeta(page, 'Jugado uno')).toHaveCount(0)
})

test('el chip lleva la cuenta de lo que deja ver', async ({ page }) => {
  await abrir(page)
  // 5 en la jornada, 3 hoy, 2 por predecir (el quinto ya tiene marcador puesto).
  await expect(chip(page, /^Todos/)).toContainText('5', { timeout: 15000 })
  await expect(chip(page, /^Hoy/)).toContainText('3')
  await expect(chip(page, /^Por predecir/)).toContainText('2')
})

test('el filtro sobrevive al entrar a un partido y volver', async ({ page }) => {
  await abrir(page)
  await expect(tarjeta(page, 'Jugado uno')).toBeVisible({ timeout: 15000 })
  await chip(page, /^Hoy/).click()
  await expect(tarjeta(page, 'Jugado uno')).toHaveCount(0)

  await page.goto(`/match/${uuid(3)}`)
  await page.waitForTimeout(500)
  await page.goBack()

  // Si el filtro viviera en useState, acá volverían a verse los terminados.
  await expect(tarjeta(page, 'Hoy abierto')).toBeVisible({ timeout: 15000 })
  await expect(tarjeta(page, 'Jugado uno')).toHaveCount(0)
})

/* El callejón sin salida: un filtro guardado que en otra jornada no tiene
   partidos. Antes que una lista vacía —que se lee como «la app se rompió»— se
   enseña la jornada entera. */
test('un filtro sin partidos en esa jornada no deja la pantalla vacía', async ({ page }) => {
  await page.goto(`/q/${LIGA}?tab=matches&j=Jornada+2&f=hoy`)

  await expect(tarjeta(page, 'Semana que viene')).toBeVisible({ timeout: 15000 })
  await expect(tarjeta(page, 'Semana que viene dos')).toBeVisible()
  // Y el chip de «Hoy» ni se ofrece, porque ahí no hay nada hoy.
  await expect(chip(page, /^Hoy/)).toHaveCount(0)
})
