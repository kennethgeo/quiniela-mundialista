/* Qué se borra del navegador al cambiar de cuenta, y qué NO.

   El criterio es de quién es el dato: si describe a la PERSONA, se va con
   ella; si describe al DISPOSITIVO, se queda. Mezclarlos fue el error: en un
   teléfono compartido —que en este grupo es lo normal— la segunda persona
   entraba y veía restos de la primera.

   Nada de esto es opcional en modo privado: leer o escribir localStorage
   LANZA cuando el sitio tiene el almacenamiento bloqueado. Que no se pueda
   limpiar es una molestia; que reviente el cambio de cuenta es un problema. */

// De la persona: se borran al cerrar sesión o al cambiar de cuenta.
export const CLAVES_DE_LA_PERSONA = [
  'tutorial_seen',      // quien recién entra tiene que ver el tutorial
  'tico:invitacion',    // un código pendiente uniría a la cuenta equivocada
]

// Del dispositivo: sobreviven a propósito.
export const CLAVES_DEL_DISPOSITIVO = [
  'qm_theme',           // el tema es del ojo que mira, no de la cuenta
  'pwaPromptDismissed', // "no me lo vuelvas a ofrecer" es de esta instalación
]

export function limpiarDatosDeSesion(almacen) {
  const store = almacen || (typeof localStorage !== 'undefined' ? localStorage : null)
  if (!store) return []
  const borradas = []
  for (const clave of CLAVES_DE_LA_PERSONA) {
    try {
      if (store.getItem(clave) !== null) {
        store.removeItem(clave)
        borradas.push(clave)
      }
    } catch { /* almacenamiento bloqueado: seguimos con las demás */ }
  }
  return borradas
}
