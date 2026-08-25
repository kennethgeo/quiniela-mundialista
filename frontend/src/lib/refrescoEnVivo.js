/* Pedir un refresco de marcadores en vivo.

   El endpoint dejó de ser público (corría con service_role, así que cualquiera
   en internet podía disparar sincronizaciones y llamadas a ESPN sin límite).
   Ahora exige sesión, y por eso la llamada tiene que mandar el token.

   Vive en un solo lugar porque son TRES pantallas las que lo llaman —
   LiveNow, useLiveSync y MatchDetailPage — y las tres fallan en silencio
   (.catch vacío): si a una se le olvidara el token, el marcador simplemente
   dejaría de avanzar sin que nadie viera un error. */
import { supabase } from './supabase'

export async function pedirRefrescoEnVivo() {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) return
    await fetch('/_backend/api/matches/refresh-live', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
  } catch {
    /* El refresco es una mejora sobre el cron, no algo crítico. */
  }
}
