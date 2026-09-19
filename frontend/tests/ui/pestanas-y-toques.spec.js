/* Lo que solo se ve abriendo la pantalla: la pestaña activa fuera de cuadro y
   los botones demasiado chicos para un dedo.

   NINGUNA PRUEBA DE LÓGICA PODÍA VER ESTO. Se midió con el navegador: al abrir
   `?tab=admin` en 412 px la pestaña activa caía en x=719 con la fila sin
   desplazar, o sea completamente fuera de pantalla, y «Ver todos» medía 74×17
   cuando WCAG 2.2 §2.5.8 pide 24×24. */
import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

const LIGA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const uuid = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`

const PARTIDOS = [{
  id: uuid(1), tournament_id: 2, phase: 'groups', matchday: 9, stage: 'Jornada 9',
  home_team: 'Saprissa', away_team: 'Herediano', home_team_code: 'xx', away_team_code: 'xx',
  status: 'pending', kickoff_at: '2026-09-25T19:00:00Z', group_name: null,
  home_goals_actual: null, away_goals_actual: null, events_json: [],
}]

const GRUPO = {
  id: LIGA, name: 'Bundestica', tournament_id: 2, invitation_code: '6BE60F',
  powerup_limit: 2, points_exact: 3, points_correct: 1, champion_points: 12,
  scorer_points: 12, assist_points: 12, is_admin: true, rules_accepted: true,
  rules: 'Reglas', members_count: 17, tournament_kind: 'league',
  tournament_status: 'active', tournament_ref: 'crc.1',
}

/* Reloj clavado antes del saque del partido de prueba: si no, el estado de la
   tarjeta cambiaría según a qué hora corra CI. */
const AHORA = new Date('2026-09-25T15:00:00Z')

async function abrir (page, tab) {
  await sinRedExterna(page)
  await conSesion(page)
  await page.clock.setFixedTime(AHORA)
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_seen', 'true'); localStorage.setItem('pwaPromptDismissed', 'true')
  })
  await page.route('**/_backend/api/**', (r) => r.fulfill({
    status: 200, contentType: 'application/json', body: '{"groups":[]}',
  }))
  await interceptarSupabase(page, {
    '/rest/v1/users': {
      id: USUARIO.id, display_name: 'Prueba', avatar_url: null, total_points: 0,
      points_adjustment: 0, is_admin: false, created_at: '2026-01-01', updated_at: '2026-01-01',
    },
    'rpc/my_groups': [GRUPO], 'rpc/quiniela_por_id': GRUPO,
    '/rest/v1/matches': PARTIDOS, '/rest/v1/predictions': [],
  })
  await page.goto(`/q/${LIGA}?tab=${tab}`)
  await page.waitForTimeout(900)
}

const activa = (page) => page.locator('button[aria-current="page"]')

/* EL FALLO: se abre una pestaña de la derecha y la fila se queda al principio,
   así que se ve el contenido de Admin con «Resumen» arriba y nada marcado. */
test.describe('la pestaña activa se ve', () => {
  for (const tab of ['admin', 'rules', 'global', 'teams']) {
    test(`al abrir directamente «${tab}» la pestaña activa entra en pantalla`, async ({ page }) => {
      await abrir(page, tab)
      const caja = await activa(page).boundingBox()
      const ancho = page.viewportSize().width
      expect(caja, 'no hay ninguna pestaña marcada como activa').not.toBeNull()
      expect(caja.x, `la pestaña activa empieza fuera de pantalla (x=${caja.x})`).toBeGreaterThanOrEqual(0)
      expect(caja.x + caja.width).toBeLessThanOrEqual(ancho)
    })
  }

  test('y sigue viéndose después de volver de Detalles del Partido', async ({ page }) => {
    /* El caso de todos los días: al entrar a un partido `GroupPage` se
       desmonta, y al volver la pestaña se restaura de la URL. */
    await abrir(page, 'teams')
    await page.goto(`/match/${uuid(1)}`)
    await page.waitForTimeout(600)
    await page.goBack()
    await page.waitForTimeout(900)
    const caja = await activa(page).boundingBox()
    expect(caja).not.toBeNull()
    expect(caja.x).toBeGreaterThanOrEqual(0)
    expect(caja.x + caja.width).toBeLessThanOrEqual(page.viewportSize().width)
  })
})

/* WCAG 2.2 §2.5.8: 24×24 px mínimo para cualquier cosa que se toque. */
test.describe('lo que se toca entra en un dedo', () => {
  for (const tab of ['home', 'matches']) {
    test(`ningún botón de «${tab}» baja de 24 px`, async ({ page }) => {
      await abrir(page, tab)
      const chicos = await page.evaluate(() => {
        const fuera = []
        for (const el of document.querySelectorAll('main button, main a[href], main [role="tab"]')) {
          const c = el.getBoundingClientRect()
          if (c.width === 0 || c.height === 0) continue       // escondido
          if (el.closest('[aria-hidden="true"]')) continue
          if (c.width < 24 || c.height < 24) {
            fuera.push(`${Math.round(c.width)}×${Math.round(c.height)} "${(el.textContent || '').trim().slice(0, 24)}"`)
          }
        }
        return fuera
      })
      expect(chicos, `botones por debajo de 24 px: ${chicos.join(' · ')}`).toEqual([])
    })
  }
})

/* EL SUELO ES 9 px, Y NO 10, a propósito.

   Las etiquetas en versalitas estaban a 8.5 px —«LIGA», «Posición»,
   «Jugador»— y subieron a 10. Pero medido sobre el repo entero hay **62**
   textos a 9 y 9.5 px: eso no es un fallo suelto, es la escala tipográfica de
   la app. Subirla es una decisión de diseño del dueño, no un arreglo, así que
   esta prueba fija lo que sí se puede afirmar: que nada baje de 9 px, que era
   el caso de «cierra en 3h 45m» —el aviso de cuánto queda para predecir— a
   8 px. */
test('ninguna etiqueta baja de 9 px', async ({ page }) => {
  await abrir(page, 'matches')
  const minusculos = await page.evaluate(() => {
    const fuera = []
    for (const el of document.querySelectorAll('main *')) {
      if (el.children.length || !(el.textContent || '').trim()) continue
      const px = parseFloat(getComputedStyle(el).fontSize)
      if (px && px < 9) fuera.push(`${px}px "${el.textContent.trim().slice(0, 20)}"`)
    }
    return [...new Set(fuera)]
  })
  expect(minusculos, `texto por debajo de 9 px: ${minusculos.join(' · ')}`).toEqual([])
})
