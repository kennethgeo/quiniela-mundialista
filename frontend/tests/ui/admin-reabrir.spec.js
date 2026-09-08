/* La casilla de «reabrir predicciones» en el panel de admin.

   POR QUÉ EXISTE ESTA PRUEBA: la casilla se publicó DUPLICADA —dos copias, y
   la primera sin el candado por estado, así que aparecía en partidos ya
   finalizados donde la política RLS la ignora—. Ninguna prueba lo veía: las de
   vitest miran lógica pura y ninguna abre el panel. Lo encontró el dueño. */
import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

const base = {
  tournament_id: 6, phase: 'groups', group_name: null, stage: 'Jornada 1',
  home_team_code: 'xx', away_team_code: 'xx', matchday: 1, events_json: [],
  score_locked: false, predictions_force_open: false,
}
const partidos = [
  { ...base, id: 1, home_team: 'AEK Athens', away_team: 'LASK Linz',
    status: 'in_progress', kickoff_at: '2026-09-08T16:45:00Z',
    home_goals_actual: null, away_goals_actual: null },
  { ...base, id: 2, home_team: 'Real Madrid', away_team: 'Inter',
    status: 'finished', kickoff_at: '2026-09-07T16:45:00Z',
    home_goals_actual: 2, away_goals_actual: 1 },
]

async function abrirResultados (page) {
  await sinRedExterna(page)
  await conSesion(page)
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_seen', 'true'); localStorage.setItem('pwaPromptDismissed', 'true')
  })
  await interceptarSupabase(page, {
    '/rest/v1/users': { id: USUARIO.id, display_name: 'Admin', avatar_url: null, is_admin: true },
    '/rest/v1/tournaments': [{ id: 6, name: 'UEFA Champions League' }],
    '/rest/v1/matches': partidos,
    '/rest/v1/rpc/my_groups': [],
  })
  await page.goto('/admin')
  await page.getByRole('button', { name: 'Resultados' }).click()
  await expect(page.getByText('AEK Athens')).toBeVisible({ timeout: 10000 })
}

/** Entra en modo edición del partido y devuelve su tarjeta. */
async function editar (page, equipo) {
  const tarjeta = page.locator('.glass-card').filter({ hasText: equipo }).last()
  await tarjeta.locator('button').first().click()
  await expect(tarjeta.getByText('Fecha y hora', { exact: false })).toBeVisible()
  return tarjeta
}

const CASILLA = /Reabrir predicciones de este partido/

test('en un partido EN CURSO la casilla está, y una sola vez', async ({ page }) => {
  await abrirResultados(page)
  const tarjeta = await editar(page, 'AEK Athens')
  // `toHaveCount(1)` es el punto: con la copia duplicada daba 2.
  await expect(tarjeta.getByText(CASILLA)).toHaveCount(1)
})

test('en un partido FINALIZADO la casilla NO se ofrece', async ({ page }) => {
  /* La política RLS la ignora en un partido terminado, así que mostrarla sería
     un interruptor que guarda y no hace nada. */
  await abrirResultados(page)
  const tarjeta = await editar(page, 'Real Madrid')
  await expect(tarjeta.getByText(CASILLA)).toHaveCount(0)
  // La otra casilla del formulario sí sigue estando: no se rompió el resto.
  await expect(tarjeta.getByText(/Fijar este resultado/)).toHaveCount(1)
})
