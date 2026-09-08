/* El panel de detalle del partido.

   Lo que importa comprobar acá no es que «se vea bonito», sino que muestre lo
   que HAY y no invente lo que no: ESPN publica la alineación cerca de una hora
   antes del saque, así que antes de eso el panel tiene que sostenerse solo con
   la forma reciente, sin tarjetas vacías ni un once fantasma.

   Las respuestas son las que devuelve el recorte del backend sobre respuestas
   REALES de ESPN (Champions, 8 sep 2026). */
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

/* Los fixtures van EN EL REPO, no en una carpeta temporal: si no, la prueba
   pasa acá y CI no encuentra el archivo. */
const DATOS = resolve(dirname(fileURLToPath(import.meta.url)), 'datos')
const leer = (n) => JSON.parse(readFileSync(resolve(DATOS, n), 'utf8'))
const EN_VIVO = leer('detalle_en_vivo.json')
const PREVIA = leer('detalle_previa.json')
const MATCH = '00000001-0000-4000-8000-000000000000'

async function abrir (page, respuesta, status = 'in_progress') {
  await sinRedExterna(page)
  await conSesion(page)
  await page.addInitScript(() => {
    localStorage.setItem('tutorial_seen', 'true'); localStorage.setItem('pwaPromptDismissed', 'true')
  })
  /* DESPUÉS de sinRedExterna a propósito: en Playwright la ÚLTIMA ruta
     registrada atiende primero, así que registrarla antes la dejaría tapada
     por el atrapa-todo. */
  await page.route('**/_backend/api/matches/*/detalle', (r) => r.fulfill({
    status: typeof respuesta === 'number' ? respuesta : 200,
    contentType: 'application/json',
    body: JSON.stringify(typeof respuesta === 'number' ? { detail: 'boom' } : respuesta),
  }))
  await interceptarSupabase(page, {
    '/rest/v1/users': [{ id: USUARIO.id, display_name: 'K', avatar_url: null, total_points: 0,
      points_adjustment: 0, is_admin: false, created_at: '2026-01-01', updated_at: '2026-01-01' }],
    // `.single()` espera un objeto, no un arreglo.
    '/rest/v1/matches': { id: MATCH, tournament_id: 6, phase: 'groups', stage: 'Jornada 1',
      group_name: null, home_team: 'AEK Athens', away_team: 'LASK Linz',
      home_team_code: 'xx', away_team_code: 'xx', home_goals_actual: 1, away_goals_actual: 0,
      status, kickoff_at: '2026-09-08T16:45:00Z', events_json: [] },
    '/rest/v1/predictions': [],
    'rpc/my_groups': [],
  })
  await page.goto(`/match/${MATCH}`)
}

test('con el partido en curso muestra alineaciones y estadísticas', async ({ page }) => {
  await abrir(page, EN_VIVO)
  await expect(page.getByRole('heading', { name: 'Alineaciones' })).toBeVisible({ timeout: 15000 })
  // Formación y once, no un plantel entero.
  await expect(page.getByText('4-4-2')).toBeVisible()
  await expect(page.getByText('Alberto Brignoli')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Estadísticas' })).toBeVisible()
  await expect(page.getByText('Posesión')).toBeVisible()
})

test('los suplentes vienen plegados y se pueden abrir', async ({ page }) => {
  await abrir(page, EN_VIVO)
  const boton = page.getByRole('button', { name: /Suplentes \(10\)/ })
  await expect(boton).toBeVisible({ timeout: 15000 })
  await expect(boton).toHaveAttribute('aria-expanded', 'false')
  await boton.click()
  await expect(boton).toHaveAttribute('aria-expanded', 'true')
})

test('ANTES del partido no inventa una alineación, pero sí muestra la forma', async ({ page }) => {
  /* Es el caso que hace útil el panel: hasta ~1 h antes ESPN no publica el
     once, y lo que queda —cómo viene cada equipo— es justo lo que ayuda a
     decidir la predicción. */
  await abrir(page, PREVIA, 'pending')
  await expect(page.getByRole('heading', { name: 'Cómo vienen' })).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole('heading', { name: 'Alineaciones' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Estadísticas' })).toHaveCount(0)
})

test('si el detalle falla lo DICE, no deja un hueco', async ({ page }) => {
  /* Un hueco se lee igual que «este partido no tiene datos». Un fallo de red o
     de permisos tiene que verse. */
  await abrir(page, 503)
  await expect(page.getByText(/No se pudo traer el detalle/)).toBeVisible({ timeout: 15000 })
})

test('un torneo sin datos de ESPN lo explica', async ({ page }) => {
  // El Mundial usa su propio sync y no guarda el id de ESPN.
  await abrir(page, { disponible: false, motivo: 'Este torneo no trae datos de ESPN.' })
  await expect(page.getByText('Este torneo no trae datos de ESPN.')).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole('heading', { name: 'Cómo vienen' })).toHaveCount(0)
})
