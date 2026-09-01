/* El código de invitación pendiente, guardado entre pantallas.

   POR QUÉ HACE FALTA GUARDARLO: quien abre /unirse/ABC123 sin cuenta tiene que
   registrarse, confirmar el correo y volver. Ese viaje pasa por el cliente de
   correo y pierde la URL, así que el código no puede vivir solo en la ruta. Si
   no se guarda, el enlace únicamente sirve para quien ya tiene sesión abierta,
   que es justo quien menos lo necesita.

   Se usa localStorage y no sessionStorage a propósito: el enlace de
   verificación suele abrirse en otra pestaña, y sessionStorage no se comparte
   entre pestañas.

   TODO acceso va envuelto: en modo privado, o con el almacenamiento del sitio
   bloqueado, leer o escribir LANZA. Que no se pueda guardar el código es una
   molestia; que reviente la pantalla de inicio es un problema. */

const CLAVE = 'tico:invitacion'

/* Solo letras y números, en mayúsculas: es lo que espera join_group_by_code.
   Sirve además para no guardar basura si alguien manipula la URL. */
export function normalizarCodigo(codigo) {
  return String(codigo || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24)
}

export function guardarInvitacion(codigo) {
  const limpio = normalizarCodigo(codigo)
  if (!limpio) return false
  try {
    localStorage.setItem(CLAVE, limpio)
    return true
  } catch {
    return false
  }
}

/* Devuelve el código pendiente Y LO BORRA. Se consume una sola vez: si el
   intento de unirse falla —código vencido, quiniela llena— no queremos que
   la app siga reintentando en cada arranque. */
export function tomarInvitacion() {
  try {
    const v = localStorage.getItem(CLAVE)
    localStorage.removeItem(CLAVE)
    return normalizarCodigo(v) || null
  } catch {
    return null
  }
}

export function hayInvitacion() {
  try {
    return Boolean(normalizarCodigo(localStorage.getItem(CLAVE)))
  } catch {
    return false
  }
}

/* El enlace que se comparte. Se arma con el origen actual para que funcione
   igual en producción y en una vista previa de Vercel. */
export function enlaceDeInvitacion(codigo, origen) {
  const base = origen || (typeof window !== 'undefined' ? window.location.origin : '')
  return `${base}/unirse/${normalizarCodigo(codigo)}`
}
