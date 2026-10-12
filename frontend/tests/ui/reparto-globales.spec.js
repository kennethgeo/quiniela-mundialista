/* Repartir campeón, goleador y asistidor desde el panel global (vigésima
   auditoría, ítem 1.4).

   Lo que fija esta prueba, cada cosa porque ya costó (o iba a costar) puntos:
   - el campeón real se ELIGE de la lista de equipos del torneo: escrito a mano,
     «LD Alajuelense» dejaba a todos en 0 sin ningún error;
   - antes de repartir se ve quién acierta, pick por pick;
   - se reparte en UNA quiniela, que hay que elegir: la liga tica corre
     temporada tras temporada sobre el mismo torneo;
   - si el admin cambia un nombre, la vista previa deja de valer y no se puede
     repartir hasta volver a mirarla.

   La respuesta de la vista previa (`datos/globales_vista_previa.json`) la
   generó el backend DE VERDAD con las 15 globales reales de Bundestica, y
   `test_reparto_globales.py` exige que siga siendo idéntica a lo que el
   backend devuelve hoy: el doble no inventa la forma ni los números. */
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

// Trae DOS quinielas sobre el mismo torneo (Bundestica y la temporada
// siguiente): con dos, el panel no puede elegir por su cuenta.
const VISTA = JSON.parse(readFileSync(new URL('./datos/globales_vista_previa.json', import.meta.url), 'utf8'))
const BUNDESTICA = VISTA.ligas.find((l) => l.nombre === 'Bundestica').league_id

async function abrirPanel (page) {
  await sinRedExterna(page)
  await conSesion(page)
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_seen', 'true'); localStorage.setItem('pwaPromptDismissed', 'true')
  })
  await interceptarSupabase(page, {
    '/rest/v1/users': { id: USUARIO.id, display_name: 'Admin', avatar_url: null, is_admin: true },
    '/rest/v1/tournaments': [{
      id: 2, name: 'Primera División de Costa Rica', ...VISTA.reales,
      predictions_locked: true, predictions_force_open: false,
    }],
    '/rest/v1/rpc/my_groups': [],
  })

  const llamadas = []
  // Imita al backend: sin quiniela no se reparte (400), y con `dry_run` no
  // se escribe nada.
  await page.route('**/_backend/api/admin/**', async (route) => {
    const ruta = new URL(route.request().url()).pathname.split('/').pop()
    const cuerpo = JSON.parse(route.request().postData() || '{}')
    llamadas.push({ ruta, cuerpo })
    const responder = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (ruta === 'set-tournament-globals') return responder(200, { status: 'ok' })
    if (ruta === 'calc-tournament-globals') {
      if (cuerpo.dry_run) return responder(200, VISTA)
      if (!cuerpo.league_id) return responder(400, { detail: 'Elegí la quiniela en la que se reparte' })
      return responder(200, { status: 'ok', updated: 11, users: 11, liga: VISTA.ligas[0] })
    }
    return responder(404, { detail: 'no simulado' })
  })

  await page.goto('/admin')
  await expect(page.getByText('Campeón / Goleador / Asistidor por torneo')).toBeVisible({ timeout: 10000 })
  return llamadas
}

const repartos = (llamadas) => llamadas.filter((l) => l.ruta === 'calc-tournament-globals' && !l.cuerpo.dry_run)

test('el campeón real se elige de los equipos del torneo, no se escribe', async ({ page }) => {
  await abrirPanel(page)
  const campeon = page.getByLabel('Campeón real')
  await expect(campeon.locator('option', { hasText: 'Alajuelense' })).toHaveCount(1)
  // Es un selector: un campo de texto libre aceptaría «LD Alajuelense».
  await expect(campeon).toHaveJSProperty('tagName', 'SELECT')
  await expect(campeon.locator('option')).toHaveCount(VISTA.equipos.length + 1)
  await expect(campeon).toHaveValue('Saprissa')
})

test('muestra quién acierta en la quiniela elegida antes de repartir', async ({ page }) => {
  const llamadas = await abrirPanel(page)
  const repartir = page.getByRole('button', { name: /Repartir/ })
  // Con dos quinielas en el torneo no se elige sola: hay que decir cuál.
  await expect(page.getByLabel('Quiniela donde se reparte')).toHaveValue('')
  await expect(repartir).toBeDisabled()

  await page.getByLabel('Quiniela donde se reparte').selectOption({ label: 'Bundestica' })
  const vista = page.getByTestId('vista-previa')
  await expect(vista.locator('[data-categoria="Campeón"]')).toContainText('7 de 15 aciertan')
  // El goleador real es un homónimo de apellido: nadie acierta, y se avisa.
  const goleador = vista.locator('[data-categoria="Goleador"]')
  await expect(goleador).toContainText('0 de 15 aciertan')
  await expect(goleador).toContainText('Nadie acierta')
  await expect(goleador.locator('li', { hasText: 'Marcel Hernández' }).getByLabel('no acierta')).toBeVisible()
  await expect(vista.locator('[data-categoria="Asistidor"]').locator('li', { hasText: 'Elías Aguilar' }).getByLabel('acierta', { exact: true })).toBeVisible()
  await expect(repartir).toBeEnabled()
  expect(repartos(llamadas)).toEqual([])
})

test('repartir pide confirmación y manda la quiniela y lo que se vio', async ({ page }) => {
  const llamadas = await abrirPanel(page)
  await page.getByLabel('Quiniela donde se reparte').selectOption({ label: 'Bundestica' })
  const repartir = page.getByRole('button', { name: 'Repartir en «Bundestica»' })
  await expect(repartir).toBeEnabled()

  // Cancelar no manda nada.
  let texto = ''
  page.once('dialog', (d) => { texto = d.message(); d.dismiss() })
  await repartir.click()
  await expect.poll(() => texto).toContain('«Bundestica»')
  expect(texto).toContain('Campeón: 7 de 15 aciertan')
  expect(repartos(llamadas)).toEqual([])

  page.once('dialog', (d) => d.accept())
  await repartir.click()
  await expect(page.getByRole('status')).toContainText('Puntos repartidos en «Bundestica»')
  const [reparto] = repartos(llamadas)
  expect(reparto.cuerpo.league_id).toBe(BUNDESTICA)
  expect(reparto.cuerpo.tournament_id).toBe(2)
  expect(reparto.cuerpo.esperado).toEqual(VISTA.reales)
})

test('si se cambia un nombre, no se reparte hasta volver a mirar', async ({ page }) => {
  const llamadas = await abrirPanel(page)
  await page.getByLabel('Quiniela donde se reparte').selectOption({ label: 'Bundestica' })
  const repartir = page.getByRole('button', { name: /Repartir/ })
  await expect(repartir).toBeEnabled()

  await page.getByLabel('Goleador real').fill('Marcel Hernández')
  await expect(page.getByText('Cambiaste los reales')).toBeVisible()
  await expect(page.getByTestId('vista-previa')).toHaveCount(0)
  await expect(repartir).toBeDisabled()
  expect(repartos(llamadas)).toEqual([])
})
