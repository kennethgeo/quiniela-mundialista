/* EL POZO EN SU PESTAÑA, CON PAGOS PARCIALES (pedido del dueño, 13 oct 2026).

   Lo que pidió: una pestaña propia, fuera de Reglas, donde el grupo vea quién
   pagó y quién no; que se pueda avisar un pago parcial —la mitad o un monto
   cualquiera— que confirma un admin de la quiniela; y que se pueda compartir
   como imagen.

   Se afirma sobre lo que la persona VE y sobre lo que se LLAMA a la base (con
   qué monto y con qué total visto: es lo que impide sumar dos veces). Los
   datos tienen la forma de `league_pozo` con la migración 110. */
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { env } from 'node:process'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

const LIGA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab'
const BETO = '00000000-0000-4000-8000-0000000000b2'
const CARO = '00000000-0000-4000-8000-0000000000c2'
const DANI = '00000000-0000-4000-8000-0000000000d2'

const grupo = (esAdmin) => ({
  id: LIGA, name: 'Bundestica', tournament_id: 2, invitation_code: '6BE60F',
  powerup_limit: 2, points_exact: 3, points_correct: 1, champion_points: 12,
  scorer_points: 12, assist_points: 12, rules: 'Reglas.', rules_accepted: true,
  soy_creador: esAdmin, is_admin: esAdmin, members_count: 4, members: 4,
  tournament_name: 'Primera División de Costa Rica',
  tournament_kind: 'league', tournament_status: 'active', tournament_ref: 'crc.1',
})

const persona = (id, nombre, extra) => ({
  user_id: id, display_name: nombre, avatar_url: null, es_admin: false, soy_yo: false,
  aviso: false, aviso_monto: null, confirmado: false, monto: null, falta: 10000, al_dia: false,
  estado: 'pendiente', ...extra,
})

const pozo = ({ soyAdmin, yo = {}, reparto = [{ puesto: 1, porcentaje: 65 }, { puesto: 2, porcentaje: 35 }] }) => ({
  cuota: 10000, moneda: 'CRC', reparto,
  soy_admin: soyAdmin, miembros: 4, pagados: 2, al_dia: 1, pozo_total: 40000, recaudado: 15000, faltan: 25000,
  gente: [
    persona(BETO, 'Beto', { confirmado: true, monto: 10000, falta: 0, al_dia: true, estado: 'pagado' }),
    persona(CARO, 'Caro', { confirmado: true, monto: 5000, falta: 5000, estado: 'parcial' }),
    persona(DANI, 'Dani', { aviso: true, aviso_monto: 5000 }),
    persona(USUARIO.id, 'Prueba', { soy_yo: true, es_admin: soyAdmin, ...yo }),
  ],
})

async function abrir (page, { soyAdmin = false, yo, reparto, rpc = {}, pozoExtra = {} } = {}) {
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
    'rpc/my_groups': [grupo(soyAdmin)], 'rpc/quiniela_por_id': grupo(soyAdmin),
    'rpc/league_pozo': { ...pozo({ soyAdmin, yo, reparto }), ...pozoExtra },
    '/rest/v1/historial_pagos': [],
  })
  const llamadas = []
  for (const nombre of ['avisar_abono', 'avisar_pago', 'confirmar_abono', 'confirmar_pago', 'set_league_pozo']) {
    await page.route(`**/rest/v1/rpc/${nombre}*`, async (r) => {
      llamadas.push({ nombre, cuerpo: JSON.parse(r.request().postData() || '{}') })
      if (rpc[nombre]) return r.fulfill(rpc[nombre])
      if (nombre === 'confirmar_abono' && !Object.hasOwn(llamadas.at(-1).cuerpo, 'p_aviso_visto')) {
        return r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({
          code: 'PGRST202', message: 'confirmar_abono requiere los cinco parámetros de la migración 110',
        }) })
      }
      return r.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
    })
  }
  await page.goto(`/q/${LIGA}?tab=pozo`)
  await expect(page.getByText('Pozo y pagos')).toBeVisible()
  // Anclas que solo existen con los datos ya pintados: una ausencia antes de
  // esto no significaría nada.
  await expect(fila(page, 'Dani')).toBeVisible()
  return { llamadas }
}

const fila = (page, nombre) => page.locator(`[data-persona="${nombre}"]`)

test('el pozo en dólares conserva centavos en resumen, premios y aviso de la mitad', async ({ page }) => {
  const { llamadas } = await abrir(page, { pozoExtra: {
    cuota: 25.5, moneda: 'USD', recaudado: 38.25, pozo_total: 102, faltan: 63.75,
    reparto: [{ puesto: 1, monto: 63.75 }, { puesto: 2, monto: 25.5 }],
    gente: [
      persona(BETO, 'Beto', { confirmado: true, monto: 25.5, falta: 0, al_dia: true, estado: 'pagado' }),
      persona(CARO, 'Caro', { confirmado: true, monto: 12.75, falta: 12.75, estado: 'parcial' }),
      persona(DANI, 'Dani', { aviso: true, aviso_monto: 12.75, falta: 25.5 }),
      persona(USUARIO.id, 'Prueba', { soy_yo: true, falta: 25.5 }),
    ],
  } })
  await expect(page.locator('.pozo-collected')).toContainText('$38,25')
  await expect(page.locator('.pozo-targets')).toContainText('$25,50')
  await expect(page.locator('[data-puesto="1"]')).toContainText('$63,75')
  await expect(fila(page, 'Caro')).toContainText('$12,75')
  if (env.QUINIELA_CAPTURAS) {
    for (const width of [390, 960]) {
      await page.setViewportSize({ width, height: 900 })
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme)
        await page.locator('.pozo-sheet').screenshot({ path: `node_modules/.cache/identidad-visual/pozo-${width}-${theme}.png`, animations: 'disabled' })
      }
    }
  }
  await page.getByRole('button', { name: 'Avisar un pago' }).click()
  await page.getByRole('radio', { name: 'La mitad · $12,75' }).click()
  await page.getByRole('button', { name: 'Avisar', exact: true }).click()
  await expect.poll(() => llamadas.length).toBe(1)
  expect(llamadas[0]).toEqual({ nombre: 'avisar_abono', cuerpo: { p_league_id: LIGA, p_monto: 12.75 } })
})

test('el pozo tiene su pestaña y ya no vive en Reglas', async ({ page }) => {
  await abrir(page)
  await expect(page.getByRole('button', { name: 'Pozo' })).toBeVisible()
  await page.getByRole('button', { name: 'Reglas' }).click()
  await expect(page.getByRole('button', { name: /El pozo y los pagos tienen su pestaña/ })).toBeVisible()
  await expect(page.getByText('Pozo y pagos')).toHaveCount(0)
  // El enlace lleva de vuelta.
  await page.getByRole('button', { name: /El pozo y los pagos tienen su pestaña/ }).click()
  await expect(page.getByText('Pozo y pagos')).toBeVisible()
})

test('el grupo ve quién pagó, quién pagó una parte y quién avisó', async ({ page }) => {
  await abrir(page)
  await expect(fila(page, 'Beto').getByText('pagó', { exact: true })).toBeVisible()
  await expect(fila(page, 'Caro').getByText(/de ₡10\D?000 · falta ₡5\D?000/)).toBeVisible()
  await expect(fila(page, 'Dani').getByText(/avisó ₡5\D?000 · falta confirmar/)).toBeVisible()
  await expect(page.getByText(/1 de 4 al día · faltan ₡25\D?000/)).toBeVisible()
  // Sin ser admin no hay botones de confirmar en las filas.
  await expect(page.locator('[data-persona] button')).toHaveCount(0)
})

test('un miembro avisa que pagó la mitad', async ({ page }) => {
  const { llamadas } = await abrir(page)
  await page.getByRole('button', { name: 'Avisar un pago' }).click()
  await page.getByRole('radio', { name: /La mitad · ₡5\D?000/ }).click()
  await page.getByRole('button', { name: 'Avisar', exact: true }).click()
  await expect.poll(() => llamadas.length).toBe(1)
  expect(llamadas[0]).toEqual({ nombre: 'avisar_abono', cuerpo: { p_league_id: LIGA, p_monto: 5000 } })
})

test('un monto escrito a mano: más de lo que falta no se manda', async ({ page }) => {
  const { llamadas } = await abrir(page)
  await page.getByRole('button', { name: 'Avisar un pago' }).click()
  await page.getByRole('radio', { name: 'Otro monto' }).click()
  await page.getByRole('spinbutton', { name: 'Monto' }).fill('20000')
  await page.getByRole('button', { name: 'Avisar', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: /Falta ₡10\D?000/ })).toBeVisible()
  await page.waitForTimeout(300)
  expect(llamadas).toEqual([])

  await page.getByRole('spinbutton', { name: 'Monto' }).fill('3500')
  await page.getByRole('button', { name: 'Avisar', exact: true }).click()
  await expect.poll(() => llamadas.length).toBe(1)
  expect(llamadas[0].cuerpo).toEqual({ p_league_id: LIGA, p_monto: 3500 })
})

test('quien ya avisó ve cuánto y que falta confirmar, y puede retirarlo', async ({ page }) => {
  const { llamadas } = await abrir(page, { yo: { aviso: true, aviso_monto: 4000 } })
  await expect(page.getByText(/Avisaste ₡4\D?000 · falta que lo confirme un admin/)).toBeVisible()
  await page.getByRole('button', { name: 'Retirar aviso' }).click()
  await expect.poll(() => llamadas.length).toBe(1)
  expect(llamadas[0]).toEqual({ nombre: 'avisar_pago', cuerpo: { p_league_id: LIGA, p_avisar: false } })
})

test('un admin confirma lo que avisó alguien, con el total que vio', async ({ page }) => {
  const { llamadas } = await abrir(page, { soyAdmin: true })
  await fila(page, 'Dani').getByRole('button', { name: /confirmar ₡5\D?000/ }).click()
  await expect.poll(() => llamadas.length).toBe(1)
  expect(llamadas[0]).toEqual({
    nombre: 'confirmar_abono',
    cuerpo: { p_league_id: LIGA, p_user_id: DANI, p_monto: 5000, p_total_visto: 0, p_aviso_visto: 5000 },
  })
})

test('un admin registra el resto de quien pagó la mitad', async ({ page }) => {
  const { llamadas } = await abrir(page, { soyAdmin: true })
  await fila(page, 'Caro').getByRole('button', { name: 'registrar' }).click()
  await page.getByRole('radio', { name: /Lo que falta · ₡5\D?000/ }).click()
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await expect.poll(() => llamadas.length).toBe(1)
  expect(llamadas[0]).toEqual({
    nombre: 'confirmar_abono',
    cuerpo: { p_league_id: LIGA, p_user_id: CARO, p_monto: 5000, p_total_visto: 5000, p_aviso_visto: null },
  })
})

test('un aviso pendiente permite registrar otro monto y conserva el aviso visto para el control de concurrencia', async ({ page }) => {
  const { llamadas } = await abrir(page, { soyAdmin: true })
  await fila(page, 'Dani').getByRole('button', { name: 'gestionar' }).click()
  await page.getByRole('radio', { name: 'Otro monto' }).click()
  await page.getByRole('spinbutton', { name: 'Monto' }).fill('2500')
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await expect.poll(() => llamadas.length).toBe(1)
  expect(llamadas[0].cuerpo).toEqual({
    p_league_id: LIGA, p_user_id: DANI, p_monto: 2500, p_total_visto: 0, p_aviso_visto: 5000,
  })
})

test('si la base rechaza (otro admin ya lo confirmó), se dice por qué', async ({ page }) => {
  const mensaje = 'El pago de esta persona cambió mientras tanto (ahora tiene 5000.00 confirmado). Actualizá y volvé a intentar.'
  await abrir(page, {
    soyAdmin: true,
    rpc: { confirmar_abono: { status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'P0001', message: mensaje }) } },
  })
  await fila(page, 'Dani').getByRole('button', { name: /confirmar ₡5\D?000/ }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'cambió mientras tanto' })).toBeVisible()
})

test('un aviso retirado o cambiado se rechaza sin confirmar la cuota por otra vía', async ({ page }) => {
  const { llamadas } = await abrir(page, {
    soyAdmin: true,
    rpc: { confirmar_abono: { status: 400, contentType: 'application/json', body: JSON.stringify({
      code: 'P0001', message: 'El aviso cambió. Actualizá antes de confirmar.',
    }) } },
  })
  await fila(page, 'Dani').getByRole('button', { name: /confirmar ₡5\D?000/ }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'El aviso cambió' })).toBeVisible()
  expect(llamadas.map(x => x.nombre)).toEqual(['confirmar_abono'])
  expect(llamadas[0].cuerpo.p_aviso_visto).toBe(5000)
})

test('si falta confirmar_abono no se sustituye por confirmar_pago y el borrador queda', async ({ page }) => {
  const { llamadas } = await abrir(page, {
    soyAdmin: true,
    rpc: { confirmar_abono: { status: 404, contentType: 'application/json', body: JSON.stringify({
      code: 'PGRST202', message: 'Función no disponible.',
    }) } },
  })
  await fila(page, 'Caro').getByRole('button', { name: 'registrar' }).click()
  await page.getByRole('radio', { name: 'Otro monto' }).click()
  await page.getByRole('spinbutton', { name: 'Monto' }).fill('2500')
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Función no disponible' })).toBeVisible()
  await expect(page.getByRole('spinbutton', { name: 'Monto' })).toHaveValue('2500')
  expect(llamadas.map(x => x.nombre)).toEqual(['confirmar_abono'])
})

test('el pozo se comparte como imagen', async ({ page }) => {
  await abrir(page)
  const descarga = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Compartir', exact: true }).click()
  const d = await descarga
  expect(d.suggestedFilename()).toBe('pozo-bundestica.png')
  const bytes = readFileSync(await d.path())
  // Firma PNG: es una imagen de verdad, no un archivo vacío.
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(bytes.length).toBeGreaterThan(10000)
})

/* EL REPARTO EN MONTOS (pedido del dueño, 13 oct 2026): «no es %, sino un monto
   específico ya convenido con anterioridad». */
const premios = (page) => page.locator('[data-reparto]')

test('los premios en montos fijos se ven tal cual, sin porcentaje', async ({ page }) => {
  await abrir(page, { reparto: [{ puesto: 1, monto: 25000 }, { puesto: 2, monto: 10000 }] })
  await expect(premios(page).getByText('Premios', { exact: true })).toBeVisible()
  await expect(premios(page).locator('[data-puesto="1"]')).toHaveText(/1ºPrimer puesto₡25\D?000/)
  await expect(premios(page).locator('[data-puesto="2"]')).toHaveText(/2ºPuesto 2₡10\D?000/)
  await expect(premios(page).getByText('Montos acordados por el grupo.')).toBeVisible()
  await expect(premios(page).getByText('%')).toHaveCount(0)
  // 35 000 de un pozo completo de 40 000: no se avisa nada.
  await expect(premios(page).getByText(/pozo completo es/)).toHaveCount(0)
})

test('si los premios pasan el pozo completo, se avisa', async ({ page }) => {
  await abrir(page, { reparto: [{ puesto: 1, monto: 30000 }, { puesto: 2, monto: 20000 }] })
  await expect(premios(page).getByText(/Los premios suman ₡50\D?000 y el pozo completo es ₡40\D?000/)).toBeVisible()
})

test('los porcentajes de antes se siguen viendo como reparto estimado', async ({ page }) => {
  await abrir(page)
  await expect(premios(page).getByText('Reparto estimado')).toBeVisible()
  await expect(premios(page).locator('[data-puesto="1"]')).toHaveText(/1ºPrimer puesto65% del pozo₡26\D?000/)
})

test('un admin pasa el reparto a montos fijos y se guardan los montos', async ({ page }) => {
  const { llamadas } = await abrir(page, { soyAdmin: true })
  await page.getByTitle('Configurar').click()
  // Lo guardado está en porcentajes: el editor arranca ahí.
  await expect(page.getByRole('radio', { name: 'Porcentajes' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('radio', { name: 'Montos fijos' }).click()
  // Parte del equivalente sobre el pozo completo (40 000).
  await expect(page.getByLabel('Monto del 1º puesto')).toHaveValue('26000')
  await expect(page.getByLabel('Monto del 2º puesto')).toHaveValue('14000')
  await page.getByLabel('Monto del 1º puesto').fill('25000')
  await page.getByLabel('Monto del 2º puesto').fill('10000')
  await page.getByRole('button', { name: '+ agregar puesto' }).click()
  await page.getByLabel('Monto del 3º puesto').fill('5000')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect.poll(() => llamadas.length).toBe(1)
  expect(llamadas[0]).toEqual({
    nombre: 'set_league_pozo',
    cuerpo: {
      p_league_id: LIGA, p_cuota: 10000, p_moneda: 'CRC',
      p_reparto: [{ puesto: 1, monto: 25000 }, { puesto: 2, monto: 10000 }, { puesto: 3, monto: 5000 }],
    },
  })
})

test('un puesto vacío en el medio no se guarda', async ({ page }) => {
  const { llamadas } = await abrir(page, { soyAdmin: true, reparto: [{ puesto: 1, monto: 25000 }, { puesto: 2, monto: 10000 }] })
  await page.getByTitle('Configurar').click()
  await expect(page.getByRole('radio', { name: 'Montos fijos' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: '+ agregar puesto' }).click()
  await page.getByLabel('Monto del 3º puesto').fill('5000')
  await page.getByLabel('Monto del 2º puesto').fill('')
  await expect(page.getByRole('alert').filter({ hasText: /2º quedó sin monto/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  expect(llamadas).toEqual([])
})

test('ir y volver entre modos de reparto conserva los montos originales y ambos borradores', async ({ page }) => {
  await abrir(page, { soyAdmin: true, reparto: [{ puesto: 1, monto: 12345.67 }, { puesto: 2, monto: 10000 }] })
  await page.getByTitle('Configurar').click()
  await page.getByRole('radio', { name: 'Porcentajes' }).click()
  await page.getByLabel('Porcentaje del 1º puesto').fill('40.25')
  await page.getByRole('radio', { name: 'Montos fijos' }).click()
  await expect(page.getByLabel('Monto del 1º puesto')).toHaveValue('12345.67')
  await page.getByRole('radio', { name: 'Porcentajes' }).click()
  await expect(page.getByLabel('Porcentaje del 1º puesto')).toHaveValue('40.25')
})
