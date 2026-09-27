/**
 * Traduce un error de guardado de predicción a un mensaje claro para el usuario.
 * Antes estos errores fallaban en silencio (no había onError), así que parecía
 * que "no se guardaba" sin explicar por qué.
 */
export function friendlySaveError(err) {
  const msg = err?.message || ''
  const code = err?.code || ''

  // La base canceló el guardado por cruzarse con otra operación (una
  // anulación, un borrado de la quiniela, otra pestaña). No quedó nada a
  // medias: se puede volver a intentar (migración 100).
  if (code === '40P01' || /deadlock detected/i.test(msg)) {
    return 'No se pudo guardar porque se cruzó con otro cambio al mismo tiempo. Intentá de nuevo.'
  }

  // Rechazo por RLS: partido bloqueado (<15 min) o sin permiso.
  if (code === '42501' || /row-level security|violates row-level/i.test(msg)) {
    return 'No se pudo guardar: el partido ya está cerrado (faltan menos de 15 min para empezar) o no tenés permiso para editar esta predicción.'
  }

  // El trigger de comodines ya devuelve un mensaje claro en español.
  if (/comodin|comodín|powerup|x2/i.test(msg)) {
    return msg
  }

  return msg ? `No se pudo guardar: ${msg}` : 'No se pudo guardar la predicción. Intentá de nuevo.'
}
