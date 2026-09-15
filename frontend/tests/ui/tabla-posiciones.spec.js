/* La tabla de Posiciones, sobre la pantalla de verdad.

   NINGUNA PRUEBA DE VITEST PODÍA VER EL FALLO QUE ESTO ARREGLA. Las columnas
   de ganados, empatados y perdidos existían en el código desde siempre, pero
   marcadas `hidden xs:table-cell` — y `xs` NO es un breakpoint de este
   proyecto (Tailwind v4 trae sm/md/lg/xl/2xl y el `@theme` de index.css no
   define ninguno más). La clase no se generaba, ganaba el `hidden`, y las tres
   columnas estaban ocultas en TODOS los tamaños, escritorio incluido.
   Comprobado contra el CSS compilado: `xs\:table-cell` sale 0 veces, `sm\:` sí.

   Por eso se afirma sobre lo que se VE en la tabla, nunca sobre las clases. */
import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

const LIGA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const equipo = (team, rank, extra = {}) => ({
  team, rank, logo: null, played: 8, wins: 5, draws: 3, losses: 0,
  gf: 20, ga: 11, gd: 9, points: 18, form: ['G', 'G', 'E', 'P', 'G'], ...extra,
})

/* La jornada 8 real de Bundestica, que es la de la captura del dueño: los dos
   primeros EMPATADOS a 18 y separados solo por la diferencia de gol, y dos
   equipos con un partido menos por el San Carlos–Escorpiones cancelado. */
const TABLA = {
  tournament_id: 2,
  groups: [{
    name: null,
    rows: [
      equipo('Cartaginés', 1, { gd: 9, points: 18 }),
      equipo('Saprissa', 2, { gd: 8, points: 18 }),
      equipo('Sporting San José', 3, { gd: 7, points: 14, wins: 4, draws: 2, losses: 2 }),
      equipo('Inter de San Carlos', 4, { gd: 2, points: 14, wins: 4, draws: 2, losses: 2 }),
      equipo('AD San Carlos', 5, { gd: 1, points: 12, played: 7, wins: 3, draws: 3, losses: 1 }),
      equipo('Alajuelense', 6, { gd: 0, points: 11, wins: 3, draws: 2, losses: 3 }),
      equipo('Escorpiones Belén', 7, { gd: -11, points: 1, played: 7, wins: 0, draws: 1, losses: 6, form: ['P', 'P', 'P', 'E', 'P'] }),
    ],
  }],
}

const GRUPO = {
  id: LIGA, name: 'Bundestica', tournament_id: 2, invitation_code: 'ABC123',
  powerup_limit: 2, points_exact: 3, points_correct: 1,
  champion_points: 12, scorer_points: 12, assist_points: 12,
  is_admin: false, rules_accepted: true, rules: null, members_count: 17,
  tournament_kind: 'league', tournament_status: 'active', tournament_ref: 'crc.1',
}

async function abrir (page, { tabla = TABLA, grupo = GRUPO } = {}) {
  await sinRedExterna(page)
  await conSesion(page)
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_seen', 'true'); localStorage.setItem('pwaPromptDismissed', 'true')
  })
  /* Después de sinRedExterna: en Playwright gana la ÚLTIMA ruta registrada. */
  await page.route('**/_backend/api/matches/tournament-standings*', (r) => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(tabla),
  }))
  await interceptarSupabase(page, {
    '/rest/v1/users': {
      id: USUARIO.id, display_name: 'Prueba', avatar_url: null, total_points: 0,
      points_adjustment: 0, is_admin: false, created_at: '2026-01-01', updated_at: '2026-01-01',
    },
    'rpc/my_groups': [grupo],
    'rpc/quiniela_por_id': grupo,
    '/rest/v1/matches': [],
    '/rest/v1/predictions': [],
  })
  await page.goto(`/q/${LIGA}?tab=teams`)
  await expect(page.getByRole('row', { name: /Cartaginés/ })).toBeVisible({ timeout: 15000 })
}

const fila = (page, nombre) => page.getByRole('row', { name: new RegExp(nombre) })

/* EL FALLO ORIGINAL: estas tres columnas nunca se veían, en ningún tamaño. */
test('se ven los ganados, empatados y perdidos', async ({ page }) => {
  await abrir(page)
  await expect(page.getByRole('columnheader', { name: 'G-E-P' })).toBeVisible()
  await expect(fila(page, 'Cartaginés').getByText('5-3-0')).toBeVisible()
  await expect(fila(page, 'Escorpiones Belén').getByText('0-1-6')).toBeVisible()
})

/* El backend ya mandaba goles a favor y en contra; la tabla no los dibujaba. */
test('los goles a favor y en contra se ven con pantalla ancha', async ({ page }) => {
  /* El único proyecto de Playwright es un celular, así que la ventana se
     ensancha A MANO. Con un `if (isMobile) return` esta prueba no correría
     nunca y pasaría siempre: una prueba que no puede fallar es peor que
     ninguna. */
  await abrir(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(page.getByRole('columnheader', { name: 'GF:GC' })).toBeVisible()
  await expect(fila(page, 'Cartaginés').getByText('20:11')).toBeVisible()
})

test('en un celular GF:GC cede el ancho, a propósito', async ({ page }) => {
  await abrir(page)
  await expect(page.getByRole('columnheader', { name: 'GF:GC' })).toBeHidden()
})

/* Es lo que de verdad se le pregunta a esta tabla: quién clasifica. La tica
   juega dos semifinales, o sea que pasan cuatro. */
test('marca la zona de liguilla y la explica', async ({ page }) => {
  await abrir(page)
  await expect(page.getByText('Liguilla')).toBeVisible()
})

/* Un corte inventado es peor que ninguno: alguien leería que su equipo
   clasifica cuando en esa liga no hay liguilla. */
test('una liga sin corte conocido no dibuja ninguna zona', async ({ page }) => {
  await abrir(page, { grupo: { ...GRUPO, tournament_ref: 'esp.1', name: 'LaLiga' } })
  await expect(page.getByText('Liguilla')).toHaveCount(0)
  await expect(page.getByText('Repechaje')).toHaveCount(0)
})

/* Cartaginés y Saprissa están los dos con 18 y el orden lo decide el +9 contra
   el +8. Sin decirlo, la tabla parece arbitraria. */
test('explica el desempate cuando hay empate en puntos', async ({ page }) => {
  await abrir(page)
  await expect(page.getByText(/manda la diferencia de gol/i)).toBeVisible()
  await expect(fila(page, 'Cartaginés').getByTitle(/diferencia de gol decide/i)).toBeVisible()
  // Sporting e Inter también empatan (14), pero Alajuelense no: no se resalta.
  await expect(fila(page, 'Alajuelense').getByTitle(/diferencia de gol decide/i)).toHaveCount(0)
})

/* AD San Carlos y Escorpiones llevan 7 PJ por el partido cancelado, y sin
   explicarlo la tabla parece mal calculada. */
test('dice por qué hay equipos con menos partidos jugados', async ({ page }) => {
  await abrir(page)
  await expect(page.getByText(/menos PJ tienen partidos pendientes o cancelados/i)).toBeVisible()
})

test('sin equipos desparejos no sale esa nota', async ({ page }) => {
  const parejo = { ...TABLA, groups: [{ name: null, rows: TABLA.groups[0].rows.map((r) => ({ ...r, played: 8 })) }] }
  await abrir(page, { tabla: parejo })
  await expect(page.getByText(/menos PJ tienen partidos pendientes/i)).toHaveCount(0)
})

test('la racha se lee del más viejo al más nuevo, también en celular', async ({ page }) => {
  await abrir(page)
  const racha = fila(page, 'Cartaginés').getByLabel(/Últimos 5/)
  await expect(racha).toBeVisible()
  await expect(racha).toHaveAttribute('aria-label', 'Últimos 5: G G E P G')
})

test('un equipo sin racha no inventa resultados', async ({ page }) => {
  const sinRacha = {
    ...TABLA,
    groups: [{ name: null, rows: TABLA.groups[0].rows.map((r) => ({ ...r, form: [] })) }],
  }
  await abrir(page, { tabla: sinRacha })
  await expect(fila(page, 'Cartaginés').getByLabel(/Últimos/)).toHaveCount(0)
})

/* Lo que la gente mira primero. Si los puntos quedan fuera de la pantalla en
   un celular, todo lo demás da igual. */
test('en un celular los puntos entran sin desplazar la tabla', async ({ page }) => {
  await abrir(page)
  const caja = await fila(page, 'Cartaginés').getByText('18', { exact: true }).boundingBox()
  const ancho = page.viewportSize().width
  expect(caja.x + caja.width).toBeLessThanOrEqual(ancho)
})
