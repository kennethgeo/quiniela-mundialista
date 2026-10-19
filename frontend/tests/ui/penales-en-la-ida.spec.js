/* «¿Quién gana en penales?» se pregunta solo si el partido PUEDE ir a penales.

   En la ida de una serie no hay tanda: la elección no puntúa nunca, y aun así
   la tarjeta bloqueaba «Guardar» hasta elegirla a quien predecía un empate.
   Ojo con lo que se afirma: no alcanza con que el selector no se vea; hay que
   comprobar que el guardado SALE y que manda `penalties_winner_pred` en null.
   Y la otra mitad: en una vuelta o una final única el selector sigue siendo
   obligatorio, o el arreglo habría apagado la pregunta para todos.

   Los `stage` son los que escribe el sync: «Fase · pierna». Las filas de antes
   de traducir la nota de ESPN dicen «1st Leg». */
import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

const LIGA = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const AHORA = new Date('2026-11-25T15:00:00Z')
const ID = '00000009-0000-4000-8000-000000000000'

const GRUPO = {
  id: LIGA, name: 'Bundestica', tournament_id: 7, invitation_code: 'ABC123',
  powerup_limit: 2, points_exact: 3, points_correct: 1,
  champion_points: 12, scorer_points: 12, assist_points: 12,
  is_admin: false, rules_accepted: true, rules: null, members_count: 17,
  tournament_kind: 'league', tournament_status: 'active',
  powerup_limits: {}, tournament_ref: 'crc.1',
}

/* Como lo deja el sync en una eliminatoria de liga: phase 'knockout',
   jornada nula y la ronda en `stage`. Arranca 0-0 en la tarjeta, o sea que
   la predicción por defecto YA es un empate. */
const partido = (stage, extra) => ({
  id: ID, tournament_id: 7, phase: 'knockout', matchday: null, stage,
  home_team: 'Saprissa', away_team: 'Alajuelense', home_team_code: 'xx', away_team_code: 'xx',
  status: 'pending', kickoff_at: '2026-11-29T01:00:00Z',
  home_goals_actual: null, away_goals_actual: null, events_json: [], ...extra,
})

async function montar(page, stage, { partidos = [partido(stage)], predicciones = [] } = {}) {
  const guardados = []
  await sinRedExterna(page)
  await conSesion(page)
  await page.clock.setFixedTime(AHORA)
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_seen', 'true')
    localStorage.setItem('pwaPromptDismissed', 'true')
  })
  await interceptarSupabase(page, {
    // OBJETO: AuthContext lo pide con `.single()`.
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
  /* Registrada DESPUÉS del comodín, así gana (Playwright usa la última). El
     guardado es `.upsert(...).select()`: un POST que devuelve las filas. */
  await page.route('**://pruebas.supabase.co/rest/v1/predictions**', async (route) => {
    const req = route.request()
    if (req.method() === 'POST') {
      const cuerpo = req.postDataJSON()
      const filas = Array.isArray(cuerpo) ? cuerpo : [cuerpo]
      guardados.push(...filas)
      return route.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify(filas.map((f) => ({ id: 'nueva', points_earned: 0, ...f }))),
      })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(predicciones) })
  })
  await page.goto(`/q/${LIGA}?tab=matches`)
  // El botón de guardar existe en todos los casos (habilitado o no): ancla la
  // tarjeta ya dibujada. El nombre del equipo no sirve: con el selector
  // visible aparece dos veces.
  await expect(page.getByRole('button', { name: /(Guardar|Actualizar) predicción/ }).first())
    .toBeVisible({ timeout: 10000 })
  return guardados
}

const pregunta = (page) => page.getByText('¿Quién gana en penales?')
const guardar = (page) => page.getByRole('button', { name: 'Guardar predicción' })

for (const stage of ['Semifinal · Ida', 'Final · 1st Leg']) {
  test(`en la ida (${stage}) un empate se guarda sin elegir la tanda`, async ({ page }) => {
    const guardados = await montar(page, stage)
    await expect(guardar(page)).toBeEnabled()
    // La ausencia se afirma DESPUÉS de que el botón ya está: así no se evalúa
    // sobre una tarjeta a medio dibujar.
    await expect(pregunta(page)).toHaveCount(0)
    await guardar(page).click()
    await expect.poll(() => guardados.length).toBe(1)
    expect(guardados[0]).toMatchObject({
      match_id: ID, home_goals_pred: 0, away_goals_pred: 0, penalties_winner_pred: null,
    })
  })
}

for (const stage of ['Semifinal · Vuelta', 'Final']) {
  test(`en un partido que puede ir a penales (${stage}) la tanda sigue siendo obligatoria`, async ({ page }) => {
    const guardados = await montar(page, stage)
    await expect(pregunta(page)).toBeVisible()
    await expect(guardar(page)).toBeDisabled()
    await page.getByRole('button', { name: 'Alajuelense', exact: true }).click()
    await expect(guardar(page)).toBeEnabled()
    await guardar(page).click()
    await expect.poll(() => guardados.length).toBe(1)
    expect(guardados[0]).toMatchObject({ match_id: ID, penalties_winner_pred: 'Alajuelense' })
  })
}

/* «LLENAR» (PredecirJornada) guarda la jornada en un solo lote y conserva la
   tanda que ya hubiera. Con la misma regla que la tarjeta: en una ida va null
   aunque haya quedado una elección de antes; en una vuelta se conserva. */
const SEGUNDO = '0000000a-0000-4000-8000-000000000000'
const serie = (stage) => [
  partido(stage),
  partido(stage, { id: SEGUNDO, home_team: 'Herediano', away_team: 'Cartaginés' }),
]
// Escrita cuando la tarjeta todavía pedía la tanda en la ida.
const previa = {
  id: 'vieja', league_id: LIGA, user_id: USUARIO.id, match_id: ID, prediction_type: 'Marcador',
  home_goals_pred: 1, away_goals_pred: 1, penalties_winner_pred: 'Saprissa',
  use_powerup_x2: false, points_earned: 0,
}

for (const [stage, esperada] of [['Semifinal · Ida', null], ['Semifinal · Vuelta', 'Saprissa']]) {
  test(`LLENAR en ${stage}: la tanda guardada va ${esperada === null ? 'null' : 'conservada'}`, async ({ page }) => {
    const guardados = await montar(page, stage, { partidos: serie(stage), predicciones: [previa] })
    await page.getByRole('button', { name: 'LLENAR' }).click()
    const lote = page.getByRole('dialog', { name: /Predecir/ })
    await lote.getByRole('checkbox', { name: /Confirmo los 1 marcadores/ }).check()
    if (stage.includes('Vuelta')) await lote.getByRole('button', { name: 'Cartaginés', exact: true }).click()
    await page.getByRole('button', { name: 'Guardar los 2' }).click()
    await expect.poll(() => guardados.length).toBe(2)
    const deLaSerie = guardados.find((f) => f.match_id === ID)
    expect(deLaSerie).toMatchObject({ home_goals_pred: 1, away_goals_pred: 1, penalties_winner_pred: esperada })
    expect(guardados.find((f) => f.match_id === SEGUNDO)).toMatchObject({ penalties_winner_pred: stage.includes('Vuelta') ? 'Cartaginés' : null })
  })
}

/* La tarjeta, con una tanda vieja guardada en la ida (revisión de la
   vigésima auditoría): sin esta prueba, volver a mandar la elección anterior
   pasaba con todo en verde. Solo LLENAR cubría la predicción previa. */
test('la tarjeta en la ida: al actualizar una predicción con tanda vieja, la tanda va null', async ({ page }) => {
  const guardados = await montar(page, 'Semifinal · Ida', { predicciones: [previa] })
  const actualizar = page.getByRole('button', { name: 'Actualizar predicción' })
  await expect(actualizar).toBeEnabled()
  await expect(pregunta(page)).toHaveCount(0)
  await actualizar.click()
  await expect.poll(() => guardados.length).toBe(1)
  expect(guardados[0]).toMatchObject({
    match_id: ID, home_goals_pred: 1, away_goals_pred: 1, penalties_winner_pred: null,
  })
})
