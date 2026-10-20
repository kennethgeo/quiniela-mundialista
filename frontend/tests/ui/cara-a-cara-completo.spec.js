/* Cara a cara: lee COMPLETAS las predicciones de las dos personas.

   Leía la quiniela entera en una sola consulta sin paginar. PostgREST corta en
   1.000 filas y Bundestica llegó a 980 el 19 oct 2026: al pasar el tope el
   resumen se habría calculado con un prefijo arbitrario, sin aviso. El doble
   de abajo hace lo mismo que el servidor real: sin conteo devuelve como mucho
   1.000 filas; con conteo, páginas de 200. Así la prueba cae con la consulta
   vieja. Y quien no juega la quiniela (el admin global) no tiene «yo»: antes
   reventaba al abrirlo. */
import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, respuestaFilas, sinRedExterna, USUARIO } from './apoyo.js'

const LIGA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaacc'
const RIVAL = '00000000-0000-4000-8000-0000000000c3'
const PARTIDOS = Array.from({ length: 600 }, (_, i) => ({
  id: 7000 + i, tournament_id: 9, phase: 'groups', matchday: Math.floor(i / 100) + 1, stage: null,
  home_team: `Local ${i}`, away_team: `Visita ${i}`, kickoff_at: `2026-08-${String(1 + (i % 28)).padStart(2, '0')}T01:00:00Z`,
  status: 'finished', home_goals_actual: 2, away_goals_actual: 1, events_json: [],
}))
// Yo acierto el marcador (3) en los 600; el rival, solo el ganador (1).
const PREDICCIONES = PARTIDOS.flatMap((m) => [
  { id: `a-${m.id}`, user_id: USUARIO.id, match_id: m.id, home_goals_pred: 2, away_goals_pred: 1, use_powerup_x2: false, points_earned: 3 },
  { id: `b-${m.id}`, user_id: RIVAL, match_id: m.id, home_goals_pred: 1, away_goals_pred: 0, use_powerup_x2: false, points_earned: 1 },
])

async function abrir (page, { soyMiembro = true, fallarPagina = () => false } = {}) {
  const errores = []
  page.on('pageerror', (e) => errores.push(e.message))
  await sinRedExterna(page)
  await conSesion(page)
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_seen', 'true'); localStorage.setItem('pwaPromptDismissed', 'true')
  })
  const grupo = { id: LIGA, name: 'Duelo', tournament_id: 9, rules_accepted: true, is_admin: !soyMiembro,
    powerup_limit: 2, members: 2, my_rank: 1, tournament_kind: 'league', tournament_status: 'active' }
  await interceptarSupabase(page, {
    '/rest/v1/users': { id: USUARIO.id, display_name: 'Prueba', total_points: 0, is_admin: !soyMiembro },
    'rpc/my_groups': soyMiembro ? [grupo] : [],
    'rpc/quiniela_por_id': [grupo],
    'rpc/group_standings': [
      ...(soyMiembro ? [{ user_id: USUARIO.id, display_name: 'Prueba', points: 1800, is_me: true }] : []),
      { user_id: RIVAL, display_name: 'Rival', points: 600, is_me: false },
    ],
    'rpc/perfil_en_quiniela': { display_name: 'Rival', soy_yo: false, puntos: 600, miembros: 2, pos: 2,
      jugadas: 600, exactos: 0, aciertos: 600, error_goles: 600, x2_usados: 0, jornadas_ganadas: 0 },
    '/rest/v1/matches': PARTIDOS,
  })
  const lecturas = []
  await page.route('**://pruebas.supabase.co/rest/v1/predictions**', (route) => {
    const req = route.request()
    const params = new URL(req.url()).searchParams
    if (!req.headers().prefer?.includes('count=exact')) {
      // Lo que hace PostgREST sin paginar: corta en 1.000, sin avisar.
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PREDICCIONES.slice(0, 1000)) })
    }
    const desde = Number(params.get('offset') || 0)
    lecturas.push(desde)
    if (fallarPagina(desde)) {
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"intermedia caída"}' })
    }
    return route.fulfill(respuestaFilas(req, PREDICCIONES, { limiteServidor: 200 }))
  })
  await page.goto(`/q/${LIGA}?tab=standings`)
  await page.getByRole('button', { name: 'Tabla', exact: true }).click()
  await page.getByTitle('Ver a Rival en esta quiniela').click()
  return { errores, lecturas }
}

const dialogo = (page) => page.getByRole('heading', { name: 'Cara a cara', exact: true }).locator('xpath=ancestor::div[contains(@class,"max-w-md")][1]')

test('con 1.200 predicciones el cara a cara suma TODAS, pidiendo páginas', async ({ page }) => {
  const { errores, lecturas } = await abrir(page)
  await page.getByRole('button', { name: 'Cara a cara contra vos' }).click()
  // 600 × 3 = 1800 contra 600 × 1. Con el corte de 1.000 filas daban 1500 y 500.
  await expect(dialogo(page)).toContainText('1800')
  await expect(dialogo(page)).toContainText('600')
  await expect(dialogo(page)).not.toContainText('1500')
  expect([...new Set(lecturas)]).toEqual([0, 200, 400, 600, 800, 1000])
  expect(errores).toEqual([])
})

test('si una página intermedia falla, se dice y se puede reintentar; no se muestra un resumen a medias', async ({ page }) => {
  let fallar = true
  await abrir(page, { fallarPagina: (desde) => fallar && desde === 400 })
  await page.getByRole('button', { name: 'Cara a cara contra vos' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'No pudimos cargar el cara a cara' })).toBeVisible()
  // Ninguna cifra que parezca resultado: ni 1800, ni un parcial de 600/200, ni
  // el 0-0 que la cabecera pintaba durante la carga o el error (revisión de
  // Codex). Los nombres y el error no llevan dígitos, así que basta mirar eso.
  await expect(dialogo(page)).not.toContainText(/\d/)
  await expect(page.getByTestId('duelos-jornadas')).toHaveCount(0)
  fallar = false
  await page.getByRole('button', { name: 'Reintentar' }).click()
  await expect(dialogo(page)).toContainText('1800')
})

test('el admin global que no juega la quiniela no tiene cara a cara, y nada revienta', async ({ page }) => {
  const { errores } = await abrir(page, { soyMiembro: false })
  // Ancla: el perfil del rival ya está abierto (su nombre en el diálogo).
  await expect(page.getByRole('heading', { name: 'Rival' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cara a cara contra vos' })).toHaveCount(0)
  expect(errores).toEqual([])
})
