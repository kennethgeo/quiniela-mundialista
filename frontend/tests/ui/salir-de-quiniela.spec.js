/* SALIR DE UNA QUINIELA.

   Hasta la migración 83 no existía ninguna forma de irse: el único borrado de
   `league_members` vivía en `expulsar_miembro`, que exige ser admin y prohíbe
   expulsarse a uno mismo. Y «No acepto · salir» de la puerta de reglas SOLO
   NAVEGABA: quien creía haber rechazado las reglas seguía siendo miembro.
   Medido en producción: 9 membresías en ese estado.

   Se afirma sobre lo que la persona VE y sobre lo que se LLAMA. Comprobar que
   el botón existe no bastaría: el fallo original era justamente un botón que
   existía y no hacía nada. */
import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

const LIGA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const uuid = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`

const PARTIDO = {
  id: uuid(1), tournament_id: 2, phase: 'groups', matchday: 1, stage: 'Jornada 1',
  home_team: 'Saprissa', away_team: 'Herediano', home_team_code: 'xx', away_team_code: 'xx',
  status: 'finished', kickoff_at: '2026-09-01T19:00:00Z', group_name: null,
  home_goals_actual: 2, away_goals_actual: 0, events_json: [],
}

const MIS_PREDICCIONES = [
  { id: uuid(9), user_id: USUARIO.id, league_id: LIGA, match_id: uuid(1),
    home_goals_pred: 2, away_goals_pred: 0, points_earned: 3, powerup_x2: false },
]

const grupo = (extra = {}) => ({
  id: LIGA, name: 'Bundestica', tournament_id: 2, invitation_code: '6BE60F',
  powerup_limit: 2, points_exact: 3, points_correct: 1, champion_points: 12,
  scorer_points: 12, assist_points: 12, rules: 'No se vale predecir con el partido empezado.',
  rules_accepted: true, soy_creador: false, is_admin: false, members_count: 17,
  tournament_kind: 'league', tournament_status: 'active', tournament_ref: 'crc.1', ...extra,
})

async function abrir (page, { g = grupo(), tab = 'rules', salida } = {}) {
  await sinRedExterna(page)
  await conSesion(page)
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_seen', 'true'); localStorage.setItem('pwaPromptDismissed', 'true')
  })
  await page.route('**/_backend/api/**', (r) => r.fulfill({
    status: 200, contentType: 'application/json', body: '{"groups":[]}',
  }))
  /* Se registra ANTES del comodín de Supabase no: en Playwright gana la ÚLTIMA
     ruta, así que esta va después para poder espiar la llamada. */
  await interceptarSupabase(page, {
    '/rest/v1/users': {
      id: USUARIO.id, display_name: 'Prueba', avatar_url: null, total_points: 3,
      points_adjustment: 0, is_admin: false, created_at: '2026-01-01', updated_at: '2026-01-01',
    },
    'rpc/my_groups': [g], 'rpc/quiniela_por_id': g,
    '/rest/v1/matches': [PARTIDO], '/rest/v1/predictions': MIS_PREDICCIONES,
  })
  const llamadas = []
  await page.route('**/rest/v1/rpc/salir_de_quiniela*', async (r) => {
    llamadas.push(JSON.parse(r.request().postData() || '{}'))
    if (salida === 'pago') {
      return r.fulfill({ status: 400, contentType: 'application/json',
        body: JSON.stringify({ message: 'Tenés un pago confirmado en esta quiniela: si salís se borraría ese registro. Hablá con un administrador antes de salir.' }) })
    }
    if (salida === 'error') {
      return r.fulfill({ status: 400, contentType: 'application/json',
        body: JSON.stringify({ message: 'Creaste esta quiniela, así que no podés salirte' }) })
    }
    return r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ predicciones_borradas: 1, globales_borradas: 0 }) })
  })
  await page.goto(`/q/${LIGA}?tab=${tab}`)
  return llamadas
}

/* Por su rol, no por su texto: el aviso repite frases que también están en
   la tarjeta que abre el diálogo. */
const modal = (page) => page.getByRole('dialog', { name: 'Salir de Bundestica' })

test.describe('la alerta dice lo que de verdad se pierde', () => {
  test('nombra las predicciones, las globales y el total global', async ({ page }) => {
    await abrir(page)
    await page.getByRole('button', { name: 'Quiero salir' }).click()
    await expect(modal(page)).toBeVisible()
    // El número sale de SUS predicciones, no de un texto genérico.
    const aviso = modal(page)
    await expect(aviso.getByText(/1 predicciones/)).toBeVisible()
    await expect(aviso.getByText(/campeón, goleador y asistidor/i)).toBeVisible()
    // Lo que nadie se espera, y es lo que más importa decir.
    await expect(aviso.getByText(/total global puede bajar/i)).toBeVisible()
    await expect(aviso.getByText(/No se puede deshacer/i)).toBeVisible()
  })

  test('hay que ESCRIBIR para confirmar: un segundo botón se pulsa por inercia', async ({ page }) => {
    await abrir(page)
    await page.getByRole('button', { name: 'Quiero salir' }).click()
    const salir = page.getByRole('button', { name: 'Salir de la quiniela' })
    await expect(salir).toBeDisabled()
    await page.getByRole('textbox').fill('SALIR')
    await expect(salir).toBeEnabled()
  })

  test('«Mejor me quedo» no llama a nada', async ({ page }) => {
    const llamadas = await abrir(page)
    await page.getByRole('button', { name: 'Quiero salir' }).click()
    await page.getByRole('button', { name: 'Mejor me quedo' }).click()
    await expect(modal(page)).toHaveCount(0)
    expect(llamadas).toEqual([])
  })
})

test.describe('sale de verdad', () => {
  test('confirmar llama a la RPC con esta quiniela', async ({ page }) => {
    const llamadas = await abrir(page)
    await page.getByRole('button', { name: 'Quiero salir' }).click()
    await page.getByRole('textbox').fill('SALIR')
    await page.getByRole('button', { name: 'Salir de la quiniela' }).click()
    await expect.poll(() => llamadas.length).toBe(1)
    expect(llamadas[0]).toEqual({ p_league_id: LIGA })
  })

  /* EL FALLO ORIGINAL: el botón de la puerta de reglas solo navegaba. */
  test('«No acepto · salir» ahora sale, no solo navega', async ({ page }) => {
    const llamadas = await abrir(page, { g: grupo({ rules_accepted: false }) })
    await page.getByRole('button', { name: /No acepto/ }).click()
    await expect(modal(page)).toBeVisible()
    await page.getByRole('textbox').fill('SALIR')
    await page.getByRole('button', { name: 'Salir de la quiniela' }).click()
    await expect.poll(() => llamadas.length).toBe(1)
  })

  test('si la RPC falla se DICE, no se finge que salió', async ({ page }) => {
    await abrir(page, { salida: 'error' })
    await page.getByRole('button', { name: 'Quiero salir' }).click()
    await page.getByRole('textbox').fill('SALIR')
    await page.getByRole('button', { name: 'Salir de la quiniela' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(modal(page)).toBeVisible()
  })
})

/* EL PAGO NO SE PUEDE BORRAR SOLO (migración 84).

   El control de pagos son COLUMNAS de `league_members` (migración 58), así que
   borrar la membresía borra la constancia de que alguien pagó. Eso ya pasaba al
   expulsar —acción de admin, poco frecuente— pero la 83 lo volvió autoservicio:
   cualquiera podía borrar su propio comprobante con un botón. Medido: 13 pagos
   confirmados en una quiniela de ₡10.000 por cabeza. */
test.describe('un pago confirmado no se borra saliendo', () => {
  test('se avisa ANTES de intentarlo', async ({ page }) => {
    await abrir(page)
    await page.getByRole('button', { name: 'Quiero salir' }).click()
    await expect(modal(page).getByText(/pago confirmado/i)).toBeVisible()
    await expect(modal(page).getByText(/sin constancia que pagaste/i)).toBeVisible()
  })

  test('y si igual se intenta, la base lo niega y se DICE', async ({ page }) => {
    /* El motivo tiene que llegar entero a la pantalla: «no se pudo» a secas
       dejaría a la persona sin saber qué hacer, y lo que hay que hacer es
       hablar con un admin. */
    await abrir(page, { salida: 'pago' })
    await page.getByRole('button', { name: 'Quiero salir' }).click()
    await page.getByRole('textbox').fill('SALIR')
    await page.getByRole('button', { name: 'Salir de la quiniela' }).click()
    await expect(page.getByRole('alert')).toContainText(/pago confirmado/i)
    await expect(page.getByRole('alert')).toContainText(/administrador/i)

    /* Y SIGUE DENTRO: no se finge que salió.
       Se afirma sobre la URL y no sobre el diálogo. `toBeVisible()` acierta en
       un fotograma intermedio —el error se pinta y la navegación ocurre
       después— así que pasaba igual con el cierre puesto a la fuerza.
       Comprobado. Es la misma trampa que ya está anotada para el contraste del
       foco: medir antes de que las cosas se asienten no prueba nada. */
    await page.waitForTimeout(500)
    await expect(page).toHaveURL(new RegExp(`/q/${LIGA}`))
    await expect(modal(page)).toBeVisible()
  })
})

/* Al creador no se le ofrece: `leagues.admin_id` no se puede quitar y no hay
   traspaso, así que si se fuera quedaría un grupo sin dueño. */
test('al creador no se le ofrece salir', async ({ page }) => {
  await abrir(page, { g: grupo({ soy_creador: true, is_admin: true }) })
  /* PRIMERO SE ESPERA A QUE LA PESTAÑA EXISTA. Sin esto, `toHaveCount(0)` se
     evalúa sobre una página todavía vacía y pasa SIEMPRE — comprobado: con el
     guard `!soyCreador` quitado a propósito, esta prueba seguía en verde.
     «Eliminar quiniela» solo lo ve el creador, así que sirve de ancla: cuando
     está, la pestaña terminó de dibujarse y la ausencia ya significa algo. */
  await expect(page.getByRole('button', { name: 'Eliminar quiniela' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Quiero salir' })).toHaveCount(0)
})
