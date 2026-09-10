import { conLimite } from './loginResiliente'

/* Qué proveedores de login tiene ENCENDIDOS este proyecto de Supabase.

   Por qué se pregunta en vez de darlo por hecho: activar Google no se hace
   desde el repo, sino en el panel de Supabase con credenciales de Google
   Cloud. Si el botón se pintara siempre, existiría antes de que alguien haga
   ese paso y al tocarlo daría «Unsupported provider: provider is not enabled»
   — un botón que promete y no cumple, que es el fallo que este proyecto ya
   cometió con el panel de cupos de la migración 48.

   Preguntando, el botón APARECE SOLO el día que se habilite, sin desplegar
   nada ni tocar una bandera. Y si se apaga, desaparece igual.

   `/auth/v1/settings` devuelve `{ external: { google: false… } }`, pero **NO es
   público**: sin la cabecera `apikey` responde 401 «No API key found in
   request». Se creyó lo contrario por comprobarlo con un curl que llevaba la
   clave sin querer (venía de `.env.example`); el 200 hizo pensar que era
   abierto. La app llamaba sin clave, recibía 401, se quedaba con la lista
   vacía y el botón no aparecía NUNCA — con Google ya configurado y todo
   correcto del lado de Supabase. Lo cazó una revisión de las peticiones de
   red en producción, no las pruebas. */

/* No son «entrar con»: son la forma normal de registrarse en la app. */
const NO_SOCIALES = new Set(['email', 'phone', 'anonymous_users'])

export function proveedoresHabilitados(ajustes) {
  const externos = ajustes?.external
  if (!externos || typeof externos !== 'object') return []
  return Object.keys(externos)
    .filter((nombre) => externos[nombre] === true && !NO_SOCIALES.has(nombre))
    .sort()
}

/* NUNCA lanza y NUNCA bloquea la pantalla.

   Es un extra: si la petición falla o tarda, la lista queda vacía, no se pinta
   el botón y el login por correo sigue funcionando igual. Una pantalla de
   entrada no puede quedarse esperando a algo que solo decide si se dibuja un
   botón de más — es la misma lección que `conLimite` en el login. */
export async function traerProveedores(urlSupabase, clave, { hacerPeticion, limiteMs = 4000 } = {}) {
  // Sin URL o sin clave no hay nada que preguntar: el endpoint exige las dos.
  if (!urlSupabase || !clave) return []
  const pedir = hacerPeticion || ((u, opciones) => fetch(u, opciones))
  try {
    const respuesta = await conLimite(
      pedir(`${urlSupabase.replace(/\/+$/, '')}/auth/v1/settings`,
        { headers: { apikey: clave } }),
      limiteMs,
      'ajustes-auth',
    )
    if (!respuesta?.ok) return []
    return proveedoresHabilitados(await respuesta.json())
  } catch {
    return []
  }
}
