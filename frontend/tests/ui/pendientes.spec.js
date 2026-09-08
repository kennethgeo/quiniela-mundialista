import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

const groups = ['A', 'B'].map((name, i) => ({
  id: `00000000-0000-4000-8000-00000000000${i + 2}`, name: `Quiniela ${name}`,
  tournament_id: 1, tournament_status: 'active', tournament_kind: 'cup',
  tournament_name: 'Prueba', members: 1, my_points: 0, my_rank: 1,
}))

test.beforeEach(async ({ page }) => {
  await sinRedExterna(page)
  await conSesion(page)
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_seen', 'true')
    localStorage.setItem('pwaPromptDismissed', 'true')
  })
  const matches = Array.from({ length: 7 }, (_, i) => ({
    id: i + 1, tournament_id: 1, home_team: `Local ${i + 1}`, away_team: 'Visita',
    kickoff_at: new Date(Date.now() + (120 + i) * 60000).toISOString(),
    status: 'pending', stage: 'Fase de liga', phase: 'groups',
  }))
  await interceptarSupabase(page, {
    '/rest/v1/users': { id: USUARIO.id, display_name: 'Prueba', avatar_url: null, is_admin: false },
    '/rest/v1/rpc/my_groups': groups,
    '/rest/v1/rpc/mi_resumen_global': { partidos: 0 },
    '/rest/v1/matches': matches,
    '/rest/v1/predictions': [{ league_id: groups[0].id, match_id: 1 }],
  })
})

test('Ver más amplía la lista sin navegar y el filtro cuenta por quiniela', async ({ page }) => {
  await page.goto('/')
  const section = page.getByRole('region', { name: 'Me falta predecir' })
  await expect(section.getByText('13 PENDIENTES')).toBeVisible()
  await section.getByRole('button', { name: 'Ver 8 más' }).click()
  await expect(section.getByRole('button', { name: /Local 7/ })).toHaveCount(2)
  expect(new URL(page.url()).pathname).toBe('/')
  await section.getByLabel('Filtrar por quiniela').selectOption(groups[0].id)
  await expect(section.getByText('6 PENDIENTES')).toBeVisible()
  await expect(section.getByRole('button', { name: /Local 1 / })).toHaveCount(0)
  await section.getByRole('button', { name: 'Ver 1 más' }).click()
  await expect(section.getByRole('button', { name: /Local 7/ })).toHaveCount(1)
})

test('un fallo de carga no se presenta como ausencia de quinielas', async ({ page }) => {
  await page.route('**/rest/v1/rpc/my_groups', (route) => route.fulfill({
    status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'fallo de prueba' }),
  }))
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('No pudimos traer tus quinielas')
  await expect(page.getByText('Todavía no estás en ninguna', { exact: true })).toHaveCount(0)
})

test('el Hub aprovecha el escritorio y mantiene las acciones accesibles', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Me falta predecir' })).toBeVisible()
  const activity = await page.getByRole('complementary', { name: 'Tu actividad', exact: true }).boundingBox()
  const leagues = await page.getByRole('region', { name: 'Tus quinielas', exact: true }).boundingBox()
  expect(leagues.x).toBeGreaterThan(activity.x + activity.width)
  await expect(page.getByRole('button', { name: 'Crear quiniela', exact: true })).toBeVisible()
})

/* En el Hub, LAS QUINIELAS VAN PRIMERO.

   En móvil la grilla se apila en el orden del documento, y con la columna de
   actividad delante había que bajar por el aviso, «Me falta predecir» y el
   ranking antes de ver la propia quiniela — que es a lo que se entra.

   Se afirma sobre la POSICIÓN EN PANTALLA y sobre el orden del DOM, no sobre
   clases: una prueba que mire `order` pasaría igual con el problema puesto,
   porque `order` mueve lo que se ve pero no el orden de lectura. */
test('a 390 px la quiniela se ve antes que «Me falta predecir»', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  const quiniela = page.getByRole('region', { name: 'Tus quinielas' })
  // <aside> tiene rol `complementary`, no `region` — eso es de <section>.
  const actividad = page.getByRole('complementary', { name: 'Tu actividad' })
  await expect(quiniela).toBeVisible({ timeout: 10000 })

  const cajaQ = await quiniela.boundingBox()
  const cajaA = await actividad.boundingBox()
  expect(cajaQ.y).toBeLessThan(cajaA.y)

  // Y en el DOM también: es lo que recorren el teclado y un lector de pantalla.
  const quinielaPrimero = await page.evaluate(() => {
    const q = document.querySelector('[aria-label="Tus quinielas"]')
    const a = document.querySelector('[aria-label="Tu actividad"]')
    return !!(q && a && (q.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING))
  })
  expect(quinielaPrimero).toBe(true)
})
