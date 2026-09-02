/* Que cada camino lleve a donde debe.

   Una regresión de navegación no falla: simplemente te deja en otro lado. Por
   eso lo que se afirma acá es SIEMPRE la URL final, no que algo se vea. */
import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

test.beforeEach(async ({ page }) => {
  await sinRedExterna(page)
  await interceptarSupabase(page)
})

const ruta = (page) => new URL(page.url()).pathname

test.describe('sin sesión', () => {
  test('una pantalla protegida manda a /auth', async ({ page }) => {
    await page.goto('/q/123')
    await expect.poll(() => ruta(page)).toBe('/auth')
  })

  test('la raíz manda a /auth', async ({ page }) => {
    await page.goto('/')
    await expect.poll(() => ruta(page)).toBe('/auth')
  })

  test('una ruta que no existe cae en la raíz, no en una pantalla en blanco', async ({ page }) => {
    await page.goto('/esta-ruta-no-existe')
    // Sin sesión termina en /auth, pero lo que importa es que NO se quede
    // colgada en la ruta inventada.
    await expect.poll(() => ruta(page)).not.toBe('/esta-ruta-no-existe')
  })

  test('/unirse guarda el código y manda a /auth', async ({ page }) => {
    await page.goto('/unirse/abc123')
    await expect.poll(() => ruta(page)).toBe('/auth')
    // Lo que hace que el enlace sirva: el código sobrevive al registro.
    const guardado = await page.evaluate(() => localStorage.getItem('tico:invitacion'))
    expect(guardado).toBe('ABC123')
  })

  test('/unirse normaliza el código a mayúsculas', async ({ page }) => {
    await page.goto('/unirse/aB-c1 2')
    await expect.poll(async () => page.evaluate(() => localStorage.getItem('tico:invitacion'))).toBe('ABC12')
  })

  test('la pantalla de login se ve y no queda en blanco', async ({ page }) => {
    await page.goto('/auth')
    await expect(page.getByPlaceholder(/correo/i)).toBeVisible()
    await expect(page.getByPlaceholder(/contraseña/i)).toBeVisible()
  })

  test('se puede ir a registrarse y volver', async ({ page }) => {
    await page.goto('/auth')
    await page.getByRole('button', { name: /registrate/i }).click()
    await expect(page.getByRole('button', { name: /crear cuenta/i })).toBeVisible()
    await page.getByRole('button', { name: /iniciá sesión|inicia sesión|entrar/i }).first().click()
    await expect(page.getByRole('button', { name: /^entrar$/i })).toBeVisible()
  })

  test('se puede ir a recuperar la contraseña', async ({ page }) => {
    await page.goto('/auth')
    await page.getByRole('button', { name: /olvidaste tu contraseña/i }).click()
    await expect(page.getByRole('button', { name: /enviar enlace/i })).toBeVisible()
  })
})

test.describe('con sesión', () => {
  test.beforeEach(async ({ page }) => {
    await conSesion(page)
    await interceptarSupabase(page, {
      // AuthContext pide el perfil; sin esto la app se queda cargando.
      '/rest/v1/users': [{
        id: USUARIO.id, display_name: 'Prueba', avatar_url: null,
        total_points: 0, points_adjustment: 0, is_admin: false,
        created_at: '2026-01-01', updated_at: '2026-01-01',
      }],
      '/rest/v1/rpc/my_groups': [],
    })
  })

  test('la raíz ya no manda a /auth', async ({ page }) => {
    await page.goto('/')
    // Se le da margen a que AuthContext resuelva la sesión.
    await page.waitForTimeout(1500)
    expect(ruta(page)).toBe('/')
  })

  test('/auth con sesión rebota a la raíz', async ({ page }) => {
    await page.goto('/auth')
    await expect.poll(() => ruta(page), { timeout: 8000 }).toBe('/')
  })

  test('/dashboard redirige a la raíz', async ({ page }) => {
    await page.goto('/dashboard')
    await expect.poll(() => ruta(page), { timeout: 8000 }).toBe('/')
  })

  test('las rutas viejas del Mundial redirigen a la raíz', async ({ page }) => {
    for (const vieja of ['/matches', '/leaderboard', '/bracket', '/torneo']) {
      await page.goto(vieja)
      await expect.poll(() => ruta(page), { timeout: 8000 }).toBe('/')
    }
  })
})

test.describe('la pestaña sobrevive al ir y volver', () => {
  const LIGA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

  test.beforeEach(async ({ page }) => {
    await conSesion(page)
    const grupo = {
      id: LIGA, name: 'Bundestica', tournament_id: 6, invitation_code: 'ABC123',
      powerup_limit: 2, points_exact: 3, points_correct: 1,
      champion_points: 12, scorer_points: 12, assist_points: 12,
      is_admin: true, rules_accepted: true, rules: null, members_count: 1,
      tournament_kind: 'league', tournament_status: 'active',
    }
    // Dos jornadas, para que la fila de chips exista (solo aparece con >1).
    const partidos = [1, 2].flatMap((jor) => [1, 2].map((n) => ({
      id: `${jor}${n}`.padStart(8, '0') + '-0000-4000-8000-000000000000',
      tournament_id: 6, phase: 'groups', matchday: jor, stage: `Jornada ${jor}`,
      home_team: `Local ${jor}${n}`, away_team: `Visita ${jor}${n}`,
      home_team_code: 'xx', away_team_code: 'xx', status: 'pending',
      kickoff_at: `2026-1${jor}-0${n}T20:00:00Z`,
      home_goals_actual: null, away_goals_actual: null, events_json: [],
    })))
    await interceptarSupabase(page, {
      '/rest/v1/users': [{
        id: USUARIO.id, display_name: 'Prueba', avatar_url: null,
        total_points: 0, points_adjustment: 0, is_admin: false,
        created_at: '2026-01-01', updated_at: '2026-01-01',
      }],
      'rpc/my_groups': [grupo],
      'rpc/quiniela_por_id': grupo,
      '/rest/v1/matches': partidos,
      '/rest/v1/predictions': [],
      'rpc/cupos_por_jornada': [],
    })
  })

  /* Se afirma sobre LO QUE SE VE, no sobre la URL: la URL conserva los
     parámetros aunque la app los ignore, así que una prueba que solo mire
     query params pasa igual con el bug puesto. Comprobado. */
  test('entrar con ?tab=matches abre Partidos, no Resumen', async ({ page }) => {
    await page.goto(`/q/${LIGA}?tab=matches`)
    // Los chips de jornada solo existen en la pestaña Partidos.
    await expect(page.getByRole('button', { name: 'Todas' })).toBeVisible({ timeout: 10000 })
  })

  test('volver atrás desde un partido devuelve a Partidos, no a Resumen', async ({ page }) => {
    await page.goto(`/q/${LIGA}?tab=matches&j=Jornada+2`)
    await expect(page.getByRole('button', { name: 'Todas' })).toBeVisible({ timeout: 10000 })

    await page.goto('/match/00000011-0000-4000-8000-000000000000')
    await page.waitForTimeout(500)
    await page.goBack()

    // Si la pestaña viviera en useState, acá se vería «Resumen» y los chips
    // no existirían.
    await expect(page.getByRole('button', { name: 'Todas' })).toBeVisible({ timeout: 10000 })
    expect(new URL(page.url()).searchParams.get('j')).toBe('Jornada 2')
  })
})
