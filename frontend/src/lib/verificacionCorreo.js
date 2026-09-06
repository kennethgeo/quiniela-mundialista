/* ¿Este usuario tiene el correo verificado?

   EL PROBLEMA QUE ARREGLA: ProtectedRoute consultaba
   `public.users.email_confirmed_at`, una columna que NO EXISTE en ninguna
   migración. La consulta fallaba siempre, caía al catch y ahí hacía
   `setIsEmailVerified(true)` — o sea que la puerta estaba abierta para
   cualquiera. Con la app entre 17 amigos daba igual; al abrirla al público,
   significa que cualquiera entra sin confirmar su correo.

   La fuente de verdad es `auth.users`, que Supabase devuelve en la sesión. No
   hace falta duplicar el dato en `public.users`: duplicarlo es justamente cómo
   se generan las derivas que ya nos mordieron.

   TRES ESTADOS: un timestamp confirma, null explícito bloquea y un objeto
   incompleto exige consultar Auth antes de mostrar las rutas protegidas. */

export function estadoVerificacionCorreo(user) {
  if (!user) return 'sin-sesion'

  if (user.email_confirmed_at || user.confirmed_at) return 'verificado'
  // null explícito: Supabase sabe que no confirmó.
  if (user.email_confirmed_at === null || user.confirmed_at === null) return 'sin-verificar'
  // Ninguna de las dos claves está presente: forma inesperada.
  return 'desconocido'
}

export function puedeEntrar(user) {
  return estadoVerificacionCorreo(user) === 'verificado'
}

// La respuesta debe ser de la misma cuenta, incluso si Auth cambia durante la consulta.
export async function verificarConAuth(user, obtenerUsuario) {
  const { data, error } = await obtenerUsuario()
  if (error || !data?.user || data.user.id !== user?.id) {
    throw new Error('No pudimos comprobar tu sesión. Reintentá cuando vuelva la conexión.')
  }
  const estado = estadoVerificacionCorreo(data.user)
  if (estado === 'desconocido') throw new Error('No pudimos comprobar la verificación de tu cuenta.')
  return estado
}
