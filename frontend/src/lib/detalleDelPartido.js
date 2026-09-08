/* Detalle de un partido (alineaciones, estadísticas, forma, historial).

   VA POR EL BACKEND Y NO DIRECTO A ESPN por dos razones, ninguna opcional:
     · El CSP solo permite `connect-src 'self'` y Supabase. Una llamada del
       navegador a ESPN la bloquea el navegador, sin error visible.
     · El backend cachea. El resumen crudo pesa ~200 KB y la pantalla se
       refresca cada 30 s mientras el partido está en curso: sin caché, diez
       personas mirando serían veinte llamadas por minuto para traer lo mismo.

   A DIFERENCIA DE `refrescoEnVivo`, acá el error SÍ importa: si esto falla la
   pantalla tiene que decirlo, no quedarse con un hueco que parezca que el
   partido no tiene datos. */
import { supabase } from './supabase'

export async function fetchDetalleDelPartido (matchId) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Sesión no disponible')

  const r = await fetch(`/_backend/api/matches/${matchId}/detalle`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (!r.ok) {
    throw new Error(r.status === 503
      ? 'No se pudo traer el detalle en este momento'
      : `No se pudo traer el detalle (${r.status})`)
  }
  return r.json()
}

/* Cuánto vale la respuesta en el navegador. Sigue al TTL del backend para no
   pedirle algo que él va a responder con lo mismo que ya tenemos. */
export function frescuraDe (status) {
  if (status === 'in_progress') return 60 * 1000
  if (['finished', 'cancelled', 'postponed'].includes(status)) return 60 * 60 * 1000
  return 5 * 60 * 1000
}
