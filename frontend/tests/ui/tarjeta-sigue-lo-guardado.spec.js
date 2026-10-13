/* La tarjeta de un partido tiene que mostrar —y mandar— LO GUARDADO.

   Lo destapó una prueba intermitente (`penales-en-la-ida.spec.js`, 13 oct
   2026): la tarjeta tomaba los goles de la predicción UNA vez, al montarse.
   La lista de partidos se dibuja apenas llegan los partidos, sin esperar las
   predicciones; si llegaban después, la tarjeta quedaba en 0-0 diciendo
   «Actualizar predicción» y «Tu predicción · 1–1», y tocar el botón PISABA
   el 1-1 guardado con un 0-0. Lo mismo después de guardar desde LLENAR: la
   tarjeta seguía con lo de antes y un «Actualizar» lo revertía.

   Las dos pruebas fuerzan el orden que antes salía a veces: no dependen de
   quién gana la carrera. */
import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

const LIGA = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const AHORA = new Date('2026-11-25T15:00:00Z')
const ID = '00000010-0000-4000-8000-000000000000'

const GRUPO = {
  id: LIGA, name: 'Bundestica', tournament_id: 7, invitation_code: 'ABC123',
  powerup_limit: 2, points_exact: 3, points_correct: 1,
  champion_points: 12, scorer_points: 12, assist_points: 12,
  is_admin: false, rules_accepted: true, rules: null, members_count: 17,
  tournament_kind: 'league', tournament_status: 'active',
  powerup_limits: {}, tournament_ref: 'crc.1',
}

const PARTIDO = {
  id: ID, tournament_id: 7, phase: 'groups', matchday: 12, stage: null,
  home_team: 'Saprissa', away_team: 'Alajuelense', home_team_code: 'xx', away_team_code: 'xx',
  status: 'pending', kickoff_at: '2026-11-29T01:00:00Z',
  home_goals_actual: null, away_goals_actual: null, events_json: [],
}

const OTRO = { ...PARTIDO, id: '00000011-0000-4000-8000-000000000000', home_team: 'Herediano', away_team: 'Cartaginés' }

async function montar (page, { demoraPredicciones = 0, partidos = [PARTIDO] } = {}) {
  // Lo que «la base» tiene guardado: el POST lo actualiza y el GET lo lee.
  let guardada = {
    id: 'guardada', league_id: LIGA, user_id: USUARIO.id, match_id: ID, prediction_type: 'Marcador',
    home_goals_pred: 1, away_goals_pred: 1, penalties_winner_pred: null,
    use_powerup_x2: false, points_earned: 0,
  }
  const enviados = []
  await sinRedExterna(page)
  await conSesion(page)
  await page.clock.setFixedTime(AHORA)
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_seen', 'true')
    localStorage.setItem('pwaPromptDismissed', 'true')
  })
  await interceptarSupabase(page, {
    '/rest/v1/users': {
      id: USUARIO.id, display_name: 'Prueba', avatar_url: null,
      total_points: 0, points_adjustment: 0, is_admin: false,
      created_at: '2026-01-01', updated_at: '2026-01-01',
    },
    'rpc/my_groups': [GRUPO],
    'rpc/quiniela_por_id': GRUPO,
    '/rest/v1/matches': partidos,
    'rpc/cupos_por_jornada': [],
  })
  await page.route('**://pruebas.supabase.co/rest/v1/predictions**', async (route) => {
    const req = route.request()
    if (req.method() === 'POST') {
      const cuerpo = req.postDataJSON()
      const filas = Array.isArray(cuerpo) ? cuerpo : [cuerpo]
      enviados.push(...filas)
      const nueva = filas.find((f) => f.match_id === ID)
      if (nueva) guardada = { ...guardada, ...nueva }
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(filas.map((f) => ({ id: f.match_id, points_earned: 0, ...f }))) })
    }
    if (demoraPredicciones) await new Promise((r) => setTimeout(r, demoraPredicciones))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([guardada]) })
  })
  await page.goto(`/q/${LIGA}?tab=matches`)
  return { enviados }
}

const tarjeta = (page) => page.locator(`[data-partido="${ID}"]`)
const actualizar = (page) => tarjeta(page).getByRole('button', { name: 'Actualizar predicción' })
// Los contadores de la tarjeta: «Saprissa 2 : 1 Alajuelense».
const marcador = (page, l, v) => expect(tarjeta(page)).toContainText(new RegExp(`Saprissa\\s*${l}\\s*:\\s*${v}\\s*Alajuelense`))

test('si la predicción llega después que los partidos, la tarjeta la toma y no la pisa', async ({ page }) => {
  const { enviados } = await montar(page, { demoraPredicciones: 1500 })
  // Primero la tarjeta sin predicción (los partidos ya llegaron)…
  await expect(page.getByRole('button', { name: 'Guardar predicción' })).toBeVisible({ timeout: 10000 })
  // …después llega la guardada y el botón cambia.
  await expect(actualizar(page)).toBeVisible({ timeout: 10000 })
  await marcador(page, 1, 1)
  await actualizar(page).click()
  await expect.poll(() => enviados.length).toBe(1)
  expect(enviados[0]).toMatchObject({ match_id: ID, home_goals_pred: 1, away_goals_pred: 1 })
})

test('lo guardado desde LLENAR se ve en la tarjeta, y «Actualizar» no lo revierte', async ({ page }) => {
  const { enviados } = await montar(page, { partidos: [PARTIDO, OTRO] })
  await expect(actualizar(page)).toBeVisible({ timeout: 10000 })
  await page.getByRole('button', { name: 'LLENAR' }).click()
  // La primera fila del lote es la de Saprissa (1–1 guardado): un gol más al local.
  await page.getByRole('button', { name: 'Un gol más' }).first().click()
  await marcador(page, 1, 1)
  // La relectura que dispara el guardado: recién con ella la tarjeta puede saber.
  const releida = page.waitForResponse((r) => r.url().includes('/rest/v1/predictions') && r.request().method() === 'GET')
  await page.getByRole('button', { name: 'Guardar los 2' }).click()
  await expect.poll(() => enviados.length).toBe(2)
  expect(enviados.find((f) => f.match_id === ID)).toMatchObject({ home_goals_pred: 2, away_goals_pred: 1 })
  await releida
  // La tarjeta ya dice 2–1 y, al tocar «Actualizar», manda 2–1 (no el 1–1 de antes).
  await marcador(page, 2, 1)
  await actualizar(page).click()
  await expect.poll(() => enviados.length).toBe(3)
  expect(enviados[2]).toMatchObject({ match_id: ID, home_goals_pred: 2, away_goals_pred: 1 })
})
