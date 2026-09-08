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

/* Guardar es delete+insert por endpoint: las políticas RLS permiten DELETE e
   INSERT pero no UPDATE, y así re-suscribir no choca con el UNIQUE. */
export async function guardarSuscripcion (userId, subscription) {
  if (!userId || !subscription) return
  const s = JSON.parse(JSON.stringify(subscription))
  await supabase.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
  const { error } = await supabase.from('push_subscriptions').insert({
    user_id: userId, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth,
  })
  if (error) throw error
}

/** ¿Hay una suscripción viva en ESTE dispositivo? */
export async function tieneSuscripcion () {
  if (!soportaPush()) return false
  try {
    const reg = await navigator.serviceWorker.ready
    return !!(await reg.pushManager.getSubscription())
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

  const reg = await navigator.serviceWorker.ready
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

/** Baja en este dispositivo. */
export async function desactivarPush () {
  if (!soportaPush()) return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  await sub.unsubscribe()
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
}
