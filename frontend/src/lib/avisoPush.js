/* Cuándo ofrecer el aviso de notificaciones.

   Vive aparte de `notificaciones.js` a propósito: allá se habla con el
   navegador y con Supabase, y eso no se puede importar desde una prueba de
   vitest. Acá no hay nada de eso — es una decisión pura, y es justamente la
   parte que puede fallar en silencio: ofrecerle el aviso a quien ya tiene
   avisos, o seguir insistiéndole a quien lo cerró. */

/* ── En qué situación está este dispositivo ─────────────────────────────────
   Una sola función para el Hub y el Perfil: con dos criterios, una pantalla
   diría «activados» y la otra ofrecería activarlos.

   OJO CON EL ORDEN: en un iPhone SIN instalar, Safari no expone
   `Notification` ni `PushManager`, así que «sin soporte» y «falta instalar»
   se ven iguales desde `soportaPush()`. Si se preguntara primero por el
   soporte, a quien usa iPhone desde el navegador no se le diría nunca nada
   —pasaba: el texto de «agregá la app a inicio» existía y no se podía ver—.
   Por eso iOS va primero. */
export function situacionAvisos ({ soporta, iosSinInstalar, permiso, suscrito }) {
  if (iosSinInstalar) return 'ios-instalar'
  if (!soporta) return 'sin-soporte'
  if (permiso === 'denied') return 'bloqueado'
  if (permiso === 'granted' && suscrito) return 'activo'
  return 'pendiente'
}

/* ── Cuánto se espera después de un «Ahora no» ─────────────────────────────
   Se vuelve a ofrecer LA PRÓXIMA VEZ QUE ENTRE, no en la misma visita: por
   eso la primera espera es de 20 horas y no de minutos. Recargar la página o
   volver del detalle de un partido no es «volver a entrar», y un aviso que
   reaparece en cada pantalla es spam.

   Cada «Ahora no» seguido alarga la espera (1 → 3 → 7 → 14 días) y ahí se
   queda: quien dijo que no cuatro veces no quiere que le insistan, pero
   tampoco se le borra para siempre — alguien que lo cerró sin pensar no
   debería quedarse sin avisos toda la temporada. Activar los avisos borra la
   cuenta, así que si un día se pierden, se empieza de nuevo por el principio. */
export const CLAVE_POSPUESTO = 'avisoPushPospuesto'

/* POR CUENTA, no por dispositivo (décima auditoría): en un celular compartido,
   los «Ahora no» de una persona alargaban la espera de la otra. Se lee primero
   la clave de la cuenta y, si no hay, la vieja sin cuenta (lo guardado antes
   de este cambio); se escribe siempre la de la cuenta. */
const claveDe = (userId) => (userId ? `${CLAVE_POSPUESTO}:${userId}` : CLAVE_POSPUESTO)
const HORA = 60 * 60 * 1000
export const ESPERAS_HORAS = [20, 3 * 24, 7 * 24, 14 * 24]

function leer (userId) {
  let guardado
  try {
    guardado = localStorage.getItem(claveDe(userId))
    if (guardado == null && userId) guardado = localStorage.getItem(CLAVE_POSPUESTO)
  } catch { return null }
  if (guardado == null) return null
  // Formato viejo (hasta sep 2026): solo el instante, con 14 días fijos.
  // Se cuenta como un único «Ahora no»: a esa persona se le vuelve a ofrecer
  // al día siguiente, que es justo lo que se quiere.
  if (/^\d+$/.test(guardado)) return { cuando: parseInt(guardado, 10), veces: 1 }
  try {
    const d = JSON.parse(guardado)
    const cuando = Number(d?.cuando); const veces = Number(d?.veces)
    if (!Number.isFinite(cuando) || !Number.isInteger(veces) || veces < 1) return null
    return { cuando, veces }
  } catch { return null }
}

/** Espera, en ms, después de haber dicho «Ahora no» `veces` veces seguidas. */
export function esperaTras (veces) {
  const i = Math.min(Math.max(veces, 1), ESPERAS_HORAS.length) - 1
  return ESPERAS_HORAS[i] * HORA
}

export function posponerAviso (ahora = Date.now(), userId) {
  const previo = leer(userId)
  const veces = (previo?.veces || 0) + 1
  try { localStorage.setItem(claveDe(userId), JSON.stringify({ cuando: ahora, veces })) } catch { /* modo privado */ }
}

/** Al activar los avisos: la insistencia vuelve a empezar desde cero. */
export function olvidarPospuesto (userId) {
  try {
    localStorage.removeItem(claveDe(userId))
    localStorage.removeItem(CLAVE_POSPUESTO)
  } catch { /* modo privado */ }
}

export function avisoPospuesto (ahora = Date.now(), userId) {
  // Sin dato, o con un dato ilegible, se ofrece: preferimos ofrecer de más
  // que perder a alguien por una excepción del navegador.
  const d = leer(userId)
  if (!d) return false
  return (ahora - d.cuando) < esperaTras(d.veces)
}

/** ¿Se le ofrece el aviso del Hub a esta persona, en este dispositivo, ahora? */
export function debeOfrecerse ({ situacion, pospuesto }) {
  if (situacion === 'sin-soporte' || situacion === 'activo') return false
  if (pospuesto) return false
  return true
}
