/* Predicciones globales: el cierre es el de la BASE y una lectura fallida no
   pisa lo guardado.

   La tarjeta y la lista de la quiniela miraban `tournaments.predictions_locked`.
   La base decide con `tournament_predictions_open(p_tid)`: sin candado y, o
   forzado, o antes del primer saque. Medido el 19 oct 2026: LaLiga y Premier
   tienen `predictions_locked = false` y ya arrancaron — la base las da por
   CERRADAS, la tarjeta ofrecía el formulario (que la RLS rechaza) y la lista
   escondía las predicciones ajenas que la base ya destapó.

   Y si fallaba la lectura de lo guardado, el formulario salía vacío y
   «Guardar» mandaba campeón, goleador y asistidor en null. */
import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

const LIGA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaadd'
const OTRA = '00000000-0000-4000-8000-0000000000d4'
const GUARDADA = { user_id: USUARIO.id, league_id: LIGA, tournament_id: 4,
  champion_team: 'Real Madrid', top_scorer_name: 'Kylian Mbappé', top_assist_name: 'Jude Bellingham' }
const AJENA = { id: 'g2', user_id: OTRA, league_id: LIGA, tournament_id: 4,
  champion_team: 'Barcelona', top_scorer_name: 'Robert Lewandowski', top_assist_name: 'Pedri' }

async function abrir (page, { abiertas, lecturaPropia = 'ok', candadoColumna = false } = {}) {
  const escrituras = []
  await sinRedExterna(page)
  await conSesion(page)
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_seen', 'true'); localStorage.setItem('pwaPromptDismissed', 'true')
  })
  const grupo = { id: LIGA, name: 'Liga española', tournament_id: 4, rules_accepted: true, is_admin: false,
    powerup_limit: 2, members: 2, my_rank: 1, tournament_kind: 'league', tournament_status: 'active',
    champion_points: 12, scorer_points: 12, assist_points: 12 }
  await interceptarSupabase(page, {
    // El perfil (AuthContext) se pide por id con .single(): OBJETO. La lista de
    // nombres de AllGlobalPicks, sin filtro: LISTA.
    '/rest/v1/users': (url) => url.includes('id=eq.')
      ? { id: USUARIO.id, display_name: 'Prueba', total_points: 0, is_admin: false }
      : [{ id: USUARIO.id, display_name: 'Prueba' }, { id: OTRA, display_name: 'Otra' }],
    'rpc/my_groups': [grupo],
    // La columna sola NO decide: puede decir «abierto» con el torneo empezado.
    '/rest/v1/tournaments': { predictions_locked: candadoColumna },
  })
  await page.route('**://pruebas.supabase.co/rest/v1/rpc/tournament_predictions_open*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(abiertas) }))
  await page.route('**://pruebas.supabase.co/rest/v1/tournament_predictions*', (route) => {
    const req = route.request()
    if (req.method() !== 'GET') {
      escrituras.push(req.postDataJSON())
      return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' })
    }
    const url = req.url()
    if (url.includes(`user_id=eq.${USUARIO.id}`)) {
      if (lecturaPropia === 'falla') return route.fulfill({ status: 400, contentType: 'application/json', body: '{"message":"caída"}' })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(GUARDADA) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'g1', ...GUARDADA }, AJENA]) })
  })
  await page.goto(`/q/${LIGA}?tab=global`)
  return { escrituras }
}

test('con el torneo ya empezado (la base dice cerrado) no se ofrece guardar, aunque la columna diga abierto', async ({ page }) => {
  await abrir(page, { abiertas: false, candadoColumna: false })
  await expect(page.getByRole('heading', { name: 'Predicciones globales' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Guardar predicción/ })).toHaveCount(0)
  // Y las de los demás se ven: la base ya las destapó.
  await expect(page.getByText('Robert Lewandowski')).toBeVisible()
})

test('si no se puede leer lo guardado, no hay formulario ni guardado que lo pise', async ({ page }) => {
  const { escrituras } = await abrir(page, { abiertas: true, lecturaPropia: 'falla' })
  await expect(page.getByRole('alert').filter({ hasText: 'No pudimos leer tus predicciones globales' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Guardar predicción/ })).toHaveCount(0)
  await page.waitForTimeout(300)
  expect(escrituras).toEqual([])
})

test('abiertas de verdad: se ve lo guardado y se guarda con los tres campos', async ({ page }) => {
  const { escrituras } = await abrir(page, { abiertas: true, candadoColumna: false })
  await expect(page.getByRole('button', { name: /Guardar predicción/ })).toBeVisible()
  // Real Madrid NO está en los equipos de ESPN de esta prueba: igual se ve,
  // porque el campeón guardado entra como opción de respaldo.
  await expect(page.locator('select')).toHaveValue('Real Madrid')
  await expect(page.locator('input').first()).toHaveValue('Kylian Mbappé')
  await page.getByRole('button', { name: /Guardar predicción/ }).click()
  await expect.poll(() => escrituras.length).toBe(1)
  expect(escrituras[0]).toMatchObject({ champion_team: 'Real Madrid', top_scorer_name: 'Kylian Mbappé',
    top_assist_name: 'Jude Bellingham', league_id: LIGA })
  // Mientras siguen abiertas, la lista de los demás no se muestra.
  await expect(page.getByText('Robert Lewandowski')).toHaveCount(0)
})
