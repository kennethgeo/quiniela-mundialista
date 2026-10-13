/* PAGOS QUE NO SE PIERDEN EN SILENCIO (vigésima auditoría, 2.1 · migración 109).

   El pago son columnas de la membresía: «quitar» lo dejaba en NULL con un solo
   toque, sin preguntar y sin rastro, y expulsar a quien pagó borraba la fila
   —y con ella el pago— con un aviso que hablaba de predicciones y no de plata.

   Se afirma sobre lo que la persona VE y sobre lo que se LLAMA: el arreglo es
   justamente que el toque ya no llame a nada hasta confirmar. */
import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

const LIGA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BETO = '00000000-0000-4000-8000-0000000000b1'
const CARO = '00000000-0000-4000-8000-0000000000c1'

const grupo = {
  id: LIGA, name: 'Bundestica', tournament_id: 2, invitation_code: '6BE60F',
  powerup_limit: 2, points_exact: 3, points_correct: 1, champion_points: 12,
  scorer_points: 12, assist_points: 12, rules: 'No se vale predecir con el partido empezado.',
  rules_accepted: true, soy_creador: true, is_admin: true, members_count: 3,
  tournament_kind: 'league', tournament_status: 'active', tournament_ref: 'crc.1',
}

/* La forma de `league_miembros` y `league_pozo` en producción (leídas con
   pg_get_functiondef el 12 oct 2026). */
const MIEMBROS = [
  { user_id: USUARIO.id, display_name: 'Prueba', avatar_url: null, es_creador: true, es_admin: true, soy_yo: true, joined_at: '2026-07-20T00:00:00Z' },
  { user_id: BETO, display_name: 'Beto', avatar_url: null, es_creador: false, es_admin: false, soy_yo: false, joined_at: '2026-07-20T00:00:00Z' },
  { user_id: CARO, display_name: 'Caro', avatar_url: null, es_creador: false, es_admin: false, soy_yo: false, joined_at: '2026-07-20T00:00:00Z' },
]
const POZO = {
  cuota: 10000, moneda: 'CRC', reparto: [{ puesto: 1, porcentaje: 65 }, { puesto: 2, porcentaje: 35 }],
  soy_admin: true, miembros: 3, pagados: 1, pozo_total: 30000, recaudado: 10000,
  gente: [
    { user_id: BETO, display_name: 'Beto', avatar_url: null, es_admin: false, soy_yo: false, aviso: true, confirmado: true },
    { user_id: CARO, display_name: 'Caro', avatar_url: null, es_admin: false, soy_yo: false, aviso: false, confirmado: false },
    { user_id: USUARIO.id, display_name: 'Prueba', avatar_url: null, es_admin: true, soy_yo: true, aviso: true, confirmado: false },
  ],
}
/* Lo que el trigger de la 109 escribe: numeric como número, created_at en UTC. */
const HISTORIAL = [
  { id: 2, user_id: BETO, accion: 'confirmado', monto: 10000, moneda: 'CRC', por: USUARIO.id,
    created_at: '2026-09-21T18:10:00+00:00', sembrada: true },
  { id: 1, user_id: '00000000-0000-4000-8000-0000000000d1', accion: 'borrado', monto: 10000, moneda: 'CRC',
    por: USUARIO.id, created_at: '2026-09-20T18:10:00+00:00', sembrada: false },
]

/* El pozo vive en su pestaña desde el 13 oct 2026; expulsar sigue en Reglas.
   Este POZO tiene la forma de ANTES de la 110 (sin `al_dia`): así también se
   prueba que la pantalla no se rompe si el frontend llega antes que la
   migración —confirmar sigue siendo la cuota entera, de un toque—. */
async function abrir (page, { tab = 'pozo' } = {}) {
  await sinRedExterna(page)
  await conSesion(page)
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_seen', 'true'); localStorage.setItem('pwaPromptDismissed', 'true')
  })
  await page.route('**/_backend/api/**', (r) => r.fulfill({
    status: 200, contentType: 'application/json', body: '{"groups":[]}',
  }))
  await interceptarSupabase(page, {
    '/rest/v1/users': {
      id: USUARIO.id, display_name: 'Prueba', avatar_url: null, total_points: 3,
      points_adjustment: 0, is_admin: false, created_at: '2026-01-01', updated_at: '2026-01-01',
    },
    'rpc/my_groups': [grupo], 'rpc/quiniela_por_id': grupo,
    'rpc/league_miembros': MIEMBROS, 'rpc/league_pozo': POZO,
    // El pago de una persona, leído de la membresía como lo deja ver la RLS.
    '/rest/v1/league_members': (url) => (url.includes(`user_id=eq.${BETO}`)
      ? [{ pago_confirmado_at: '2026-09-21T18:10:00+00:00', pago_confirmado_monto: 10000, pago_confirmado_moneda: 'CRC' }]
      : [{ pago_confirmado_at: null, pago_confirmado_monto: null, pago_confirmado_moneda: null }]),
    '/rest/v1/historial_pagos': HISTORIAL,
  })
  const confirmaciones = []
  await page.route('**/rest/v1/rpc/confirmar_pago*', async (r) => {
    confirmaciones.push(JSON.parse(r.request().postData() || '{}'))
    return r.fulfill({ status: 204, body: '' })
  })
  const expulsiones = []
  await page.route('**/rest/v1/rpc/expulsar_miembro*', async (r) => {
    expulsiones.push(JSON.parse(r.request().postData() || '{}'))
    return r.fulfill({ status: 204, body: '' })
  })
  await page.goto(`/q/${LIGA}?tab=${tab}`)
  if (tab === 'pozo') await expect(page.getByText('Pozo y pagos')).toBeVisible()
  else await expect(page.getByRole('button', { name: 'Sacar de la quiniela' }).first()).toBeVisible()
  return { confirmaciones, expulsiones }
}

const filaDelPozo = (page, nombre) => page.locator('div.flex.items-center.gap-2.py-1')
  .filter({ hasText: nombre }).filter({ has: page.getByRole('button', { name: /quitar|confirmar/ }) })

test.describe('«quitar» un pago confirmado', () => {
  test('pide confirmación y no llama a nada hasta confirmar', async ({ page }) => {
    const { confirmaciones } = await abrir(page)
    await filaDelPozo(page, 'Beto').getByRole('button', { name: 'quitar' }).click()
    const dialogo = page.getByRole('dialog', { name: 'Quitar el pago de Beto' })
    await expect(dialogo).toBeVisible()
    await expect(dialogo.getByText(/Queda registrado en el historial/)).toBeVisible()
    // Lo que se asienta: un instante después, todavía no se llamó a nada.
    await page.waitForTimeout(300)
    expect(confirmaciones).toEqual([])

    await dialogo.getByRole('button', { name: 'Cancelar' }).click()
    await expect(dialogo).toHaveCount(0)
    expect(confirmaciones).toEqual([])
  })

  test('al confirmar, quita ese pago y solo ese', async ({ page }) => {
    const { confirmaciones } = await abrir(page)
    await filaDelPozo(page, 'Beto').getByRole('button', { name: 'quitar' }).click()
    await page.getByRole('dialog', { name: 'Quitar el pago de Beto' })
      .getByRole('button', { name: 'Quitar el pago' }).click()
    await expect.poll(() => confirmaciones.length).toBe(1)
    expect(confirmaciones[0]).toEqual({ p_league_id: LIGA, p_user_id: BETO, p_confirmado: false })
  })

  test('confirmar un pago sigue siendo un toque', async ({ page }) => {
    const { confirmaciones } = await abrir(page)
    await filaDelPozo(page, 'Caro').getByRole('button', { name: 'confirmar' }).click()
    await expect.poll(() => confirmaciones.length).toBe(1)
    expect(confirmaciones[0]).toEqual({ p_league_id: LIGA, p_user_id: CARO, p_confirmado: true })
  })
})

test.describe('expulsar a quien pagó', () => {
  test('el aviso dice que tiene un pago confirmado, con el monto, y que queda en el historial', async ({ page }) => {
    await abrir(page, { tab: 'rules' })
    await page.getByRole('button', { name: 'Sacar de la quiniela' }).first().click()
    const dialogo = page.getByRole('dialog', { name: 'Sacar a Beto' })
    await expect(dialogo).toBeVisible()
    await expect(dialogo.getByText(/Beto tiene un pago confirmado de ₡10\D?000: quedará registrado en el historial/))
      .toBeVisible()
  })

  test('mientras no se sabe si pagó, «Sacar» no se puede tocar', async ({ page }) => {
    const { expulsiones } = await abrir(page, { tab: 'rules' })
    /* La red lenta es justo cuando el aviso llega tarde: si «Sacar» estuviera
       habilitado, el admin expulsaría sin haber visto que esa persona pagó. */
    let soltar
    const respuesta = new Promise((resolver) => { soltar = resolver })
    await page.route('**/rest/v1/league_members*', async (r) => {
      await respuesta
      return r.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([{ pago_confirmado_at: '2026-09-21T18:10:00+00:00', pago_confirmado_monto: 10000, pago_confirmado_moneda: 'CRC' }]),
      })
    })
    await page.getByRole('button', { name: 'Sacar de la quiniela' }).first().click()
    const dialogo = page.getByRole('dialog', { name: 'Sacar a Beto' })
    await expect(dialogo.getByRole('status')).toHaveText(/Comprobando si tiene un pago confirmado/)
    const sacar = dialogo.getByRole('button', { name: 'Sacar' })
    await expect(sacar).toBeDisabled()
    await sacar.click({ force: true })
    expect(expulsiones).toEqual([])

    soltar()
    await expect(dialogo.getByText(/Beto tiene un pago confirmado de/)).toBeVisible()
    await expect(sacar).toBeEnabled()
  })

  test('a quien no pagó no se le inventa un pago', async ({ page }) => {
    const { expulsiones } = await abrir(page, { tab: 'rules' })
    await page.getByRole('button', { name: 'Sacar de la quiniela' }).nth(1).click()
    const dialogo = page.getByRole('dialog', { name: 'Sacar a Caro' })
    await expect(dialogo).toBeVisible()
    // Se espera a que la comprobación termine (el botón se habilita) antes de
    // afirmar una ausencia: si no, pasaría en el instante previo.
    const sacar = dialogo.getByRole('button', { name: 'Sacar' })
    await expect(sacar).toBeEnabled()
    await expect(dialogo.getByText(/pago confirmado de/)).toHaveCount(0)
    await sacar.click()
    await expect.poll(() => expulsiones.length).toBe(1)
    expect(expulsiones[0]).toEqual({ p_league_id: LIGA, p_user_id: CARO })
  })
})

test('el historial muestra quién hizo qué, también con gente que ya no está', async ({ page }) => {
  await abrir(page)
  await page.getByText('Historial de pagos').click()
  const lista = page.getByRole('list', { name: 'Movimientos de pagos' })
  await expect(lista.getByText('Prueba confirmó el pago de Beto')).toBeVisible()
  await expect(lista.getByText(/sacó de la quiniela a alguien que ya no está/)).toBeVisible()
})
