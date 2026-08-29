/**
 * Utilidades para que la pantalla de login no se pueda quedar colgada.
 *
 * El problema real que resuelven: `signInWithPassword` se queda esperando para
 * siempre si la petición nunca vuelve. Se vio en producción — el preflight de
 * CORS llegaba a Supabase y el POST no aparecía nunca en los logs — y la
 * pantalla se quedaba en "Entrando…" sin error y sin forma de reintentar,
 * porque el `finally { setLoading(false) }` nunca llegaba a correr.
 *
 * Ojo con la causa: NO es el Web Lock de supabase-js. Desde auth-js 2.x el
 * cliente no llama a `navigator.locks` salvo que le pases un `lock` propio, y
 * nosotros no le pasamos ninguno. Es la petición la que no vuelve.
 */

/** Error de "se acabó el tiempo", distinguible de un fallo de credenciales. */
export class TiempoAgotado extends Error {
  constructor(mensaje) {
    super(mensaje)
    this.name = 'TiempoAgotado'
    this.esTiempoAgotado = true
  }
}

/**
 * Corre una promesa con tiempo límite. Si se pasa, rechaza con TiempoAgotado.
 *
 * No cancela la promesa original (no se puede): solo deja de esperarla. Por eso
 * quien llama tiene que asumir que la operación PUDO haber ocurrido igual —
 * para el login, eso se comprueba después mirando si quedó sesión.
 */
export function conLimite(promesa, limiteMs, mensaje) {
  let temporizador
  const seAcaboElTiempo = new Promise((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new TiempoAgotado(mensaje)), limiteMs)
  })
  return Promise.race([promesa, seAcaboElTiempo]).finally(() => clearTimeout(temporizador))
}

/**
 * Reduce un fallo a una etiqueta corta para diagnóstico.
 *
 * Devuelve SOLO categorías conocidas: nunca el correo, la contraseña, un token
 * ni el mensaje crudo del servidor, porque esto termina en la consola del
 * dispositivo de la persona y en cualquier log que se recoja de ahí.
 */
export function describirFallo(err) {
  if (!err) return 'desconocido'
  if (err.esTiempoAgotado) return 'tiempo-agotado'

  const mensaje = String(err.message ?? '').toLowerCase()
  if (mensaje.includes('invalid login credentials')) return 'credenciales'
  if (mensaje.includes('email not confirmed')) return 'correo-sin-confirmar'
  if (mensaje.includes('failed to fetch') || mensaje.includes('network') || mensaje.includes('load failed')) return 'red'

  if (typeof err.status === 'number') return `http-${err.status}`
  return err.name ? `error:${err.name}` : 'desconocido'
}

/**
 * Deja constancia de cómo fue un intento de login, sin datos personales.
 * Solo la categoría y cuánto tardó: con eso alcanza para saber si la gente se
 * está quedando esperando, que es justo lo que no podíamos ver antes.
 */
export function registrarIntento(categoria, msDuracion) {
  console.info(`[login] ${categoria} en ${Math.round(msDuracion)} ms`)
}
