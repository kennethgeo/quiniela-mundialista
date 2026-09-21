/* La pestaña Reglas la ve TODO el grupo, así que lo que dice tiene que ser
   cierto y completo para todo el grupo — no solo para quien puede tocar los
   botones. Dos textos incumplían eso.

   Se afirma sobre lo que se VE con cada rol. Comprobar el texto sin distinguir
   admin de miembro pasaría con los dos fallos puestos. */
import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

const LIGA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const uuid = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`

/* Un partido YA JUGADO: es lo que hace `tournamentStarted` verdadero, que es
   la condición del candado del puntaje. */
const PARTIDO_JUGADO = {
  id: uuid(1), tournament_id: 2, phase: 'groups', matchday: 1, stage: 'Jornada 1',
  home_team: 'Saprissa', away_team: 'Herediano', home_team_code: 'xx', away_team_code: 'xx',
  status: 'finished', kickoff_at: '2026-09-01T19:00:00Z', group_name: null,
  home_goals_actual: 2, away_goals_actual: 0, events_json: [],
}

const grupo = (extra = {}) => ({
  id: LIGA, name: 'Bundestica', tournament_id: 2, invitation_code: '6BE60F',
  powerup_limit: 2, points_exact: 3, points_correct: 1, champion_points: 12,
  scorer_points: 12, assist_points: 12, rules_accepted: true, rules: 'Reglas del grupo',
  members_count: 17, tournament_kind: 'league', tournament_status: 'active',
  tournament_ref: 'crc.1', is_admin: false, ...extra,
})

async function abrirReglas (page, { esAdmin = false, torneoEmpezado = true } = {}) {
  await sinRedExterna(page)
  await conSesion(page)
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_seen', 'true'); localStorage.setItem('pwaPromptDismissed', 'true')
  })
  await page.route('**/_backend/api/**', (r) => r.fulfill({
    status: 200, contentType: 'application/json', body: '{"groups":[]}',
  }))
  const g = grupo({ is_admin: esAdmin })
  await interceptarSupabase(page, {
    '/rest/v1/users': {
      id: USUARIO.id, display_name: 'Prueba', avatar_url: null, total_points: 0,
      points_adjustment: 0, is_admin: false, created_at: '2026-01-01', updated_at: '2026-01-01',
    },
    'rpc/my_groups': [g], 'rpc/quiniela_por_id': g,
    '/rest/v1/matches': torneoEmpezado ? [PARTIDO_JUGADO] : [],
    '/rest/v1/predictions': [],
  })
  await page.goto(`/q/${LIGA}?tab=rules`)
  await expect(page.getByText('Puntaje', { exact: false }).first()).toBeVisible({ timeout: 15000 })
}

/* EL FALLO 1: el cartel del candado iba detrás de `isAdmin`, así que el
   miembro que va a VOTAR el cambio no se enteraba de que había algo que votar. */
test.describe('el candado del puntaje se le explica a todo el grupo', () => {
  /* Se afirma sobre CUÁL de las dos redacciones sale, no sobre cuántas veces
     aparece: la frase de «proponé» existe también en el editor de cupos, así
     que contar elementos daría un falso positivo. */
  const paraMiembro = /un admin tiene que proponerlo y lo vota el grupo/i
  const paraAdmin = /proponé el cambio y el grupo lo vota/i

  test('un MIEMBRO ve que está bloqueado y que se cambia votando', async ({ page }) => {
    await abrirReglas(page, { esAdmin: false })
    await expect(page.getByText(/el puntaje queda bloqueado/i).first()).toBeVisible()
    await expect(page.getByText(paraMiembro)).toHaveCount(1)
    // Y NO se le pide a él que lo proponga: no puede.
    await expect(page.getByText(paraAdmin)).toHaveCount(0)
  })

  test('a un ADMIN se le dice que lo proponga él', async ({ page }) => {
    await abrirReglas(page, { esAdmin: true })
    await expect(page.getByText(paraAdmin).first()).toBeVisible()
    await expect(page.getByText(paraMiembro)).toHaveCount(0)
  })

  test('con el torneo sin empezar no se habla de candado', async ({ page }) => {
    /* Decir «bloqueado» donde todavía se puede editar sería mentir al revés. */
    await abrirReglas(page, { esAdmin: false, torneoEmpezado: false })
    await expect(page.getByText(/queda bloqueado/i)).toHaveCount(0)
  })
})

/* EL FALLO 2: «corré "Recalcular puntajes" en el Panel Admin» era falso de
   cuatro formas —nombre, ubicación, alcance y premisa— y desde que existe
   `AdminRoute` manda a un admin de quiniela a una redirección. */
test.describe('no se manda a nadie a una puerta cerrada', () => {
  test('ya no se promete un botón que ese admin no puede pulsar', async ({ page }) => {
    await abrirReglas(page, { esAdmin: true, torneoEmpezado: false })
    await expect(page.getByText(/Recalcular puntajes/i)).toHaveCount(0)
    await expect(page.getByText(/Panel Admin/i)).toHaveCount(0)
  })

  test('y se dice lo que SÍ es cierto: lo jugado no se vuelve a puntuar', async ({ page }) => {
    await abrirReglas(page, { esAdmin: true, torneoEmpezado: false })
    await expect(page.getByText(/no vuelve a puntuar/i)).toBeVisible()
  })
})
