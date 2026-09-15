/* Los créditos de ×2 arrastrados de un partido cancelado, sobre la pantalla.

   Esta consulta devolvió **HTTP 400 a 23 de las 24 personas** durante meses:
   `my_powerup_credits` llamaba por dentro a `resolve_pending_powerup_credits`,
   que solo deja pasar al backend o al admin global, y un `RAISE EXCEPTION` de
   plpgsql sale como P0001 → 400. Nadie lo vio porque el fallo caía en un
   `data = {}` por defecto: la pantalla no mostraba un error, mostraba un cupo
   MÁS CHICO del que la base aplica.

   Por eso las dos mitades se prueban acá y no en vitest: lo que había que
   arreglar no era una fórmula, era que la pantalla se callara. */
import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

const LIGA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const AHORA = new Date('2026-09-09T15:00:00Z')
const uuid = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`

const partido = (n, nombre) => ({
  id: uuid(n), tournament_id: 6, phase: 'groups', matchday: 1, stage: 'Jornada 1',
  home_team: nombre, away_team: `Rival ${n}`, home_team_code: 'xx', away_team_code: 'xx',
  status: 'pending', kickoff_at: '2026-09-09T19:00:00Z',
  home_goals_actual: null, away_goals_actual: null, events_json: [],
})

const PARTIDOS = [partido(1, 'Primero'), partido(2, 'Segundo'), partido(3, 'Tercero')]

const GRUPO = {
  id: LIGA, name: 'Bundestica', tournament_id: 6, invitation_code: 'ABC123',
  powerup_limit: 2, points_exact: 3, points_correct: 1,
  champion_points: 12, scorer_points: 12, assist_points: 12,
  is_admin: false, rules_accepted: true, rules: null, members_count: 7,
  tournament_kind: 'league', tournament_status: 'active',
}

/* El aviso solo aparece si la consulta FALLA, así que hay que poder hacerla
   fallar. En Playwright gana la ÚLTIMA ruta registrada: esta va después del
   comodín de `interceptarSupabase`, o se la traga y nunca llega el 400. */
async function conCreditos(page, respuesta) {
  await page.route('**://pruebas.supabase.co/**', async (route) => {
    const url = route.request().url()
    if (!url.includes('rpc/my_powerup_credits')) return route.fallback()
    return route.fulfill({
      status: respuesta.status,
      contentType: 'application/json',
      body: JSON.stringify(respuesta.body),
    })
  })
}

test.beforeEach(async ({ page }) => {
  await sinRedExterna(page)
  await conSesion(page)
  await page.clock.setFixedTime(AHORA)
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_seen', 'true')
    localStorage.setItem('pwaPromptDismissed', 'true')
  })
  await interceptarSupabase(page, {
    // OBJETO, no lista: AuthContext lo pide con `.single()`.
    '/rest/v1/users': {
      id: USUARIO.id, display_name: 'Prueba', avatar_url: null,
      total_points: 0, points_adjustment: 0, is_admin: false,
      created_at: '2026-01-01', updated_at: '2026-01-01',
    },
    'rpc/my_groups': [GRUPO],
    'rpc/quiniela_por_id': GRUPO,
    '/rest/v1/matches': PARTIDOS,
    '/rest/v1/predictions': [],
    'rpc/cupos_por_jornada': [],
  })
})

const abrir = (page) => page.goto(`/q/${LIGA}?tab=matches&j=Jornada+1`)
const aviso = (page) => page.getByText(/No se pudieron cargar tus comodines/i)

/* EL FALLO REAL, tal cual llegaba a producción: 400 con el cuerpo de error de
   PostgREST. La pantalla tiene que DECIRLO. */
test('si la consulta de créditos falla, la pantalla lo dice', async ({ page }) => {
  await conCreditos(page, {
    status: 400,
    body: { code: 'P0001', message: 'Solo un administrador puede resolver créditos pendientes' },
  })
  await abrir(page)

  await expect(page.getByText('Primero', { exact: true })).toBeVisible({ timeout: 15000 })
  /* react-query reintenta tres veces antes de darse por vencida, así que el
     aviso tarda unos segundos en aparecer. Eso también es fiel al fallo real:
     cuando la RPC devuelve 400, se reintenta y se vuelve a fallar. */
  await expect(aviso(page)).toBeVisible({ timeout: 20000 })
})

/* La otra mitad: cuando responde, el crédito SE SUMA al cupo. Sin esta, el
   aviso podría quedarse puesto siempre y la prueba de arriba pasaría igual. */
test('un crédito arrastrado sube el cupo de la jornada y no hay aviso', async ({ page }) => {
  // La llave la arma `llaveDeCupo`: clave de fase + jornada → 'groups|1'.
  await conCreditos(page, { status: 200, body: [{ phase: 'groups', matchday: 1, credits: 1 }] })
  await abrir(page)

  await expect(page.getByText('Primero', { exact: true })).toBeVisible({ timeout: 15000 })
  // Cupo base 2 (leagues.powerup_limit) + 1 arrastrado, ninguno usado.
  await expect(page.getByText('×2 · 3/3')).toBeVisible()
  await expect(aviso(page)).toHaveCount(0)
})

/* Sin créditos, el cupo es el de la quiniela y tampoco hay aviso: un cartel
   que sale siempre no informa de nada. */
test('sin créditos el cupo es el de la quiniela', async ({ page }) => {
  await conCreditos(page, { status: 200, body: [] })
  await abrir(page)

  await expect(page.getByText('Primero', { exact: true })).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('×2 · 2/2')).toBeVisible()
  await expect(aviso(page)).toHaveCount(0)
})
