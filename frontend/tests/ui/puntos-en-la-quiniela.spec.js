/* Detalle del partido: el número bajo cada nombre es el de LA QUINIELA.

   La pantalla mostraba `users.total_points`, el total GLOBAL, que junta todas
   las quinielas de la persona. En una quiniela por plata eso no es un detalle:
   medido en producción el 9 sep 2026, Ruddy aparecía con 15 al lado de gente
   con 47 y 55 cuando en ESA quiniela iba 16 contra 19 y 18 — tercero de siete.

   Los números del fixture están elegidos para que un global no pueda pasar por
   uno de quiniela ni al revés: son distintos y el orden entre personas se
   INVIERTE. Con dos escalas parecidas, la prueba pasaría con el bug puesto. */
import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

const LIGA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PARTIDO = '00000001-0000-4000-8000-000000000000'
const OTRO = '00000000-0000-4000-8000-000000000009'

const MATCH = {
  id: PARTIDO, tournament_id: 6, phase: 'groups', matchday: 1, stage: 'Jornada 1',
  home_team: 'Napoli', away_team: 'Arsenal', home_team_code: 'nap', away_team_code: 'ars',
  status: 'finished', kickoff_at: '2026-09-09T19:00:00Z',
  home_goals_actual: 0, away_goals_actual: 1, events_json: [], venue: null,
}

/* Global alto, quiniela bajo — y al revés para el otro. Si la pantalla lee el
   campo equivocado, los dos números se notan. */
const PREDICCIONES = [
  {
    id: 'p1', match_id: PARTIDO, league_id: LIGA, user_id: USUARIO.id,
    home_goals_pred: 1, away_goals_pred: 2, use_powerup_x2: false, points_earned: 1,
    users: { display_name: 'KGC', avatar_url: null, total_points: 56 },
  },
  {
    id: 'p2', match_id: PARTIDO, league_id: LIGA, user_id: OTRO,
    home_goals_pred: 1, away_goals_pred: 2, use_powerup_x2: false, points_earned: 1,
    users: { display_name: 'Ruddy', avatar_url: null, total_points: 16 },
  },
]

// En la quiniela el orden es el CONTRARIO al global: Ruddy 40, KGC 18.
const TABLA = [
  { user_id: USUARIO.id, display_name: 'KGC', avatar_url: null, points: 18, is_me: true, pos: 2 },
  { user_id: OTRO, display_name: 'Ruddy', avatar_url: null, points: 40, is_me: false, pos: 1 },
]

test.beforeEach(async ({ page }) => {
  await sinRedExterna(page)
  await conSesion(page)
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_seen', 'true')
    localStorage.setItem('pwaPromptDismissed', 'true')
  })
  await interceptarSupabase(page, {
    '/rest/v1/users': {
      id: USUARIO.id, display_name: 'KGC', avatar_url: null,
      total_points: 56, points_adjustment: 0, is_admin: false,
      created_at: '2026-01-01', updated_at: '2026-01-01',
    },
    /* OBJETO, no lista: el partido se pide con `.single()`. Con una lista la
       pantalla se queda en «Partido no encontrado» y no se renderiza ninguna
       fila — el mismo tropiezo que con `/rest/v1/users`. */
    '/rest/v1/matches': MATCH,
    '/rest/v1/predictions': PREDICCIONES,
    'rpc/group_standings': TABLA,
    'rpc/my_groups': [],
  })
})

const fila = (page, nombre) =>
  page.locator('.glass-card').filter({ hasText: nombre }).first()

test('bajo cada nombre va el puntaje de la quiniela, no el global', async ({ page }) => {
  await page.goto(`/match/${PARTIDO}`)

  await expect(fila(page, 'Ruddy')).toContainText('En la quiniela: 40', { timeout: 15000 })
  await expect(fila(page, 'KGC')).toContainText('En la quiniela: 18')
})

test('el total global no se cuela en esa línea', async ({ page }) => {
  await page.goto(`/match/${PARTIDO}`)
  await expect(fila(page, 'Ruddy')).toContainText('En la quiniela', { timeout: 15000 })

  // 16 y 56 son los globales: no pueden aparecer bajo ningún nombre.
  await expect(fila(page, 'Ruddy')).not.toContainText('16')
  await expect(fila(page, 'KGC')).not.toContainText('56')
  await expect(page.getByText('Puntos totales:')).toHaveCount(0)
})

/* Si la RPC de la tabla falla, la pantalla NO puede enseñar el número global
   como si fuera el de la quiniela: eso es peor que no enseñarlo, porque parece
   correcto. Cae al global CON SU ETIQUETA. */
test('si no se pueden traer los puntos de la quiniela, se dice cuál número es', async ({ page }) => {
  await page.route('**/rest/v1/rpc/group_standings*', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }))

  await page.goto(`/match/${PARTIDO}`)
  await expect(fila(page, 'Ruddy')).toContainText('Total global: 16', { timeout: 15000 })
  await expect(fila(page, 'Ruddy')).not.toContainText('En la quiniela')
})
