/* El editor de cupos de ×2 tiene que SERVIR con el torneo ya empezado.

   Dos veces seguidas se entregó una pantalla que no dejaba hacer nada:
   primero porque se ocultaba con una sola fase, después porque el candado era
   del TORNEO y no de la fase — la liga tica arranca en julio y sus
   semifinales son en diciembre, así que quedaba muerta cinco meses.

   Nada de esto lo veía una prueba: las de vitest miran lógica pura y ninguna
   abre la pantalla. Por eso esta prueba afirma sobre LO QUE SE VE. */
import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, USUARIO } from './apoyo.js'

const LIGA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const grupo = {
  id: LIGA, name: 'Bundestica', tournament_id: 2, invitation_code: 'ABC123',
  powerup_limit: 2, points_exact: 3, points_correct: 1,
  champion_points: 12, scorer_points: 12, assist_points: 12,
  is_admin: true, rules_accepted: true, rules: null, members_count: 1,
  tournament_kind: 'league', tournament_status: 'active',
  powerup_limits: {},
}

/* El torneo YA EMPEZÓ: el primer partido fue hace meses. Es el caso real de
   Bundestica, y el que antes apagaba el editor entero. */
const partidos = [{
  id: '00000001-0000-4000-8000-000000000000',
  tournament_id: 2, phase: 'groups', matchday: 1, stage: 'Jornada 1',
  home_team: 'Local', away_team: 'Visita', home_team_code: 'xx', away_team_code: 'xx',
  status: 'finished', kickoff_at: '2026-07-24T02:00:00Z',
  home_goals_actual: 1, away_goals_actual: 0, events_json: [],
}]

async function montar (page, fases) {
  await conSesion(page)
  await interceptarSupabase(page, {
    '/rest/v1/users': [{
      id: USUARIO.id, display_name: 'Prueba', avatar_url: null,
      total_points: 0, points_adjustment: 0, is_admin: false,
      created_at: '2026-01-01', updated_at: '2026-01-01',
    }],
    'rpc/my_groups': [grupo],
    'rpc/quiniela_por_id': grupo,
    '/rest/v1/matches': partidos,
    '/rest/v1/predictions': [],
    'rpc/cupos_por_jornada': [],
    'rpc/fases_del_torneo': fases,
  })
  await page.goto(`/q/${LIGA}?tab=rules`)
}

// La fase regular ya empezó; la semifinal ni siquiera tiene partidos todavía.
const FASES = [
  { clave: 'groups', partidos: 90, jornadas: 18, existe: true, empezo: true },
  { clave: 'Semifinal', partidos: 0, jornadas: 0, existe: false, empezo: false },
]

const editor = (page) => page.getByRole('heading', { name: 'Comodines ×2 por fase' })

test('el editor se puede usar aunque el torneo ya haya empezado', async ({ page }) => {
  await montar(page, FASES)
  await expect(editor(page)).toBeVisible({ timeout: 10000 })

  // ESTO ES LO QUE FALTABA EN LA PANTALLA DEL REPORTE: sin poder agregar una
  // fase ni guardar, el editor es un cartel informativo.
  await expect(page.getByLabel(/Falta una fase/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Guardar' })).toBeVisible()
})

test('una fase pendiente se GUARDA; una ya empezada va a VOTACIÓN', async ({ page }) => {
  await montar(page, FASES)
  await expect(editor(page)).toBeVisible({ timeout: 10000 })

  // Se apunta a la etiqueta DE LA FILA, no a cualquier "ya empezó": el texto
  // de ayuda del editor también lo dice, y un selector ambiguo no prueba nada.
  await expect(page.getByText(/18 jornadas · ya empezó/)).toBeVisible()

  // La semifinal es en diciembre: se decide ahora o no se decide nunca, y la
  // decide el admin solo. El botón tiene que seguir siendo "Guardar".
  const pendiente = page.getByRole('spinbutton').nth(1)
  await pendiente.fill('1')
  await expect(page.getByRole('button', { name: /Guardar cupos por fase/ })).toBeVisible()

  /* Tocar la fase YA EMPEZADA cambia el botón ANTES de pulsarlo: el admin ve
     que eso va a votación en vez de descubrirlo con un error de la base. */
  await page.getByRole('spinbutton').first().fill('4')
  await expect(page.getByRole('button', { name: /Proponer cambio al grupo/ })).toBeVisible()
})

test('volver una fase empezada a su valor original NO pide votación', async ({ page }) => {
  /* Reenviar el mismo valor no es un cambio. Si contara como tal, no se podría
     guardar una fase nueva sin que todo el lote fuera a votación. */
  await montar(page, FASES)
  await expect(editor(page)).toBeVisible({ timeout: 10000 })

  const empezada = page.getByRole('spinbutton').first()
  await empezada.fill('4')
  await expect(page.getByRole('button', { name: /Proponer cambio al grupo/ })).toBeVisible()

  await empezada.fill('')
  await expect(page.getByRole('button', { name: /Guardar cupos por fase/ })).toBeVisible()
})

test('se puede agregar una ronda que el torneo todavía no publicó', async ({ page }) => {
  // Solo la fase regular: es lo que devuelve la base hoy para la tica y la
  // Champions, porque ESPN publica la postemporada más adelante.
  await montar(page, [FASES[0]])
  await expect(editor(page)).toBeVisible({ timeout: 10000 })

  await page.getByRole('button', { name: '+ Gran final' }).click()
  await expect(page.getByText('Gran final')).toBeVisible()
  await expect(page.getByText(/aún sin partidos/)).toBeVisible()
  await expect(page.getByRole('spinbutton').nth(1)).toBeEnabled()
})
