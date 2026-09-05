/* El pie del sidebar se pintó mirando solo el modo oscuro y en el tema claro
   quedaba blanco sobre crema: el propio nombre a 1.09:1, ilegible.

   SE MIDE CONVIRTIENDO EL COLOR A sRGB CON UN CANVAS, no parseando la cadena:
   getComputedStyle devuelve oklch(...) para los colores de Tailwind v4, y
   leer esos tres números como si fueran RGB da un contraste inventado. Ese
   error me hizo reportar un fallo en el tema oscuro que no existía. */
import { expect, test } from '@playwright/test'
import { conSesion, interceptarSupabase, sinRedExterna, USUARIO } from './apoyo.js'

const AA_TEXTO_NORMAL = 4.5

async function contrastes (page) {
  return page.evaluate(() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 1
    const cx = cv.getContext('2d', { willReadFrequently: true })
    const aRGB = (color, sobre) => {
      cx.clearRect(0, 0, 1, 1)
      if (sobre) { cx.fillStyle = sobre; cx.fillRect(0, 0, 1, 1) }
      cx.fillStyle = color; cx.fillRect(0, 0, 1, 1)
      const d = cx.getImageData(0, 0, 1, 1).data
      return [d[0], d[1], d[2]]
    }
    const lum = ([r, g, b]) => [r, g, b]
      .map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 })
      .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0)
    const razon = (f, g) => { const a = lum(f), b = lum(g); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }
    const fondoDe = (el) => {
      let f = el, c = 'rgba(0, 0, 0, 0)'
      while (f && (c === 'rgba(0, 0, 0, 0)' || c === 'transparent')) { c = getComputedStyle(f).backgroundColor; f = f.parentElement }
      // El sidebar es semitransparente: se compone sobre el fondo de la página.
      return aRGB(c, getComputedStyle(document.body).backgroundColor)
    }
    const buscar = (t) => [...document.querySelectorAll('*')]
      .filter((e) => e.children.length === 0 && e.textContent.trim() === t).pop()
    const out = {}
    for (const t of ['Prueba', '0 pts', 'Cerrar sesión', 'Mi Perfil']) {
      const el = buscar(t); if (!el) continue
      out[t] = razon(aRGB(getComputedStyle(el).color), fondoDe(el))
    }
    return out
  })
}

async function montar (page, tema) {
  await sinRedExterna(page)
  await conSesion(page)
  await page.addInitScript((t) => {
    localStorage.setItem('qm_theme', t)
    localStorage.setItem('tutorial_seen', 'true')
    localStorage.setItem('pwaPromptDismissed', 'true')
  }, tema)
  await interceptarSupabase(page, {
    '/rest/v1/users': { id: USUARIO.id, display_name: 'Prueba', avatar_url: null, total_points: 0, is_admin: false },
    '/rest/v1/rpc/my_groups': [],
    '/rest/v1/rpc/mi_resumen_global': { partidos: 0 },
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Cerrar sesión' }).first()).toBeVisible()
}

for (const tema of ['light', 'dark']) {
  test(`el pie del sidebar se lee en tema ${tema}`, async ({ page }) => {
    await montar(page, tema)
    const medido = await contrastes(page)
    expect(Object.keys(medido).length).toBeGreaterThan(0)
    for (const [texto, razon] of Object.entries(medido)) {
      expect(razon, `«${texto}» a ${razon.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_TEXTO_NORMAL)
    }
  })
}
