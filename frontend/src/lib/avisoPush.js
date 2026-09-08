/* Cuándo ofrecer el aviso de notificaciones.

   Vive aparte de `notificaciones.js` a propósito: allá se habla con el
   navegador y con Supabase, y eso no se puede importar desde una prueba de
   vitest. Acá no hay nada de eso — es una decisión pura, y es justamente la
   parte que puede fallar en silencio: ofrecerle el aviso a quien ya tiene
   avisos, o seguir insistiéndole a quien lo cerró. */

/* ── Cuándo ofrecer el aviso ────────────────────────────────────────────────
   NO se insiste indefinidamente. Un aviso que reaparece siempre es el que
   hace que la gente apague todo, y entonces tampoco llegan los que importan.
   Se pospone dos semanas: suficiente para no molestar, poco para que alguien
   que lo cerró sin pensar se quede sin avisos toda la temporada. */
export const CLAVE_POSPUESTO = 'avisoPushPospuesto'
const DIAS = 14

export function posponerAviso (ahora = Date.now()) {
  try { localStorage.setItem(CLAVE_POSPUESTO, String(ahora)) } catch { /* modo privado */ }
}

export function avisoPospuesto (ahora = Date.now()) {
  let guardado
  // En modo privado leer localStorage puede lanzar. Sin dato, se ofrece.
  try { guardado = localStorage.getItem(CLAVE_POSPUESTO) } catch { return false }
  const cuando = parseInt(guardado, 10)
  if (!Number.isFinite(cuando)) return false
  return (ahora - cuando) < DIAS * 24 * 60 * 60 * 1000
}

/** ¿Se le ofrece el aviso a esta persona, en este dispositivo, ahora?
 *  `permiso` y `suscrito` se pasan para que la decisión sea pura y comprobable. */
export function debeOfrecerse ({ permiso, suscrito, pospuesto }) {
  if (permiso === null) return false        // navegador sin soporte
  if (permiso === 'granted' && suscrito) return false  // ya los tiene
  if (pospuesto) return false
  return true
}
