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

   TRES ESTADOS, NO DOS. Y la diferencia importa:
     · timestamp  → verificado.
     · null       → Supabase dice explícitamente que NO está verificado. Se bloquea.
     · undefined  → el objeto no tiene la forma esperada (versión distinta del
                    SDK, sesión rara). NO se bloquea: dejar afuera a gente
                    legítima por un cambio de forma sería peor que el agujero
                    que esto cierra. Se avisa por consola.

   Se exporta aparte del componente para poder probarla sin montar React. */

export function estadoVerificacionCorreo(user) {
  if (!user) return 'sin-sesion'

  const confirmado = user.email_confirmed_at ?? user.confirmed_at

  if (confirmado) return 'verificado'
  // null explícito: Supabase sabe que no confirmó.
  if (confirmado === null) return 'sin-verificar'
  // Ninguna de las dos claves está presente: forma inesperada.
  return 'desconocido'
}

/* ¿Se le deja pasar? Solo 'sin-verificar' bloquea. */
export function puedeEntrar(user) {
  const estado = estadoVerificacionCorreo(user)
  if (estado === 'desconocido') {
    console.warn(
      '[verificacionCorreo] La sesión no trae email_confirmed_at ni confirmed_at. ' +
      'Se permite el acceso para no bloquear a alguien legítimo, pero revisá la ' +
      'forma del objeto de usuario de Supabase.',
    )
  }
  return estado === 'verificado' || estado === 'desconocido'
}
