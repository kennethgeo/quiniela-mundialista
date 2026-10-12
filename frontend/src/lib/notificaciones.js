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
export const NO_SE_PUDO_REGISTRAR = 'No pudimos registrar este dispositivo. Tocá «Activar avisos» para reintentar.'

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
  const e = new Error('Este dispositivo tiene los avisos registrados a otra cuenta. Desactivalos desde esa cuenta y volvé a activarlos acá.')
  e.ajena = true
  throw e
}

/* La suscripción viva es de OTRA cuenta pero ESTA los pidió en este
   dispositivo (celular compartido donde las dos los activaron alguna vez).
   Antes el error solo se mostraba: la suscripción de la otra persona quedaba
   viva —le seguían llegando sus avisos a quien usa el celular— y esta cuenta
   se quedaba sin los suyos (revisión del 11 oct 2026). Se da de baja la ajena
   y se suscribe esta. Devuelve si quedó activo. */
export async function reemplazarAjena (userId, sub, vale = () => true) {
  return suscribirDeNuevo(userId, sub, { vale })
}

/* Da de baja `vieja`, suscribe de nuevo con la llave ACTUAL y lo guarda.
   Devuelve si quedó activo, o `null` si lo abandonó porque `vale()` dejó de
   ser cierto (otra cuenta en la sesión, la pantalla se fue); lanza si falla
   el guardado (quien llama decide).
   Con `borrarFilaVieja` borra después la fila del endpoint viejo de esta
   cuenta: si no se pudiera, el backend la borra solo al primer rechazo
   (vigésima auditoría). */
async function suscribirDeNuevo (userId, vieja, { borrarFilaVieja = false, vale = () => true } = {}) {
  if (!vale()) return null
  const endpointViejo = vieja.endpoint
  try { await vieja.unsubscribe() } catch { return false }
  if (!vale()) return null
  const nueva = await resuscribirSiLosPidio(userId, vale)
  if (!vale()) return null
  if (!nueva) return false
  try {
    await guardarSuscripcion(userId, nueva)
  } catch (e) {
    if (!vale()) return null
    // La suscripción nueva es BUENA: lo que falló es guardarla. Se recuerda
    // para que la próxima apertura reintente guardar ESA y no cree otra.
    if (!e?.ajena) recordarSinGuardar(userId, nueva.endpoint)
    throw e
  }
  olvidarSinGuardar(userId)
  marcarAvisosDeCuenta(userId, true)
  if (borrarFilaVieja && endpointViejo && endpointViejo !== nueva.endpoint && vale()) {
    try {
      await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', endpointViejo)
    } catch { /* la limpia el backend */ }
  }
  return true
}

/* ¿La llave de la suscripción difiere POSITIVAMENTE de la actual? Si no se
   puede saber (el navegador no la expone) devolvemos false para NO migrar: si
   no, se re-suscribiría en cada carga y los endpoints cambiarían sin parar.
   Vive acá y no en el Perfil (vigésima auditoría): el Hub también tiene que
   migrar, y la comparación escrita dos veces es el error de siempre. */
export function llaveDistinta (existente, actual = urlBase64ToUint8Array(VAPID_PUBLIC_KEY)) {
  if (!existente) return false
  const a = new Uint8Array(existente)
  if (a.length !== actual.length) return true
  for (let i = 0; i < a.length; i++) if (a[i] !== actual[i]) return true
  return false
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

/* Una suscripción que ESTA app acaba de crear y no pudo guardar en la base
   (revisión de la vigésima auditoría). Sin este recuerdo, la próxima apertura
   la veía «sin fila» y la tomaba por un endpoint muerto que el backend borró:
   la daba de baja y creaba otra, en CADA apertura, mientras el guardado
   siguiera fallando (por ejemplo, un 23514 de `push_endpoint_conocido` con un
   navegador que la lista no conoce). Con el recuerdo se reintenta guardar la
   MISMA, que nunca se rechazó. */
const claveSinGuardar = (userId) => `avisosPush:sinGuardar:${userId}`

function recordarSinGuardar (userId, endpoint) {
  try { localStorage.setItem(claveSinGuardar(userId), endpoint) } catch { /* modo privado */ }
}
function olvidarSinGuardar (userId) {
  try { localStorage.removeItem(claveSinGuardar(userId)) } catch { /* modo privado */ }
}
function esSinGuardar (userId, endpoint) {
  try { return !!endpoint && localStorage.getItem(claveSinGuardar(userId)) === endpoint } catch { return false }
}

/* `suscribirDeNuevo`/`reemplazarAjena` con lo que la pantalla tiene que decir.
   `null` = se abandonó porque ya no es esta cuenta: no hay nada que decir. */
async function reintentoConError (fn) {
  try {
    const ok = await fn()
    if (ok === null) return { activo: false, error: null }
    return { activo: ok, error: ok ? null : NO_SE_PUDO_REGISTRAR }
  } catch (e) {
    return { activo: false, error: e?.ajena ? e.message : NO_SE_PUDO_REGISTRAR }
  }
}

/* LA CUENTA CON SESIÓN EN ESTA PESTAÑA, según AuthContext (revisión de
   Codex, 12 oct 2026). `revisarAvisos` espera al service worker y a la base
   varias veces, y nada de eso se cancela: si mientras tanto la cuenta A sale
   y entra B, la vuelta vieja de A seguía y, al ver una suscripción que no era
   de A, la daba de baja — era la de B — o la reemplazaba a nombre de A. La
   pantalla tenía su `vigente`, pero solo frenaba el `setState`, no lo que la
   librería hacía con el navegador. Ahora, después de CADA espera y antes de
   tocar nada, se pregunta si la cuenta sigue siendo la misma. */
let cuentaEnSesion = null

export function fijarCuentaEnSesion (userId) {
  cuentaEnSesion = userId ?? null
}

const esLaCuentaEnSesion = (userId) => !!userId && cuentaEnSesion === userId

/* «Activo» exige las DOS mitades: suscripción en el navegador y fila en la
   base a nombre de esta cuenta. Solo la primera no sirve: el backend manda a
   lo que hay en la base. Si falta la fila se intenta sanar en silencio; si
   eso falla, NO está activo y la pantalla lo ofrece.
   Si ni siquiera se puede preguntar, tampoco se afirma que esté activo.

   UNA SOLA VÍA para el Hub y el Perfil (revisión de la vigésima auditoría):
   el Perfil tenía su propia copia y, con la fila borrada por el backend,
   volvía a guardar el MISMO endpoint muerto mientras el Hub suscribía de
   nuevo. Las dos pantallas decidían distinto sobre la misma situación.
   Devuelve `{ activo, error }`; `error` es un texto para mostrar o null.

   `sigueVigente` es de quien llama (la pantalla que se desmonta); la cuenta
   en sesión la mira siempre (`esLaCuentaEnSesion`). Si cualquiera de las dos
   deja de valer a mitad de camino, se abandona sin tocar nada. */
export async function revisarAvisos (userId, sigueVigente = () => true) {
  const nada = { activo: false, error: null }
  if (!userId || !soportaPush()) return nada
  const vale = () => esLaCuentaEnSesion(userId) && sigueVigente()
  if (!vale()) return nada
  const reg = await swListo()
  if (!vale()) return nada
  if (!reg) return { activo: false, error: SW_NO_LISTO }
  let sub = null
  try { sub = await reg.pushManager.getSubscription() } catch { sub = null }
  if (!vale()) return nada
  // Auto-sanación TAMBIÉN en el Hub (10 oct 2026). Antes solo el Perfil
  // volvía a suscribir a quien había perdido la suscripción del navegador
  // (un service worker desregistrado, un cierre de sesión involuntario), y casi
  // nadie entra al Perfil: la persona creía tener avisos y no le llegaba nada.
  // Condiciones: permiso dado, esta cuenta los pidió acá y no los apagó, y no
  // hay un cierre de sesión en curso.
  let recien = false
  if (!sub) { sub = await resuscribirSiLosPidio(userId, vale); recien = !!sub }
  if (!sub || !vale()) return nada
  let mia
  try {
    mia = await registrada(userId, sub.endpoint)
  } catch {
    // `registrada` no respondió: no se sabe de quién es. Eso NO es «es de
    // otra persona» (10 oct 2026): sin saber, no se toca nada.
    return nada
  }
  // La lectura es justo la espera larga: si en ese rato entró otra cuenta,
  // «no es de A» es cierto y la suscripción es de B. No se toca.
  if (!vale()) return nada
  if (mia) {
    olvidarSinGuardar(userId)
    marcarAvisosDeCuenta(userId, true)
    // LLAVE VIEJA (vigésima auditoría): un iPhone suscrito en junio seguía
    // con fila y suscripción, y Apple rechazaba cada aviso con
    // `VapidPkHashMismatch`. Fila y navegador decían «activo» y no llegaba
    // nada. El Perfil ya migraba; el Hub, que es donde entra la gente, no.
    if (!recien && llaveDistinta(sub.options?.applicationServerKey) &&
        estadoPermiso() === 'granted' && !cerrandoSesion()) {
      return await reintentoConError(() => suscribirDeNuevo(userId, sub, { borrarFilaVieja: true, vale }))
    }
    return { activo: true, error: null }
  }
  // Durante un cierre de sesión no se re-registra nada (undécima auditoría).
  if (cerrandoSesion()) return nada
  // Una suscripción que no es de esta cuenta y que esta cuenta no pidió es de
  // OTRA persona (celular compartido): se da de baja, no se la apropia
  // (auditoría 19). Sin suscripción, el backend ya no le escribe a la otra.
  if (!cuentaPidioAvisos(userId)) {
    try { await sub.unsubscribe() } catch { /* se reintenta la próxima vez */ }
    return nada
  }
  // Esta cuenta los pidió acá, el navegador tiene suscripción y la base no
  // tiene la fila. Lo más probable es que la haya borrado el backend porque
  // el proveedor la rechazó (vencida, o con la llave vieja): volver a
  // guardar el MISMO endpoint traería de vuelta una fila muerta que el
  // próximo envío borra otra vez. Se suscribe de nuevo (vigésima auditoría).
  // No si la suscripción es nueva: la que acabamos de crear, o una que
  // creamos antes y no se pudo guardar (`esSinGuardar`). Esas se guardan.
  if (!recien && estadoPermiso() === 'granted' && !esSinGuardar(userId, sub.endpoint)) {
    return await reintentoConError(() => suscribirDeNuevo(userId, sub, { vale }))
  }
  try {
    await guardarSuscripcion(userId, sub)
  } catch (e) {
    if (!vale()) return nada
    if (e?.ajena) return await reintentoConError(() => reemplazarAjena(userId, sub, vale))
    recordarSinGuardar(userId, sub.endpoint)
    return { activo: false, error: NO_SE_PUDO_REGISTRAR }
  }
  olvidarSinGuardar(userId)
  marcarAvisosDeCuenta(userId, true)
  return { activo: true, error: null }
}

/** Lo que el Hub necesita: ¿quedó activo? */
export async function avisosActivos (userId, sigueVigente = () => true) {
  try {
    return (await revisarAvisos(userId, sigueVigente)).activo
  } catch {
    return false
  }
}

/* ¿Esta CUENTA pidió avisos en este dispositivo? (auditoría del 28 sep 2026)
   El permiso del navegador es del ORIGEN, no de la cuenta: con `granted`, la
   auto-sanación del Perfil volvía a suscribir a quien había pulsado
   «Desactivar» (bastaba con volver a abrir el Perfil), y en un celular
   compartido suscribía a la cuenta siguiente sin que lo pidiera. Solo se
   re-suscribe sola una cuenta que los activó acá y no los desactivó. */
const claveActivos = (userId) => `avisosPush:activos:${userId}`

export function marcarAvisosDeCuenta (userId, activos) {
  if (!userId) return
  try {
    if (activos) localStorage.setItem(claveActivos(userId), '1')
    else localStorage.removeItem(claveActivos(userId))
  } catch { /* modo privado: sin marca no hay auto-alta, que es lo prudente */ }
}

export function cuentaPidioAvisos (userId) {
  if (!userId) return false
  try { return localStorage.getItem(claveActivos(userId)) === '1' } catch { return false }
}

/** Vuelve a suscribir ESTE navegador si la cuenta los pidió acá y el permiso
 *  sigue dado. Devuelve la suscripción nueva o null. Nunca lanza.
 *  `vale` se mira antes de suscribir: si ya entró otra cuenta, no se crea
 *  nada a nombre de la anterior. */
export async function resuscribirSiLosPidio (userId, vale = () => true) {
  try {
    if (!userId || !vale() || estadoPermiso() !== 'granted' || cerrandoSesion() || !cuentaPidioAvisos(userId)) return null
    const reg = await swListo()
    if (!reg || !vale()) return null
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
    // Si cambió la cuenta mientras el navegador respondía, la suscripción
    // (que es del dispositivo) queda para la revisión de la cuenta nueva.
    return vale() ? sub : null
  } catch {
    return null
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
  marcarAvisosDeCuenta(userId, true)
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
/* Cierre por INACTIVIDAD (auditoría 19): la persona no eligió salir, y el
   resumen de las 6 am es justo lo que la trae de vuelta. Ese cierre no da de
   baja el dispositivo, y esta marca le avisa a `bajaSinSesion` que la
   suscripción que quedó es de quien se durmió, no de alguien que se fue. Si
   después entra OTRA cuenta, `avisosActivos`/el Perfil la ven ajena y la dan
   de baja. Se borra al entrar. */
export const CLAVE_CONSERVAR = 'avisosPush:conservarTrasInactividad'

export function marcarConservarAvisos () {
  try { localStorage.setItem(CLAVE_CONSERVAR, '1') } catch { /* modo privado */ }
}
export function olvidarMarcaConservar () {
  try { localStorage.removeItem(CLAVE_CONSERVAR) } catch { /* modo privado */ }
}
function conservarAvisos () {
  try { return localStorage.getItem(CLAVE_CONSERVAR) === '1' } catch { return false }
}

/* BAJA PENDIENTE (10 oct 2026). `bajaSinSesion` daba de baja CUALQUIER
   suscripción que encontrara sin sesión, y quedarse sin sesión no siempre es
   elegir salir: una renovación de token rechazada (400/403/429/500), un cierre
   en OTRO dispositivo —que era global— o la inactividad de otra pestaña
   también terminan en SIGNED_OUT. Reproducido con auth-js real: los cuatro
   códigos daban de baja los avisos de alguien que los había pedido, y desde el
   27 de sep el grupo los fue perdiendo sin saberlo.
   Ahora solo se da de baja lo que un cierre VOLUNTARIO de este dispositivo
   dejó a medias: `olvidarDispositivo` deja esta marca antes de intentar y la
   quita cuando la baja del navegador sale bien. Al entrar se borra. */
export const CLAVE_BAJA_PENDIENTE = 'avisosPush:bajaPendiente'

function marcarBajaPendiente () {
  try { localStorage.setItem(CLAVE_BAJA_PENDIENTE, '1') } catch { /* modo privado */ }
}
export function olvidarBajaPendiente () {
  try { localStorage.removeItem(CLAVE_BAJA_PENDIENTE) } catch { /* modo privado */ }
}
function hayBajaPendiente () {
  try { return localStorage.getItem(CLAVE_BAJA_PENDIENTE) === '1' } catch { return false }
}

export const CLAVE_CERRANDO = 'avisosPush:cerrando'
const VIDA_MARCA_MS = 60 * 1000
export const PRESUPUESTO_CIERRE_MS = 4000

function marcarCierre () {
  try { localStorage.setItem(CLAVE_CERRANDO, String(Date.now())) } catch { /* modo privado */ }
}

/** El cierre de sesión FALLÓ y la persona sigue adentro: se quitan las marcas
 *  del cierre. Una baja pendiente olvidada daría de baja sus avisos la próxima
 *  vez que perdiera la sesión sin elegirlo (revisión del 11 oct 2026). */
export function cancelarCierre () {
  olvidarBajaPendiente()
  try { localStorage.removeItem(CLAVE_CERRANDO) } catch { /* modo privado */ }
}

/** ¿Hay un cierre de sesión en curso (en esta pestaña o en otra)? */
export function cerrandoSesion (ahora = Date.now()) {
  try {
    const t = parseInt(localStorage.getItem(CLAVE_CERRANDO), 10)
    return Number.isFinite(t) && ahora - t < VIDA_MARCA_MS
  } catch { return false }
}

/* `sigueVigente` (decimosexta auditoría): `Promise.race` limita la ESPERA pero
   no cancela el trabajo. Si el cierre se da por vencido y otra cuenta entra
   antes de que el navegador responda, la suscripción que aparece es la de la
   cuenta NUEVA: darla de baja le quitaría sus avisos. Por eso, pasada cada
   espera, el trabajo pregunta si sigue siendo el suyo antes de tocar nada. */
export async function olvidarDispositivo (userId, sigueVigente = () => true) {
  marcarCierre()
  marcarBajaPendiente()
  let enPlazo = true
  const vale = () => enPlazo && sigueVigente()
  const trabajo = (async () => {
    // «El navegador no contestó» NO es «no hay suscripción» (revisión del 11
    // oct 2026): con un service worker lento, `suscripcionLocal()` da null y
    // borrar la marca dejaba el dispositivo suscrito a nombre de quien salió.
    // Si no contesta o lanza, la marca queda y la próxima apertura reintenta.
    const reg = await swListo()
    if (!reg) return
    const sub = await reg.pushManager.getSubscription()
    if (!sub) { if (vale()) olvidarBajaPendiente(); return }
    if (!vale()) return
    const endpoint = sub.endpoint
    try {
      await sub.unsubscribe()
      olvidarBajaPendiente()
    } catch { /* la fila igual se intenta borrar; la próxima apertura reintenta la baja */ }
    if (userId && vale()) {
      await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', endpoint)
    }
  })().catch(() => {})
  // Cerrar sesión importa más que esto: pase lo que pase, se sigue.
  await Promise.race([trabajo, new Promise((resolve) => setTimeout(resolve, PRESUPUESTO_CIERRE_MS))])
  enPlazo = false
}

/* Al ABRIR la app SIN sesión (duodécima auditoría): si un cierre VOLUNTARIO
   de este dispositivo quedó a medias (`CLAVE_BAJA_PENDIENTE`), la suscripción
   que sigue viva es de alguien que eligió salir y cuyo cierre no pudo
   darla de baja —sin red, `unsubscribe()` y el DELETE fallan—. Sin esa marca
   no se toca nada (10 oct 2026): perder la sesión sin elegirlo no es pedir
   que dejen de llegar los avisos. Sin sesión no
   hay cuenta a la que avisar: se da de baja en el navegador y, cuando el
   backend le escriba, el proveedor responde 410 y la fila se limpia sola (90).
   Nunca lanza ni espera más que el service worker.

   «Sin sesión» tiene que seguir siendo cierto AL DAR DE BAJA, no solo al
   decidirlo (decimotercera auditoría): mientras se espera al service worker
   puede llegar un SIGNED_IN —en esta pestaña o en otra— y la baja se llevaba
   los avisos de quien acaba de entrar. Por eso, después de cada espera, se
   pregunta otra vez: a quien llamó (`sigueSinSesion`, que sabe de los eventos
   de esta pestaña) y al almacenamiento de la sesión (`getSession`, que ve
   también lo que escribió otra pestaña). Ante la duda —una respuesta que no
   llega— no se da de baja: perder los avisos de alguien con sesión es peor que
   dejar una suscripción huérfana hasta la próxima apertura. */
export async function bajaSinSesion (sigueSinSesion = () => true) {
  // Sin un cierre voluntario a medias, una suscripción sin sesión es de alguien
  // que perdió la sesión SIN elegirlo: sus avisos se quedan (10 oct 2026).
  if (!hayBajaPendiente() || conservarAvisos()) return
  try {
    const sub = await suscripcionLocal()
    if (!sub || !sigueSinSesion()) return
    const sesion = await Promise.race([
      // Un error de Auth NO es «no hay sesión»: con una renovación fallida
      // devuelve `session: null` y la sesión sigue guardada (decimosexta
      // auditoría). Ante un error, como ante el silencio, no se da de baja.
      supabase.auth.getSession().then(({ data, error }) => (error ? 'sin-respuesta' : data?.session ?? null)),
      new Promise((resolve) => setTimeout(() => resolve('sin-respuesta'), LIMITE_SW_MS)),
    ])
    if (sesion !== null || !sigueSinSesion()) return
    await sub.unsubscribe()
    olvidarBajaPendiente()
  } catch { /* se vuelve a intentar en la próxima apertura */ }
}

/** Baja en este dispositivo. La marca se quita PRIMERO: aunque falle lo
 *  demás, la auto-sanación ya no vuelve a suscribir a esta cuenta. */
export async function desactivarPush (userId) {
  marcarAvisosDeCuenta(userId, false)
  if (!soportaPush()) return
  const reg = await swListo()
  if (!reg) throw new Error(SW_NO_LISTO)
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  await sub.unsubscribe()
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
}
