/* Pruebas de NAVEGACIÓN: que cada camino lleve a donde debe.

   POR QUÉ ESTAS Y NO OTRAS: las 146 pruebas de vitest prueban lógica pura y
   ninguna abre la app. Los errores que llegaron a producción en esta sesión
   —el botón tapado por el velo, el estadio que no salía, las fotos de perfil
   que faltaban— no los podía ver ninguna de ellas. Y las regresiones de
   navegación son peores todavía: no fallan, simplemente te dejan en otro
   lado.

   Corren SIN backend: se interceptan las llamadas a Supabase. Una prueba que
   depende de la base de producción falla por razones que no son el código, y
   una prueba que falla sola se termina ignorando.
*/
import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

/* El entorno de desarrollo trae Chromium preinstalado en una build distinta a
   la que espera este @playwright/test. Si está, se usa ese en vez de bajar
   otro; en CI no existe esa ruta y Playwright usa el que instala `npx
   playwright install chromium`. */
const CHROMIUM_LOCAL = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const ejecutable = existsSync(CHROMIUM_LOCAL) ? CHROMIUM_LOCAL : undefined

const PUERTO = 5199
const BASE = `http://localhost:${PUERTO}`

export default defineConfig({
  testDir: './tests/ui',
  // En CI no se reintenta: una prueba que pasa al segundo intento está rota
  // igual, y el reintento solo esconde el problema.
  retries: 0,
  fullyParallel: true,
  reporter: process.env.CI ? 'list' : 'line',
  use: {
    baseURL: BASE,
    // Se prueba a ancho de teléfono: es donde vive el grupo.
    ...devices['Pixel 7'],
    trace: 'retain-on-failure',
  },
  projects: [{
    name: 'movil',
    use: { ...devices['Pixel 7'], launchOptions: { executablePath: ejecutable } },
  }],
  webServer: {
    command: `npm run dev -- --port ${PUERTO}`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Valores de mentira a propósito: la app solo necesita que createClient
      // no reviente al arrancar. Todas las respuestas se interceptan.
      VITE_SUPABASE_URL: 'https://pruebas.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon-de-mentira-para-las-pruebas',
    },
  },
})
