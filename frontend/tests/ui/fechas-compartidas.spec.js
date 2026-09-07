import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

test.use({ timezoneId: 'UTC' })

async function abrirDetalle(page, kickoff_at) {
  const errores = []
  const sensibles = []
  page.on('pageerror', error => errores.push(error.message))
  // React puede capturar el error sin emitir pageerror.
  page.on('console', msg => {
    if (msg.text().includes('ErrorBoundary atrapó un error')) errores.push(msg.text())
  })
  page.on('request', request => {
    if (request.url().includes('/rest/v1/predictions') || request.url().includes('/refresh-live')) sensibles.push(request.url())
  })
  await page.clock.install({ time: new Date('2026-09-06T19:30:00Z') })
  await conSesion(page)
  await sinRedExterna(page)
  await interceptarSupabase(page, {
    '/rest/v1/users': [{ id: USUARIO.id, display_name: 'Prueba', avatar_url: null, total_points: 0 }],
    '/rest/v1/matches': { id: 9001, tournament_id: 6, phase: 'groups', status: 'pending',
      kickoff_at, home_team: 'Local', away_team: 'Visita', events_json: [] },
  })
  await page.goto('/match/9001')
  await expect(page.getByRole('heading', { name: 'Detalles del Partido' })).toBeVisible()
  return { errores, sensibles }
}

test('detalle sin fecha muestra Por confirmar sin caída, destape ni refresco en vivo', async ({ page }) => {
  const { errores, sensibles } = await abrirDetalle(page, null)
  await expect(page.getByText('Por confirmar', { exact: true })).toBeVisible()
  await expect(page.getByText('Modo Incógnito', { exact: true })).toBeVisible()
  await page.clock.fastForward(31_000)
  expect(errores).toEqual([])
  expect(sensibles).toEqual([])
})

test('detalle respeta -06:00 y mantiene ocultas las predicciones antes del cierre', async ({ page }) => {
  const { errores, sensibles } = await abrirDetalle(page, '2026-09-06T14:00:00-06:00')
  // Zona del navegador fijada a UTC: 14:00 de Costa Rica son 20:00 UTC.
  await expect(page.getByText('20:00', { exact: true })).toBeVisible()
  await expect(page.getByText('Modo Incógnito', { exact: true })).toBeVisible()
  expect(errores).toEqual([])
  expect(sensibles).toEqual([])
})
