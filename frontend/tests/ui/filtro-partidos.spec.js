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
  partido(8, 'Hoy cuarto'),
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

/* EL REPORTE DEL DUEÑO, dos veces: «sigo teniendo que bajar a ver los de hoy».
   La pantalla tiene que ABRIR mostrando lo que todavía se puede predecir. Un
   filtro que hay que ir a buscar no resuelve eso. */
test('abre sin los partidos ya jugados', async ({ page }) => {
  await abrir(page)
  await expect(tarjeta(page, 'Hoy abierto')).toBeVisible({ timeout: 15000 })
  await expect(tarjeta(page, 'Jugado uno')).toHaveCount(0)
  await expect(tarjeta(page, 'Jugado dos')).toHaveCount(0)
})

test('«Todos» trae de vuelta los jugados, y la elección no se deshace sola', async ({ page }) => {
  await abrir(page)
  await expect(tarjeta(page, 'Hoy abierto')).toBeVisible({ timeout: 15000 })

  await chip(page, /^Todos/).click()
  await expect(tarjeta(page, 'Jugado uno')).toBeVisible()

  /* Si «Todos» no se guardara —borrando el parámetro en vez de escribirlo—,
     al volver de un partido la pantalla volvería a filtrar sola y los jugados
     desaparecerían otra vez. */
  await page.goto(`/match/${uuid(3)}`)
  await page.waitForTimeout(500)
  await page.goBack()
  await expect(tarjeta(page, 'Jugado uno')).toBeVisible({ timeout: 15000 })
})

/* El calendario es un botón que se usa una vez por torneo y estaba empujando
   los partidos fuera de pantalla — parte del mismo problema. */
test('el calendario va DEBAJO de la lista, no encima', async ({ page }) => {
  await abrir(page)
  const primera = tarjeta(page, 'Hoy abierto')
  await expect(primera).toBeVisible({ timeout: 15000 })
  const calendario = page.getByText('Llevar partidos a mi calendario')
  await expect(calendario).toBeVisible()
  const [a, b] = [await primera.boundingBox(), await calendario.boundingBox()]
  expect(b.y).toBeGreaterThan(a.y)
})

test('«Hoy» esconde lo ya jugado y deja solo los de hoy', async ({ page }) => {
  await abrir(page)
  await expect(tarjeta(page, 'Hoy abierto')).toBeVisible({ timeout: 15000 })

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
  await expect(tarjeta(page, 'Hoy abierto')).toBeVisible({ timeout: 15000 })

  await chip(page, /^Por predecir/).click()

  await expect(tarjeta(page, 'Hoy abierto')).toBeVisible()
  await expect(tarjeta(page, 'Hoy tambien')).toBeVisible()
  await expect(tarjeta(page, 'Hoy predicho')).toHaveCount(0)
  await expect(tarjeta(page, 'Jugado uno')).toHaveCount(0)
})

test('el chip lleva la cuenta de lo que deja ver', async ({ page }) => {
  await abrir(page)
  // La cuenta es SIEMPRE de la jornada entera, no de lo que dejó el filtro:
  // si no, «Todos» diría 3 estando filtrado y no habría manera de saber qué
  // se está escondiendo.
  await expect(chip(page, /^Todos/)).toContainText('6', { timeout: 15000 })
  await expect(chip(page, /^Hoy/)).toContainText('4')
  await expect(chip(page, /^Por predecir/)).toContainText('3')
})

test('el filtro sobrevive al entrar a un partido y volver', async ({ page }) => {
  await abrir(page)
  await expect(tarjeta(page, 'Hoy abierto')).toBeVisible({ timeout: 15000 })
  await chip(page, /^Por predecir/).click()
  await expect(tarjeta(page, 'Hoy predicho')).toHaveCount(0)

  await page.goto(`/match/${uuid(3)}`)
  await page.waitForTimeout(500)
  await page.goBack()

  // Si el filtro viviera en useState, acá volvería a verse el ya predicho.
  await expect(tarjeta(page, 'Hoy abierto')).toBeVisible({ timeout: 15000 })
  await expect(tarjeta(page, 'Hoy predicho')).toHaveCount(0)
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

/* La tarjeta de «hoy» era el bloque más alto de la pantalla: con los partidos
   de una jornada de Champions empujaba el primer partido predecible fuera de
   la vista. El encabezado se sigue viendo; la lista de horas se pide. */
test('con muchos partidos hoy, la lista de horas viene plegada', async ({ page }) => {
  await abrir(page)
  await expect(page.getByText('Hoy se juegan 4')).toBeVisible({ timeout: 15000 })

  const ver = page.getByRole('button', { name: /VER HORAS/ })
  await expect(ver).toBeVisible()
  // La hora solo aparece dentro de la tarjeta, no en las tarjetas de partido.
  await expect(page.getByText('1:00 pm').first()).toBeHidden()

  await ver.click()
  await expect(page.getByText('1:00 pm').first()).toBeVisible()
  // Compartir con el grupo sigue a un toque, plegada o no.
  await expect(page.getByRole('button', { name: /COMPARTIR/ })).toBeVisible()
})

test('lo primero que se ve es un partido que se puede predecir', async ({ page }) => {
  await abrir(page)
  const primera = page.getByRole('button', { name: /Guardar predicción/ }).first()
  await expect(primera).toBeVisible({ timeout: 15000 })
  const caja = await primera.boundingBox()
  const alto = page.viewportSize().height
  // Sin bajar: el botón de guardar entra en la primera pantalla.
  expect(caja.y + caja.height).toBeLessThanOrEqual(alto)
})

