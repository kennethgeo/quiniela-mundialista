/* Comprobaciones que la suite entregada NO cubre: ancho de 390 px, enlace a la
   jornada, foco de teclado realmente visible y retiro por reloj.

   Cada una se comprobó rompiendo a propósito el comportamiento que vigila. */
import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

const LIGA = '00000000-0000-4000-8000-000000000002'
const grupos = [{ id: LIGA, name: 'Quiniela A', tournament_id: 1, tournament_status: 'active',
  tournament_kind: 'cup', tournament_name: 'Prueba', members: 1, my_points: 0, my_rank: 1 }]

async function montar (page, segundos) {
  await sinRedExterna(page)
  await conSesion(page)
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_seen', 'true'); localStorage.setItem('pwaPromptDismissed', 'true')
  })
  const matches = segundos.map((s, i) => ({
    id: i + 1, tournament_id: 1, home_team: `Local ${i + 1}`, away_team: 'Visita',
    kickoff_at: new Date(Date.now() + s * 1000).toISOString(),
    status: 'pending', stage: 'Fase de liga', phase: 'groups',
  }))
  await interceptarSupabase(page, {
    '/rest/v1/users': { id: USUARIO.id, display_name: 'Prueba', avatar_url: null, is_admin: false },
    '/rest/v1/rpc/my_groups': grupos,
    '/rest/v1/rpc/mi_resumen_global': { partidos: 0 },
    '/rest/v1/matches': matches,
    '/rest/v1/predictions': [],
  })
}

const fila = (page) => page.getByRole('region', { name: 'Me falta predecir' }).getByRole('button', { name: /Local 1/ })

test('a 390 px nada se desborda y el pendiente lleva a su jornada', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await montar(page, [7200])
  await page.goto('/')
  await expect(fila(page)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await fila(page).click()
  await expect(page).toHaveURL(new RegExp(`/q/${LIGA}\\?tab=matches&j=Fase\\+de\\+liga`))
})

test('el foco de teclado se VE sobre la tarjeta, no solo existe', async ({ page }) => {
  await montar(page, [7200])
  await page.goto('/')
  await expect(fila(page)).toBeVisible()
  await fila(page).focus()
  await expect(fila(page)).toBeFocused()
  const m = await fila(page).evaluate((el) => {
    const s = getComputedStyle(el)
    const card = el.closest('div[class*="rounded-2xl"]') || document.body
    return { ancho: parseFloat(s.outlineWidth), estilo: s.outlineStyle,
             contorno: s.outlineColor, fondo: getComputedStyle(card).backgroundColor }
  })
  const rgb = (c) => c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number)
  const lum = ([r, g, b]) => [r, g, b].map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 })
    .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0)
  const a = lum(rgb(m.contorno)), b = lum(rgb(m.fondo))
  const contraste = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  expect(m.estilo).not.toBe('none')
  expect(m.ancho).toBeGreaterThanOrEqual(2)
  // WCAG 2.2 §1.4.11: un indicador de foco necesita 3:1 contra lo que lo rodea.
  expect(contraste).toBeGreaterThanOrEqual(3)
})

test('un partido que cruza el cierre desaparece por reloj, sin volver a consultar', async ({ page }) => {
  // 15 min 10 s: al adelantar 20 s cruza el corte de 15 min. El intervalo del
  // componente es de 15 s y el de react-query de 30 s, así que en esa ventana
  // solo puede haberlo quitado el filtro de render, no una nueva consulta.
  await montar(page, [910, 7200])
  await page.clock.install()
  await page.goto('/')
  await expect(fila(page)).toBeVisible()
  await page.clock.fastForward(20_000)
  await expect(fila(page)).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Me falta predecir' })
    .getByRole('button', { name: /Local 2/ })).toBeVisible()
})
