/* Andamiaje: sesión falsa e interceptación de Supabase.

   Sin esto, cada prueba dependería de la base de producción: fallaría por
   razones que no son el código, y una prueba que falla sola se termina
   ignorando. Peor todavía, escribiría datos de verdad.
*/

/* La clave donde supabase-js guarda la sesión: sb-<ref>-auth-token, con el
   ref sacado del subdominio. Con VITE_SUPABASE_URL=https://pruebas.supabase.co
   el ref es "pruebas". */
const CLAVE_SESION = 'sb-pruebas-auth-token'

export const USUARIO = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'prueba@ticogames.test',
  // La app exige el correo verificado para dejar pasar (ProtectedRoute).
  email_confirmed_at: '2026-01-01T00:00:00Z',
  user_metadata: { display_name: 'Prueba' },
  aud: 'authenticated',
  role: 'authenticated',
}

/* Deja al navegador con sesión iniciada ANTES de que cargue la app: si se
   inyectara después, AuthContext ya habría decidido que no hay nadie. */
export async function conSesion(page) {
  await page.addInitScript(([clave, usuario]) => {
    const sesion = {
      access_token: 'token-de-mentira',
      refresh_token: 'refresh-de-mentira',
      // Lejos en el futuro: si expira, el cliente intenta renovar contra la red.
      expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
      expires_in: 60 * 60 * 24 * 365,
      token_type: 'bearer',
      user: usuario,
    }
    try { localStorage.setItem(clave, JSON.stringify(sesion)) } catch { /* modo privado */ }
  }, [CLAVE_SESION, USUARIO])
}

/* Responde a TODO lo que salga hacia Supabase.

   `datos` mapea un trozo de la URL a lo que hay que devolver. Lo que no esté
   mapeado devuelve una lista vacía en vez de fallar: así una consulta nueva no
   rompe pruebas que no tienen nada que ver con ella. */
export async function interceptarSupabase(page, datos = {}) {
  await page.route('**://pruebas.supabase.co/**', async (route) => {
    const url = route.request().url()
    for (const [trozo, cuerpo] of Object.entries(datos)) {
      if (url.includes(trozo)) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(typeof cuerpo === 'function' ? cuerpo(url) : cuerpo),
        })
      }
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
}

/* Corta cualquier salida a internet que no sea Supabase: escudos, fuentes,
   fotos. El entorno de CI puede no tenerla, y una prueba de navegación no
   debería depender de que un CDN responda. */
export async function sinRedExterna(page) {
  await page.route('**://*/**', (route) => {
    const url = route.request().url()
    if (url.includes('localhost') || url.includes('pruebas.supabase.co')) return route.continue()
    return route.abort()
  })
}
