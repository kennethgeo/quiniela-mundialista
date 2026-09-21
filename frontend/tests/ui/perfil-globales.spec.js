/* La pestaña «Globales» del perfil, sobre la pantalla de verdad.

   EL FALLO: la consulta pedía las predicciones globales con `.maybeSingle()`,
   de cuando existía `UNIQUE (user_id)` y una persona solo podía tener una en
   TODA la app. Desde la migración 71 son POR QUINIELA —`UNIQUE (user_id,
   league_id)`— así que quien juega dos quinielas tiene DOS filas y
   `.maybeSingle()` devuelve un error, no una fila.

   Medido en producción el 21 sep 2026: 21 filas y **4 personas con más de una**.
   A esas cuatro el perfil les decía «Sin predicciones globales» teniéndolas
   puestas — y una de ellas vale 36 puntos entre campeón, goleador y asistidor.

   Por eso el caso base de esta prueba son DOS quinielas: con una sola,
   `.maybeSingle()` funciona y la prueba pasaría con el bug puesto. */
import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

const PERFIL = {
  id: USUARIO.id, display_name: 'Prueba', avatar_url: null, total_points: 40,
  points_adjustment: 0, is_admin: false, created_at: '2026-01-01', updated_at: '2026-01-01',
}

/* Las dos filas tal cual las devuelve PostgREST con el embed de `leagues`. */
const DOS_QUINIELAS = [
  {
    league_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    champion_team: 'Costa Rica', top_scorer_name: 'Keylor Navas',
    top_assist_name: 'Celso Borges', leagues: { name: 'Bundestica' },
  },
  {
    league_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    champion_team: 'Brasil', top_scorer_name: 'Vinícius',
    top_assist_name: null, leagues: { name: 'Champions 26-27' },
  },
]

async function abrir (page, globales) {
  await sinRedExterna(page)
  await conSesion(page)
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_seen', 'true'); localStorage.setItem('pwaPromptDismissed', 'true')
  })
  await interceptarSupabase(page, {
    // `.single()` en AuthContext: objeto, no lista.
    '/rest/v1/users': PERFIL,
    '/rest/v1/tournament_predictions': globales,
    '/rest/v1/matches': [],
    '/rest/v1/predictions': [],
    '/rest/v1/user_stats_view': null,
    'rpc/my_groups': [],
    'rpc/my_medals': [],
  })
  await page.goto('/profile')
  await page.getByRole('button', { name: 'Globales' }).click()
}

test('se ven las globales de TODAS las quinielas, no una sola', async ({ page }) => {
  await abrir(page, DOS_QUINIELAS)
  await expect(page.getByText('Bundestica')).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('Champions 26-27')).toBeVisible()
  await expect(page.getByText('Costa Rica')).toBeVisible()
  await expect(page.getByText('Brasil')).toBeVisible()
  // EL SÍNTOMA que veían esas cuatro personas.
  await expect(page.getByText(/Sin predicciones globales/)).toHaveCount(0)
})

test('el asistidor también se ve: son 12 puntos que no aparecían', async ({ page }) => {
  /* La tarjeta vieja solo dibujaba campeón y goleador. El asistidor existe
     desde la migración 62 y vale lo mismo que los otros dos. */
  await abrir(page, DOS_QUINIELAS)
  await expect(page.getByText('Celso Borges')).toBeVisible({ timeout: 15000 })
})

test('lo que no elegiste se dice, no se esconde', async ({ page }) => {
  await abrir(page, DOS_QUINIELAS)
  await expect(page.getByText('Vinícius')).toBeVisible({ timeout: 15000 })
  // La segunda quiniela no tiene asistidor: tiene que decirlo.
  await expect(page.getByText('No seleccionado').first()).toBeVisible()
})

test('sin ninguna global, la pantalla dice dónde se eligen', async ({ page }) => {
  /* Antes el botón «Hacer Predicciones» abría un editor que ya no podía
     guardar: hacía upsert con `onConflict: 'user_id'` —restricción que la 71
     eliminó— y sin `league_id`. Un botón que promete y revienta es peor que
     no tenerlo; ahora se dice dónde se hace de verdad. */
  await abrir(page, [])
  await expect(page.getByText(/Sin predicciones globales/)).toBeVisible({ timeout: 15000 })
  await expect(page.getByText(/se eligen dentro de cada quiniela/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /Hacer Predicciones/i })).toHaveCount(0)
})
