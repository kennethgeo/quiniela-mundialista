/* Interruptor de notificaciones del Perfil.

   La lógica de alta y baja vive en `lib/notificaciones`, compartida con el
   aviso del Hub: tenerla escrita dos veces terminaría en que una pantalla
   guarda la suscripción y la otra no, y la persona creería tener avisos que
   nunca le van a llegar.

   VA ARRIBA DEL PERFIL Y SE HACE NOTAR mientras falten: antes era un
   interruptor chico al fondo, debajo de las medallas, y a más de la mitad del
   grupo no le llegaba ningún aviso. Con los avisos ya activos se achica a una
   línea de confirmación: una vez resuelto, no tiene por qué ocupar la pantalla.

   Lo propio de este componente es la AUTO-SANACIÓN: si el permiso sigue
   concedido pero la suscripción se perdió —pasa al actualizar la app o el
   service worker— se vuelve a suscribir en silencio. Sin eso alguien se queda
   sin avisos sin haber tocado nada y sin manera de notarlo. */
import { useState, useEffect } from 'react'
import { Bell, BellOff, Loader2, Check, Sun, Clock, Share, Lock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import {
  soportaPush, activarPush, desactivarPush, guardarSuscripcion, swListo,
  urlBase64ToUint8Array, VAPID_PUBLIC_KEY, estadoPermiso, necesitaInstalarPrimero,
} from '../../lib/notificaciones'
import { situacionAvisos, olvidarPospuesto } from '../../lib/avisoPush'

/* ¿La llave de la suscripción difiere POSITIVAMENTE de la actual? Si no se
   puede saber (el navegador no la expone) devolvemos false para NO migrar: si
   no, se re-suscribiría en cada carga y los endpoints cambiarían sin parar. */
function llaveDistinta (existente, actual) {
  if (!existente) return false
  const a = new Uint8Array(existente)
  if (a.length !== actual.length) return true
  for (let i = 0; i < a.length; i++) if (a[i] !== actual[i]) return true
  return false
}

export default function PushNotificationToggle () {
  const { profile } = useAuth()
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [permiso, setPermiso] = useState(estadoPermiso())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // Hasta revisar este dispositivo no se sabe si ya los tiene: pintar la
  // tarjeta grande y achicarla medio segundo después sería un salto feo
  // justo para quien ya hizo todo bien.
  const [revisado, setRevisado] = useState(false)

  useEffect(() => {
    let vigente = true

    const revisar = async () => {
      try {
        if (!soportaPush()) return
        // Con límite: sin él, un service worker que nunca se pone listo
        // dejaba el botón en «Un momento…» para siempre (novena auditoría).
        const registration = await swListo()
        if (!registration) {
          if (vigente) {
            setIsSubscribed(false)
            setError('El navegador no terminó de preparar los avisos. Recargá la página y probá de nuevo.')
          }
          return
        }
        const actual = urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        let sub = await registration.pushManager.getSubscription()

        // Auto-sanación: permiso concedido pero sin suscripción.
        if (!sub && profile?.id && Notification.permission === 'granted') {
          try {
            sub = await registration.pushManager.subscribe({
              userVisibleOnly: true, applicationServerKey: actual,
            })
          } catch (e) { console.error('Auto-resuscripción falló:', e) }
        }
        if (!sub) { if (vigente) setIsSubscribed(false); return }

        // Llave VAPID vieja: migrar.
        if (profile?.id && Notification.permission === 'granted' &&
            llaveDistinta(sub.options?.applicationServerKey, actual)) {
          try {
            const viejo = sub.endpoint
            await sub.unsubscribe()
            await supabase.from('push_subscriptions').delete().eq('endpoint', viejo)
            sub = await registration.pushManager.subscribe({
              userVisibleOnly: true, applicationServerKey: actual,
            })
          } catch (e) {
            console.error('Error migrando suscripción push:', e)
            if (vigente) setIsSubscribed(false)
            return
          }
        }

        // Por si se perdió la fila en la base. Es idempotente. Si falla, NO
        // está activo: el backend manda a lo que hay en la base, no a lo que
        // tiene el navegador. Antes el error iba solo a la consola y la
        // tarjeta podía seguir diciendo «activados».
        if (profile?.id) {
          try {
            await guardarSuscripcion(profile.id, sub)
          } catch (e) {
            console.error('No se pudo registrar la suscripción:', e)
            if (vigente) {
              setIsSubscribed(false)
              setError(e?.message?.startsWith('Este dispositivo')
                ? e.message
                : 'No pudimos registrar este dispositivo. Tocá «Activar avisos» para reintentar.')
            }
            return
          }
        }
        if (vigente) setIsSubscribed(true)
      } catch (err) {
        console.error('Error checking push subscription:', err)
        if (vigente) setIsSubscribed(false)
      } finally {
        if (vigente) { setLoading(false); setRevisado(true) }
      }
    }

    revisar()
    return () => { vigente = false }
  }, [profile?.id])

  const activar = async () => {
    setLoading(true); setError(null)
    try {
      await activarPush(profile?.id)
      olvidarPospuesto()
      setIsSubscribed(true)
    } catch (err) {
      console.error('Push error:', err)
      setError(err.message)
    } finally {
      setPermiso(estadoPermiso())
      setLoading(false)
    }
  }

  const desactivar = async () => {
    setLoading(true); setError(null)
    try {
      await desactivarPush()
      setIsSubscribed(false)
    } catch (err) {
      console.error('Push error:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const situacion = situacionAvisos({
    soporta: soportaPush(), iosSinInstalar: necesitaInstalarPrimero(),
    permiso, suscrito: isSubscribed,
  })

  // Ni instalando se podría: no se ofrece nada que no pueda funcionar.
  if (situacion === 'sin-soporte') return null
  /* Solo con permiso concedido puede resultar «activo», así que solo ahí se
     espera. La espera tiene límite (`swListo`): si el service worker no se
     pone listo nunca, la tarjeta sale igual, con el botón usable. */
  if (!revisado && permiso === 'granted') return null

  if (situacion === 'activo') {
    return (
      <section aria-label="Notificaciones"
        className="rounded-2xl border border-slate-200 dark:border-[#262626] bg-white dark:bg-[#161616] p-3.5 mt-4 flex items-center gap-3">
        <div className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center bg-accent/15 text-teal-700 dark:text-accent">
          <Check size={17} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-['Archivo'] font-bold text-[13px] text-slate-900 dark:text-[#F3F1EA]">Avisos activados</p>
          <p className="text-[11px] text-slate-600 dark:text-slate-300">En este dispositivo: los partidos del día a las 6 am y un recordatorio 45 min antes si te falta predecir.</p>
          {error && <p role="alert" className="text-[11px] text-[#FF7A59] mt-1">{error}</p>}
        </div>
        <button type="button" onClick={desactivar} disabled={loading}
          aria-label="Desactivar notificaciones"
          className="shrink-0 -my-1.5 py-1.5 px-2 rounded-lg font-['Archivo'] text-[12px] text-slate-600 dark:text-slate-300 disabled:opacity-50 flex items-center gap-1">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <BellOff size={12} />}
          Desactivar
        </button>
      </section>
    )
  }

  /* Sin avisos: la tarjeta se hace notar. Borde y fondo del acento, qué se
     recibe exactamente (la gente dice que no a «notificaciones» en abstracto
     y que sí a «te aviso si te falta predecir»), y un botón grande.

     CONTRASTE MEDIDO, no supuesto: el acento #2ED3B7 como texto sobre su
     propio fondo da 1.74:1 en claro. En claro el botón es teal-700 con texto
     blanco (5.47:1) y en oscuro el acento con texto casi negro. */
  const bloqueado = situacion === 'bloqueado'
  const faltaInstalar = situacion === 'ios-instalar'

  return (
    <section aria-label="Notificaciones"
      className="relative overflow-hidden rounded-2xl border-2 border-teal-600/40 dark:border-accent/50 bg-gradient-to-br from-teal-50 to-white dark:from-accent/10 dark:to-[#161616] p-4 mt-4">
      <div className="flex items-start gap-3">
        <div className="relative shrink-0 w-11 h-11 rounded-full flex items-center justify-center bg-teal-700 text-white dark:bg-accent dark:text-[#0C0C0C]">
          {bloqueado ? <Lock size={19} /> : <Bell size={19} />}
          {/* Un pulso suave, no un parpadeo: llama la atención sin gritar, y
              se apaga para quien pidió menos movimiento. */}
          {!bloqueado && (
            <span aria-hidden="true" className="absolute inset-0 rounded-full ring-2 ring-teal-600/40 dark:ring-accent/50 motion-safe:animate-ping" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-['Archivo'] font-bold text-[15px] text-slate-900 dark:text-[#F3F1EA]">
            {bloqueado ? 'Tenés los avisos bloqueados' : 'Activá los avisos'}
          </p>
          <p className="text-[12px] text-slate-600 dark:text-slate-300 mt-0.5">
            {bloqueado
              ? 'El navegador ya no vuelve a preguntar. Se activan desde los ajustes del navegador, en los permisos de esta página, y después volvé acá.'
              : faltaInstalar
                ? 'En iPhone los avisos solo funcionan con la app instalada.'
                : 'Que no se te pase ninguna predicción. Solo te escribimos cuando hace falta:'}
          </p>
        </div>
      </div>

      {!bloqueado && !faltaInstalar && (
        <ul className="mt-3 space-y-1.5 text-[12px] text-slate-700 dark:text-slate-200">
          <li className="flex items-center gap-2"><Sun size={14} className="shrink-0 text-teal-700 dark:text-accent" /> A las 6 am, los partidos del día</li>
          <li className="flex items-center gap-2"><Clock size={14} className="shrink-0 text-teal-700 dark:text-accent" /> 45 min antes del saque, si te falta predecir</li>
        </ul>
      )}

      {faltaInstalar && (
        <ol className="mt-3 space-y-1.5 text-[12px] text-slate-700 dark:text-slate-200 list-decimal pl-5">
          <li>Tocá <Share size={12} className="inline -mt-0.5" aria-label="Compartir" /> Compartir en Safari</li>
          <li>Elegí «Agregar a inicio»</li>
          <li>Abrí la app desde el ícono y volvé a esta pantalla</li>
        </ol>
      )}

      {error && <p role="alert" className="text-[12px] text-[#C2410C] dark:text-[#FF7A59] mt-2">{error}</p>}

      {!bloqueado && !faltaInstalar && (
        <button type="button" onClick={activar} disabled={loading}
          aria-label="Activar notificaciones"
          className="mt-3.5 w-full rounded-xl py-3 font-['Archivo'] font-bold text-[14px] flex items-center justify-center gap-2 disabled:opacity-60 bg-teal-700 text-white dark:bg-accent dark:text-[#0C0C0C] shadow-sm">
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Bell size={16} />}
          {loading ? 'Un momento…' : 'Activar avisos'}
        </button>
      )}
    </section>
  )
}
