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
  // Formación y once sobre la cancha, no un plantel entero.
  await expect(page.getByText('4-4-2')).toBeVisible()
  await expect(page.getByRole('tab', { name: 'AEK Athens' })).toBeVisible()
  await expect(page.getByText('Brignoli')).toBeVisible()
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
  // La tarjeta SÍ está, pero explicando que aún no salieron: que falte se lee
  // como «esta app no tiene alineaciones».
  await expect(page.getByText(/Todavía no se publicaron/)).toBeVisible()
  await expect(page.getByRole('tab')).toHaveCount(0)
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

test('la cancha muestra los 11 y se cambia de equipo por pestaña', async ({ page }) => {
  await abrir(page, EN_VIVO)
  await expect(page.getByRole('tab', { name: 'AEK Athens' })).toBeVisible({ timeout: 15000 })

  await expect(page.getByText('Brignoli')).toBeVisible()
  await expect(page.getByText('4-4-2')).toBeVisible()

  await page.getByRole('tab', { name: 'LASK Linz' }).click()
  await expect(page.getByText('3-1-4-2')).toBeVisible()
  await expect(page.getByText('Jungwirth')).toBeVisible()
})

test('el historial muestra el MARCADOR, no solo la fecha', async ({ page }) => {
  /* La primera versión leía campos que `seasonseries` no trae, así que salía
     la fecha y un punto suelto.

     ESTA PRUEBA ERA HUECA EN SU PRIMERA MITAD, y por eso nadie vio que el
     balance salía en inglés en producción: afirmaba `/RMA lidera/`, que es el
     `summary` de ESPN, y este fixture se capturó CUANDO TODAVÍA SE PEDÍA
     `lang=es`. Al quitar ese parámetro —sin él ESPN no devuelve la alineación—
     la misma respuesta pasó a traer «RMA leads series 5-0», pero el fixture
     guardado siguió diciéndolo en español y la prueba siguió en verde. Mismo
     tropiezo ya anotado para `espn_summary_por_jugar.json`: un fixture
     capturado a través del bug no prueba nada.

     Ahora el balance lo cuenta el backend sobre los partidos que se muestran,
     así que no depende del idioma de la fuente y no puede contradecir a la
     lista de abajo. */
  await abrir(page, PREVIA, 'pending')
  await expect(page.getByRole('heading', { name: 'Entre ellos' })).toBeVisible({ timeout: 15000 })
  await expect(page.getByText(/De estos 5: MAD 5 · INT 0/)).toBeVisible()
  // Alguna fila con dos equipos y sus goles.
  await expect(page.locator('li').filter({ hasText: /\d{4}-\d{2}-\d{2}/ }).first()).toContainText(/\d/)
})

/* Sin historial la tarjeta DESAPARECÍA, y una tarjeta que falta se lee como
   «esta app perdió el historial» — el mismo malentendido que ya se resolvió
   con las alineaciones. Lo reportó el dueño en Fenerbahçe–AS Roma: comprobado
   contra ESPN, ahí `seasonseries` viene AUSENTE del JSON porque no hay cruces
   previos, así que no había nada que mostrar y la sección se esfumaba. */
test('sin enfrentamientos previos se DICE, no se esconde la tarjeta', async ({ page }) => {
  const sinHistorial = { ...PREVIA, detalle: { ...PREVIA.detalle, historial: null } }
  await abrir(page, sinHistorial, 'pending')

  await expect(page.getByRole('heading', { name: 'Entre ellos' })).toBeVisible({ timeout: 15000 })
  await expect(page.getByText(/No hay enfrentamientos previos registrados/)).toBeVisible()
})

/* Y con historial NO puede salir el cartel de «no hay»: sería decir dos cosas
   contrarias en la misma tarjeta. */
test('con historial no aparece el cartel de vacío', async ({ page }) => {
  await abrir(page, PREVIA, 'pending')
  await expect(page.getByRole('heading', { name: 'Entre ellos' })).toBeVisible({ timeout: 15000 })
  await expect(page.getByText(/No hay enfrentamientos previos registrados/)).toHaveCount(0)
})

/* LA LIGA TICA: la fuente (la API de la UNAFUT) publica el once AL ARRANCAR
   el partido — medido el 13 sep 2026: vacío a 25 minutos del saque, los 22
   titulares a un minuto de empezado. Decir «en cuanto salgan aparecen acá»
   deja a alguien recargando hasta el saque por algo que no va a llegar a
   tiempo: las predicciones cierran 15 minutos antes. */
test('si el once sale al pitazo, se dice eso y no «en una hora»', async ({ page }) => {
  const alSaque = {
    ...PREVIA,
    detalle: { ...PREVIA.detalle, alineaciones: null, alineaciones_cuando: 'al-saque' },
  }
  await abrir(page, alSaque, 'pending')
  await expect(page.getByRole('heading', { name: 'Cómo vienen' })).toBeVisible({ timeout: 15000 })
  await expect(page.getByText(/se publican al arrancar el partido/i)).toBeVisible()
  await expect(page.getByText(/alrededor de una hora antes/)).toHaveCount(0)
})

/* La otra mitad: una liga normal —o una respuesta guardada antes de que el
   campo existiera— no recibe ninguna afirmación nueva. Un hueco no se
   convierte en una promesa distinta. */
test('sin el campo se sigue diciendo lo de siempre', async ({ page }) => {
  const viejo = { ...PREVIA, detalle: { ...PREVIA.detalle, alineaciones: null } }
  delete viejo.detalle.alineaciones_cuando
  await abrir(page, viejo, 'pending')
  await expect(page.getByText(/alrededor de una hora antes/)).toBeVisible({ timeout: 15000 })
})

/* LAS LÍNEAS DE LA CANCHA. La UNAFUT no declara formación, pero sí la
   posición de cada jugador; sin usarlas, la cancha caía al 4-4-2 de respaldo y
   dibujaba cuatro defensas donde hay cinco — una cancha que contradice a sus
   propios jugadores. */
test('la cancha respeta las líneas que manda la fuente', async ({ page }) => {
  const once = Array.from({ length: 11 }, (_, i) => ({
    nombre: `Jugador ${i + 1}`, corto: `Ape${i + 1}`, dorsal: String(i + 1),
    posicion: 'DEF', entro: false, salio: false,
  }))
  const conLineas = {
    ...PREVIA,
    detalle: {
      ...PREVIA.detalle,
      alineaciones: [{
        equipo: 'Pérez Zeledón', escudo: null, esLocal: true, formacion: null,
        lineas: [1, 5, 3, 2], titulares: once, suplentes: [],
      }],
    },
  }
  await abrir(page, conLineas, 'finished')
  await expect(page.getByRole('heading', { name: 'Alineaciones' })).toBeVisible({ timeout: 15000 })

  /* Se afirma sobre lo que se VE: los once repartidos en cuatro líneas de
     1-5-3-2. Con el respaldo 4-4-2 saldrían 1-4-4-2 y la tercera línea
     tendría cuatro. */
  const filas = page.locator('[data-linea]')
  await expect(filas).toHaveCount(4)
  await expect(filas.nth(1)).toHaveAttribute('data-linea', '5')
  await expect(filas.nth(2)).toHaveAttribute('data-linea', '3')
})

/* El apellido de la ficha viene de la fuente cuando lo manda: con los dos
   apellidos juntos («Segura Cruz»), quedarse con el último daría «Cruz». */
test('la ficha usa el apellido corto que manda el backend', async ({ page }) => {
  const uno = {
    ...PREVIA,
    detalle: {
      ...PREVIA.detalle,
      alineaciones: [{
        equipo: 'Pérez Zeledón', escudo: null, esLocal: true, formacion: null, lineas: null,
        titulares: [{ nombre: 'Bryan Andres Segura Cruz', corto: 'Segura', dorsal: '1', posicion: 'POR' }],
        suplentes: [],
      }],
    },
  }
  await abrir(page, uno, 'finished')
  await expect(page.getByText('Segura')).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('Cruz', { exact: true })).toHaveCount(0)
})

/* ─────────────────────────────────────────────────────────────────────────
   «CÓMO VIENEN»: EL MARCADOR SALÍA AL REVÉS, Y NO SE SABÍA DE QUÉ PARTIDO ERA

   Dos fallos distintos en la misma tarjeta, los dos reportados por el dueño
   («es confusa e incluso creo que está fallando»):

   1. DATO. `score` de ESPN es del GANADOR, no del equipo. San Carlos perdió
      1-2 con Puntarenas y ese evento trae `score: "2-1"`; la pantalla lo
      pintaba crudo al lado de una P, o sea dado vuelta justo en las derrotas.
   2. FORMA. Las cinco letras iban a la derecha del nombre y los cinco
      marcadores en una línea suelta debajo, así que para saber contra quién
      fue la P había que contar posiciones en dos sitios.

   El fixture es la respuesta REAL de ESPN (AD San Carlos–Cartaginés, crc.1,
   20 sep 2026) pasada por el recorte del backend. Se afirma sobre lo que se
   VE y sobre lo que está DENTRO de la misma columna: comprobar el texto
   suelto pasaría igual con las dos filas separadas de antes.
   ───────────────────────────────────────────────────────────────────────── */
const FORMA = leer('detalle_forma.json')

/* Las columnas de la forma, pedidas por lo que significan. Un localizador por
   posición o por clase pasaría igual con la maqueta vieja de dos filas. */
const columnas = (page) => page.locator('[aria-label*="contra"]')

test('el marcador de una derrota va con los goles propios primero', async ({ page }) => {
  await abrir(page, FORMA, 'pending')
  await expect(page.getByRole('heading', { name: 'Cómo vienen' })).toBeVisible({ timeout: 15000 })

  // La columna de la derrota, pedida por lo que significa y no por posición.
  const derrota = page.locator('[aria-label*="Perdió"]').first()
  await expect(derrota).toBeVisible()
  await expect(derrota).toContainText('1-2')
  await expect(derrota).toContainText('PUN')

  // EL FALLO: «2-1» es el marcador dado vuelta que mandaba ESPN. Ninguna
  // columna puede mostrarlo.
  await expect(columnas(page).filter({ hasText: '2-1' })).toHaveCount(0)
})

test('el resultado, el marcador y el rival van en la misma columna', async ({ page }) => {
  await abrir(page, FORMA, 'pending')
  const derrota = page.locator('[aria-label*="Perdió"]').first()
  await expect(derrota).toBeVisible({ timeout: 15000 })
  // Los tres dentro del MISMO elemento: es lo que la versión anterior no podía
  // cumplir, porque las letras y los marcadores vivían en filas distintas.
  await expect(derrota).toContainText('P')
  await expect(derrota).toContainText('1-2')
  await expect(derrota).toContainText('PUN')
})

test('dice si el equipo jugó de local o de visita', async ({ page }) => {
  await abrir(page, FORMA, 'pending')
  await expect(page.getByRole('heading', { name: 'Cómo vienen' })).toBeVisible({ timeout: 15000 })
  await expect(page.locator('[aria-label*="de local"]').first()).toBeVisible()
  await expect(page.locator('[aria-label*="de visita"]').first()).toBeVisible()
})

test('cada columna se puede leer sin ver el color', async ({ page }) => {
  /* Una G verde y una P naranja son el mismo carácter para un lector de
     pantalla si no se dice qué significan. */
  await abrir(page, FORMA, 'pending')
  const derrota = page.locator('[aria-label*="Perdió"]').first()
  await expect(derrota).toBeVisible({ timeout: 15000 })
  await expect(derrota).toHaveAttribute('aria-label', /Perdió 1 a 2 de local contra Puntarenas/)
})

test('el orden se dice, no se adivina', async ({ page }) => {
  await abrir(page, FORMA, 'pending')
  await expect(page.getByText(/más viejo · más reciente/)).toBeVisible({ timeout: 15000 })
})

test('resume la racha de cada equipo', async ({ page }) => {
  await abrir(page, FORMA, 'pending')
  await expect(page.getByRole('heading', { name: 'Cómo vienen' })).toBeVisible({ timeout: 15000 })
  /* Los dos equipos llevan 4G, así que cada afirmación se ACOTA a su fila: sin
     eso la prueba pasaría aunque el resumen de un equipo se pintara dos veces
     y el del otro no se pintara nunca. Lo que los distingue es la quinta
     fecha — San Carlos perdió, Cartaginés empató. */
  const sanCarlos = page.getByLabel(/AD San Carlos en estos 5/)
  const cartago = page.getByLabel(/Cartaginés en estos 5/)

  // Visible de un vistazo…
  await expect(sanCarlos.getByText('4G', { exact: true })).toBeVisible()
  await expect(sanCarlos.getByText('1P', { exact: true })).toBeVisible()
  await expect(cartago.getByText('1E', { exact: true })).toBeVisible()
  // Un cero no se dibuja: «4G · 0E · 1P» es ruido.
  await expect(sanCarlos.getByText('0E', { exact: true })).toHaveCount(0)

  // …y legible sin ver el color: «4G» a secas se lee «cuatro ge».
  await expect(page.getByLabel('AD San Carlos en estos 5: 4 ganados, 0 empatados, 1 perdido')).toBeVisible()
  await expect(page.getByLabel('Cartaginés en estos 5: 4 ganados, 1 empatado, 0 perdidos')).toBeVisible()
})

test('el balance del historial NO sale en inglés', async ({ page }) => {
  /* ESPN manda «CAR leads series 4-0-1» y eso llegaba crudo a la pantalla
     desde que se quitó `lang=es` de la petición. */
  await abrir(page, FORMA, 'pending')
  await expect(page.getByRole('heading', { name: 'Entre ellos' })).toBeVisible({ timeout: 15000 })
  await expect(page.getByText(/leads series/)).toHaveCount(0)
  await expect(page.getByText(/De estos 5:/)).toBeVisible()
  await expect(page.getByText(/Cartaginés 4/)).toBeVisible()
  await expect(page.getByText(/AD San Carlos 0/)).toBeVisible()
})

/* EL CONTRASTE SE MIDE, NO SE MIRA.

   La G iba pintada con el acento de la app sobre un fondo del MISMO acento al
   14%: en el tema claro eso da 1.7:1 — la letra casi no se ve sobre la tarjeta
   blanca— y el resumen «4G · 1P», que va sobre blanco puro, todavía menos.
   Es literalmente el fallo que este repo ya tenía anotado para el botón del
   aviso de notificaciones (1.74:1), repetido en otra pantalla.

   Se mide pintando el color en un canvas y leyendo el píxel: parsear
   getComputedStyle no sirve, porque Tailwind v4 devuelve `oklch(...)` y leer
   esos tres números como RGB da ratios inventados. */
for (const tema of ['light', 'dark']) {
  test(`las letras de la forma se leen en el tema ${tema}`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('qm_theme', t), tema)
    await abrir(page, FORMA, 'pending')
    await expect(page.getByRole('heading', { name: 'Cómo vienen' })).toBeVisible({ timeout: 15000 })

    const medidas = await page.evaluate(() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 1
      const cx = cv.getContext('2d', { willReadFrequently: true })
      const rgb = (color, sobre) => {
        cx.clearRect(0, 0, 1, 1)
        if (sobre) { cx.fillStyle = sobre; cx.fillRect(0, 0, 1, 1) }
        cx.fillStyle = color; cx.fillRect(0, 0, 1, 1)
        const d = cx.getImageData(0, 0, 1, 1).data
        return [d[0], d[1], d[2]]
      }
      const lum = ([r, g, b]) => [r, g, b]
        .map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 })
        .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0)
      const ratio = (a, b) => {
        const la = lum(a); const lb = lum(b)
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
      }
      /* Se sube hasta un fondo NO transparente: leer rgba(0,0,0,0) como negro
         da un contraste inventado. El chip tiene fondo propio, el resumen no. */
      const fondoDe = (el) => {
        let f = el; let c = 'rgba(0, 0, 0, 0)'
        while (f && (c === 'rgba(0, 0, 0, 0)' || c === 'transparent')) {
          c = getComputedStyle(f).backgroundColor; f = f.parentElement
        }
        return c
      }
      const base = getComputedStyle(document.body).backgroundColor
      const de = (el) => {
        if (!el) return null
        const f = fondoDe(el)
        return ratio(rgb(getComputedStyle(el).color, f), rgb(f, base))
      }
      const chip = (letra) => [...document.querySelectorAll('div')]
        .find((e) => !e.children.length && e.textContent.trim() === letra)
      const resumen = (texto) => [...document.querySelectorAll('span')]
        .find((e) => !e.children.length && e.textContent.trim() === texto)
      return {
        chipGano: de(chip('G')),
        chipEmpato: de(chip('E')),
        chipPerdio: de(chip('P')),
        resumenGanados: de(resumen('4G')),
        resumenPerdidos: de(resumen('1P')),
      }
    })

    // WCAG AA para texto normal: son letras de 10-11 px, no texto grande.
    for (const [parte, valor] of Object.entries(medidas)) {
      expect(valor, `${parte} en ${tema}`).not.toBeNull()
      expect(valor, `${parte} en ${tema}`).toBeGreaterThanOrEqual(4.5)
    }
  })
}
