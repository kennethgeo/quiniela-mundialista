/* Un partido REABIERTO tiene que dejar CAMBIAR el marcador, no solo decirlo.

   La primera versión de la reapertura pasaba la política RLS y ponía el botón
   «Actualizar predicción», pero la tarjeta seguía pintando el marcador EN VIVO
   en vez de los +/−: había botón y no había nada que editar. Lo encontró el
   dueño, no una prueba. */
import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

const LIGA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const grupo = {
  id: LIGA, name: 'Champions', tournament_id: 6, invitation_code: 'ABC123',
  powerup_limit: 2, points_exact: 3, points_correct: 1, champion_points: 12,
  scorer_points: 12, assist_points: 12, is_admin: false, rules_accepted: true,
  rules: null, members_count: 1, tournament_kind: 'league', tournament_status: 'active',
  powerup_limits: {}, tournament_ref: 'uefa.champions',
}

const partido = (extra) => ({
  id: '00000001-0000-4000-8000-000000000000', tournament_id: 6,
  phase: 'groups', matchday: 1, stage: 'Jornada 1',
  home_team: 'AEK Athens', away_team: 'LASK Linz',
  home_team_code: 'xx', away_team_code: 'xx',
  status: 'in_progress', kickoff_at: '2026-09-08T16:45:00Z',
  home_goals_actual: 0, away_goals_actual: 0, events_json: [], ...extra,
})

async function montar (page, matchExtra) {
  await sinRedExterna(page)
  await conSesion(page)
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_seen', 'true'); localStorage.setItem('pwaPromptDismissed', 'true')
  })
  await interceptarSupabase(page, {
    '/rest/v1/users': [{ id: USUARIO.id, display_name: 'Prueba', avatar_url: null,
      total_points: 0, points_adjustment: 0, is_admin: false,
      created_at: '2026-01-01', updated_at: '2026-01-01' }],
    'rpc/my_groups': [grupo],
    'rpc/quiniela_por_id': grupo,
    '/rest/v1/matches': [partido(matchExtra)],
    '/rest/v1/predictions': [],
    'rpc/cupos_por_jornada': [],
  })
  await page.goto(`/q/${LIGA}?tab=matches`)
}

const contadores = (page) => page.getByRole('button', { name: 'Sumar gol' })

test('un partido EN CURSO sin reabrir no deja tocar el marcador', async ({ page }) => {
  await montar(page, { predictions_force_open: false })
  await expect(page.getByText('AEK Athens', { exact: true })).toBeVisible({ timeout: 10000 })
  await expect(contadores(page)).toHaveCount(0)
})

test('REABIERTO (sigue pendiente con el saque pasado): aparecen los controles y se puede cambiar el marcador', async ({ page }) => {
  /* El caso real de la reapertura: ESPN trajo mal la hora y el partido quedó
     cerrado sin haber empezado. La base lo deja escribir solo mientras siga
     `pending` (rama forzada de la 105). */
  await montar(page, { status: 'pending', home_goals_actual: null, away_goals_actual: null, predictions_force_open: true })
  await expect(page.getByText('AEK Athens', { exact: true })).toBeVisible({ timeout: 10000 })
  // Dos «sumar gol»: local y visita. Con el bug había CERO.
  await expect(contadores(page)).toHaveCount(2)
  await contadores(page).first().click()
})

test('con la casilla marcada pero el partido YA EN VIVO no se ofrece editar: la base lo rechazaría', async ({ page }) => {
  /* Esta prueba afirmaba antes que sí. La rama forzada de la RLS exige
     status = 'pending' (leído en producción el 20 oct 2026): en vivo, los +/−
     y el botón terminaban en 42501. */
  await montar(page, { predictions_force_open: true })
  await expect(page.getByText('AEK Athens', { exact: true })).toBeVisible({ timeout: 10000 })
  await expect(contadores(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: /(Guardar|Actualizar) predicción/ })).toHaveCount(0)
})

test('YA DESTAPADO y con el saque atrasado: cerrado aunque falte para el saque (106)', async ({ page }) => {
  await montar(page, { status: 'pending', kickoff_at: '2027-01-10T16:45:00Z', destapado_at: '2026-09-08T16:30:00Z',
    home_goals_actual: null, away_goals_actual: null, predictions_force_open: false })
  await expect(page.getByText('AEK Athens', { exact: true })).toBeVisible({ timeout: 10000 })
  await expect(page.getByText(/Predicciones cerradas/)).toBeVisible()
  await expect(contadores(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: /(Guardar|Actualizar) predicción/ })).toHaveCount(0)
})
