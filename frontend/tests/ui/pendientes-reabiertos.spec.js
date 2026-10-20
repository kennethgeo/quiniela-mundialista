/* «Me falta predecir» y los estados que la RLS de verdad deja escribir.

   La consulta del Hub filtraba `kickoff_at > ahora+15` EN LA BASE, así que un
   partido REABIERTO por el admin (pendiente, saque cercano o pasado) no llegaba
   nunca a la lista aunque la RLS lo dejara predecir. Y no traía `destapado_at`:
   un partido destapado con el saque atrasado salía como pendiente y la base
   rechazaba el guardado. El doble aplica los filtros `gt` y `or` como
   PostgREST; si devolviera todo, la prueba pasaría con la consulta vieja. */
import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

const GRUPO = { id: '00000000-0000-4000-8000-0000000000e2', name: 'Quiniela E', tournament_id: 1,
  tournament_status: 'active', tournament_kind: 'cup', tournament_name: 'Prueba', members: 1, my_points: 0, my_rank: 1 }
const ahora = Date.now()
const PARTIDOS = [
  // Normal, abierto.
  { id: 1, home_team: 'Abierto FC', saque: ahora + 3 * 3600000 },
  // Reabierto: pendiente, el saque ya pasó, el admin lo forzó.
  { id: 2, home_team: 'Reabierto FC', saque: ahora - 10 * 60000, predictions_force_open: true },
  // Destapado y con el saque atrasado: la base ya no deja escribir.
  { id: 3, home_team: 'Destapado FC', saque: ahora + 5 * 3600000, destapado_at: new Date(ahora - 3600000).toISOString() },
].map((m) => ({ tournament_id: 1, away_team: 'Visita', status: 'pending', stage: 'Fase', phase: 'groups',
  predictions_force_open: false, destapado_at: null, ...m, kickoff_at: new Date(m.saque).toISOString() }))

function filtrar (url) {
  const p = new URL(url).searchParams
  let filas = PARTIDOS
  const gt = p.get('kickoff_at')?.match(/^gt\.(.*)$/)?.[1]
  if (gt) filas = filas.filter((m) => m.kickoff_at > gt)
  const or = p.get('or')?.match(/^\(kickoff_at\.gt\.(.*),predictions_force_open\.is\.true\)$/)
  if (or) filas = filas.filter((m) => m.kickoff_at > or[1] || m.predictions_force_open === true)
  if (p.get('or') && !or) throw new Error(`filtro or inesperado: ${p.get('or')}`)
  const cols = p.get('select')?.split(',')
  return filas.map(({ saque, ...m }) => cols ? Object.fromEntries(cols.map((c) => [c, m[c]])) : m)
}

test('un reabierto aparece en «Me falta predecir» y un destapado no', async ({ page }) => {
  await sinRedExterna(page)
  await conSesion(page)
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_seen', 'true'); localStorage.setItem('pwaPromptDismissed', 'true')
  })
  await interceptarSupabase(page, {
    '/rest/v1/users': { id: USUARIO.id, display_name: 'Prueba', avatar_url: null, is_admin: false },
    '/rest/v1/rpc/my_groups': [GRUPO],
    '/rest/v1/rpc/mi_resumen_global': { partidos: 0 },
    '/rest/v1/matches': (url) => filtrar(url),
    '/rest/v1/predictions': [],
  })
  await page.goto('/')
  const seccion = page.getByRole('region', { name: 'Me falta predecir' })
  await expect(seccion.getByRole('button', { name: /Abierto FC/ })).toBeVisible()
  await expect(seccion.getByRole('button', { name: /Reabierto FC/ })).toBeVisible()
  await expect(seccion.getByText(/reabierto por el admin/)).toBeVisible()
  // Ausencia afirmada DESPUÉS de que lo demás está pintado.
  await expect(seccion.getByRole('button', { name: /Destapado FC/ })).toHaveCount(0)
})
