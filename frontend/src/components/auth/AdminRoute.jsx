import { Navigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import LoadingSpinner from '../ui/LoadingSpinner'

/* `/admin` SOLO estaba detrás de `ProtectedRoute`, que comprueba sesión y
   correo verificado — nada más. Cualquiera de los 26 podía escribir /admin en
   la barra y le salía el panel global entero: editar resultados de partidos,
   sincronizar torneos, repartir los puntos de campeón y goleador.

   NO ERA UNA ESCALADA DE PRIVILEGIOS —las escrituras las rechaza la RLS y los
   endpoints comprueban `is_admin` del lado del servidor, y eso sigue siendo
   quien manda— pero sí era una pantalla que no le corresponde a nadie más:
   muestra el estado interno del torneo y ofrece botones que disparan syncs. La
   regla de este proyecto para las pantallas de admin ya estaba escrita para la
   pestaña Admin de una quiniela; a la ruta global nunca se le aplicó.

   Se comprueba `profile`, no `user`: `is_admin` vive en `public.users` y el
   cliente no lo puede tocar (privilegios por columna, migración 61).

   Mientras el perfil carga se espera. Un `Navigate` en ese hueco sacaría al
   admin de su propio panel al recargar la página. */
export default function AdminRoute ({ children }) {
  const { user, profile, loading } = useAuth()

  if (loading) return <LoadingSpinner />
  if (!user) return <Navigate to="/auth" replace />
  // Sesión iniciada y el perfil todavía en camino: no se decide nada aún.
  if (!profile) return <LoadingSpinner />
  if (!profile.is_admin) return <Navigate to="/hub" replace />

  return children
}
