/* Alta y baja de las notificaciones push, en un solo lugar.

   POR QUÉ VIVE ACÁ Y NO EN EL COMPONENTE: ahora hay DOS pantallas que activan
   push —el interruptor del perfil y el aviso del Hub— y este repo ya perdió
   los puntos de asistidor durante meses por tener la misma fórmula escrita dos
   veces. Acá el síntoma sería peor: una pantalla guardaría la suscripción y la
   otra no, y la persona creería tener avisos que no le van a llegar.

   NADA DE ESTO PUEDE TIRAR LA PANTALLA. Push falla de muchas maneras —permiso
   denegado, navegador sin soporte, service worker que todavía no está listo,
   iOS sin instalar— y ninguna de ellas justifica una pantalla en blanco. */
import { supabase } from './supabase'

/* Llave pública VAPID. DEBE coincidir con la privada que usa el emisor
   (backend y edge function). Si se rota, hay que cambiarla en los tres
   lugares a la vez. */
export const VAPID_PUBLIC_KEY =
  'BEZacx8-hHDBW6kekpy-K-ZBU4LRHttGOK32Bm5IsAGCkt_lhSGKaXpmhRJCQh3voZnWCHS7gv52_jCqkgP_4DQ'

export function urlBase64ToUint8Array (base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const out = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) out[i] = rawData.charCodeAt(i)
  return out
}

/** ¿Este navegador puede recibir push? */
export function soportaPush () {
  return typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
}

/** 'granted' | 'denied' | 'default' | null (sin soporte). */
export function estadoPermiso () {
  if (!soportaPush()) return null
  return Notification.permission
}

/* iOS SOLO permite push si la app está instalada en la pantalla de inicio.
   Sin esto, el botón "Activar" no hace nada en Safari y la persona concluye
   que la app está rota. Hay que decírselo, no esconderlo. */
export function esIOS () {
  if (typeof navigator === 'undefined') return false
  return /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase())
}

export function estaInstalada () {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches === true ||
    window.navigator?.standalone === true
}

/** iOS en el navegador, sin instalar: hay que instalar antes de poder activar. */
export const necesitaInstalarPrimero = () => esIOS() && !estaInstalada()

/* El service worker puede no ponerse listo NUNCA (registro fallido, modo
   privado, un navegador raro). Esperarlo sin límite dejaba el botón del Perfil
   en «Un momento…» para siempre y el aviso del Hub sin aparecer: la misma
   espera infinita que ya sufrió el login. Con límite, quien llama sabe que no
   hubo respuesta y lo dice. */
export const LIMITE_SW_MS = 4000

export async function swListo (ms = LIMITE_SW_MS) {
  if (!soportaPush()) return null
  let reloj
  const tarde = new Promise((resolve) => { reloj = setTimeout(() => resolve(null), ms) })
  try {
    return await Promise.race([navigator.serviceWorker.ready, tarde])
  } finally {
    clearTimeout(reloj)
  }
}

const SW_NO_LISTO = 'El navegador no terminó de preparar los avisos. Recargá la página y probá de nuevo.'

/* Guardar la suscripción SIN borrar antes (novena auditoría). Antes era
   DELETE + INSERT en dos peticiones: si el INSERT fallaba después del DELETE,
   el navegador seguía suscrito, la base ya no tenía la fila, y la pantalla
   decía «activados» a alguien a quien el backend no le puede escribir.
   Ahora se inserta primero; si el endpoint ya existe (UNIQUE) se comprueba que
   la fila sea de ESTA cuenta, y solo entonces se da por guardada. La RLS no
   deja ver ni borrar la fila de otra cuenta, así que ese caso se dice. */
export async function guardarSuscripcion (userId, subscription) {
  if (!userId || !subscription) return
  const s = JSON.parse(JSON.stringify(subscription))
  const { error } = await supabase.from('push_subscriptions').insert({
    user_id: userId, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth,
  })
  if (!error) return
  if (error.code !== '23505') throw error
  if (await registrada(userId, s.endpoint)) return
  throw new Error('Este dispositivo tiene los avisos registrados a otra cuenta. Desactivalos desde esa cuenta y volvé a activarlos acá.')
}

/** ¿La base tiene este endpoint a nombre de esta cuenta? Lanza si no se puede saber. */
export async function registrada (userId, endpoint) {
  const { data, error } = await supabase.from('push_subscriptions')
    .select('id').eq('user_id', userId).eq('endpoint', endpoint).limit(1)
  if (error) throw error
  return (data?.length || 0) > 0
}

/** La suscripción viva en ESTE dispositivo, o null (también si el service
 *  worker no respondió a tiempo). */
export async function suscripcionLocal () {
  try {
    const reg = await swListo()
    return reg ? await reg.pushManager.getSubscription() : null
  } catch {
    return null
  }
}

/** ¿Hay una suscripción viva en ESTE dispositivo? */
export async function tieneSuscripcion () {
  return !!(await suscripcionLocal())
}

/* «Activo» exige las DOS mitades: suscripción en el navegador y fila en la
   base a nombre de esta cuenta. Solo la primera no sirve: el backend manda a
   lo que hay en la base. Si falta la fila se intenta guardar en silencio
   (auto-sanación); si eso falla, NO está activo y la pantalla lo ofrece.
   Si ni siquiera se puede preguntar, tampoco se afirma que esté activo. */
export async function avisosActivos (userId) {
  const sub = await suscripcionLocal()
  if (!sub || !userId) return false
  try {
    if (await registrada(userId, sub.endpoint)) return true
    // Durante un cierre de sesión no se re-registra nada (undécima auditoría).
    if (cerrandoSesion()) return false
    await guardarSuscripcion(userId, sub)
    return true
  } catch {
    return false
  }
}

/** Activa push y deja la suscripción guardada. Devuelve la suscripción.
 *  Lanza con un mensaje legible si no se puede: quien llama lo muestra. */
export async function activarPush (userId) {
  if (!soportaPush()) throw new Error('Este navegador no admite notificaciones')
  if (necesitaInstalarPrimero()) {
    throw new Error('En iPhone hay que agregar la app a la pantalla de inicio antes de activar los avisos')
  }

  const permiso = await Notification.requestPermission()
  if (permiso !== 'granted') {
    throw new Error('No diste permiso para las notificaciones')
  }

  const reg = await swListo()
  if (!reg) throw new Error(SW_NO_LISTO)
  /* Se limpia cualquier suscripción previa (por ejemplo con una llave VAPID
     vieja): suscribir sobre una existente da InvalidStateError. */
  const previa = await reg.pushManager.getSubscription()
  if (previa) {
    await previa.unsubscribe()
    await supabase.from('push_subscriptions').delete().eq('endpoint', previa.endpoint)
  }

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  })
  await guardarSuscripcion(userId, sub)
  return sub
}

/* Al CERRAR SESIÓN (décima y undécima auditoría): este dispositivo deja de
   recibir los avisos de esa cuenta.

   Tres defensas, porque una sola no alcanzaba (lo reprodujo Astra):
   · Se da de BAJA la suscripción del NAVEGADOR, no solo la fila. Sin red, el
     DELETE no llega y la fila queda; pero un endpoint dado de baja el
     proveedor lo rechaza (410) y el backend la borra solo (90). Además otra
     pestaña ya no tiene suscripción que volver a registrar.
   · Se deja una marca compartida entre pestañas (`localStorage`) mientras se
     cierra: la auto-sanación del Hub y del Perfil no vuelve a dar de alta
     nada en ese rato. Sin eso, otra pestaña veía «falta la fila» y la
     re-insertaba antes de que terminara el cierre.
   · Todo con UN presupuesto de tiempo: ni `getSubscription()` ni la red
     pueden impedir que después se cierre la sesión.
   Después se puede volver a activar a mano sin problema: la marca no frena
   `activarPush`, solo las altas automáticas. */
export const CLAVE_CERRANDO = 'avisosPush:cerrando'
const VIDA_MARCA_MS = 60 * 1000
export const PRESUPUESTO_CIERRE_MS = 4000

function marcarCierre () {
  try { localStorage.setItem(CLAVE_CERRANDO, String(Date.now())) } catch { /* modo privado */ }
}

/** ¿Hay un cierre de sesión en curso (en esta pestaña o en otra)? */
export function cerrandoSesion (ahora = Date.now()) {
  try {
    const t = parseInt(localStorage.getItem(CLAVE_CERRANDO), 10)
    return Number.isFinite(t) && ahora - t < VIDA_MARCA_MS
  } catch { return false }
}

export async function olvidarDispositivo (userId) {
  marcarCierre()
  const trabajo = (async () => {
    const sub = await suscripcionLocal()
    if (!sub) return
    const endpoint = sub.endpoint
    try { await sub.unsubscribe() } catch { /* la fila igual se intenta borrar */ }
    if (userId) {
      await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', endpoint)
    }
  })().catch(() => {})
  // Cerrar sesión importa más que esto: pase lo que pase, se sigue.
  await Promise.race([trabajo, new Promise((resolve) => setTimeout(resolve, PRESUPUESTO_CIERRE_MS))])
}

/** Baja en este dispositivo. */
export async function desactivarPush () {
  if (!soportaPush()) return
  const reg = await swListo()
  if (!reg) throw new Error(SW_NO_LISTO)
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  await sub.unsubscribe()
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
}
