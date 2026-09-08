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

test('REABIERTO: aparecen los controles y se puede cambiar el marcador', async ({ page }) => {
  await montar(page, { predictions_force_open: true })
  await expect(page.getByText('AEK Athens', { exact: true })).toBeVisible({ timeout: 10000 })
  // Dos «sumar gol»: local y visita. Con el bug había CERO.
  await expect(contadores(page)).toHaveCount(2)
  await contadores(page).first().click()
})
