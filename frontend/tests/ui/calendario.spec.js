import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

const LIGA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const grupo = { id: LIGA, name: 'Calendario de prueba', tournament_id: 6,
  invitation_code: 'NOEXPORTAR', rules_accepted: true, is_admin: false,
  powerup_limit: 2, members_count: 1, tournament_kind: 'league', tournament_status: 'active' }
const partido = (id, matchday, extra = {}) => ({ id, tournament_id: 6, matchday,
  stage: `Jornada ${matchday}`, phase: 'groups', home_team: `Local ${id}`, away_team: `Visita ${id}`,
  status: 'pending', kickoff_at: '2026-09-09T20:00:00Z', events_json: [], ...extra })

async function preparar(page, partidos) {
  // Congelar el reloj evita que las fechas de prueba venzan meses después.
  await page.clock.install({ time: new Date('2026-09-06T12:00:00Z') })
  await conSesion(page)
  await sinRedExterna(page)
  await interceptarSupabase(page, {
    '/rest/v1/users': [{ id: USUARIO.id, display_name: 'Prueba', avatar_url: null, total_points: 0 }],
    'rpc/my_groups': [grupo],
    '/rest/v1/matches': partidos,
    '/rest/v1/predictions': [],
    'rpc/cupos_por_jornada': [],
  })
  await page.goto(`/q/${LIGA}?tab=matches&j=Jornada+2`)
  const resumen = page.locator('summary').filter({ hasText: 'Llevar partidos a mi calendario' })
  await expect(resumen).toBeVisible()
  await resumen.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Partidos a incluir')).toBeVisible()
}

async function descargar(page, nombre) {
  const descarga = page.waitForEvent('download')
  await page.getByRole('button', { name: nombre, exact: true }).click()
  const archivo = await descarga
  expect(archivo.suggestedFilename()).toBe(`tico-games-${LIGA}.ics`)
  return (await readFile(await archivo.path(), 'utf8')).replace(/\r\n[ \t]/g, '')
}

test('descarga la jornada elegida y permite ampliar a toda la quiniela sin escribir', async ({ page }) => {
  const escrituras = []
  page.on('request', r => {
    // Los RPC de lectura se sirven con POST. Registrar solo escrituras sobre tablas.
    if (r.url().includes('/rest/v1/') && !r.url().includes('/rpc/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method())) escrituras.push(r.url())
  })
  await preparar(page, [partido(1, 1), partido(2, 2), partido(3, 2, { status: 'cancelled' })])
  const jornada = await descargar(page, 'Descargar 1 partido (.ics)')
  expect(jornada).toContain('SUMMARY:Local 2 vs Visita 2')
  expect(jornada).not.toContain('SUMMARY:Local 1')
  expect(jornada).not.toContain('SUMMARY:Local 3')
  expect(jornada).toContain(`URL:http://localhost:5199/q/${LIGA}?tab=matches&j=Jornada+2`)
  await page.getByLabel('Partidos a incluir').selectOption('todas')
  const todas = await descargar(page, 'Descargar 2 partidos (.ics)')
  expect(todas.match(/BEGIN:VEVENT/g)).toHaveLength(2)
  expect(todas).toContain('SUMMARY:Local 1 vs Visita 1')
  expect(todas).not.toContain('NOEXPORTAR')
  expect(escrituras).toEqual([])
})

test('deshabilita una selección sin próximos partidos con fecha confirmada', async ({ page }) => {
  await preparar(page, [partido(2, 2, { status: 'finished' }), partido(3, 2, { kickoff_at: null })])
  await expect(page.getByRole('button', { name: 'Sin partidos próximos' })).toBeDisabled()
  await expect(page.getByText(/los cambios de horario no se actualizan automáticamente/)).toBeVisible()
})
