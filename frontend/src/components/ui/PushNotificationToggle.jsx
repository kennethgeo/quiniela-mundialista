/* Interruptor de notificaciones del Perfil.

   La lógica de alta y baja vive en `lib/notificaciones`, compartida con el
   aviso del Hub: tenerla escrita dos veces terminaría en que una pantalla
   guarda la suscripción y la otra no, y la persona creería tener avisos que
   nunca le van a llegar.

   Lo propio de este componente es la AUTO-SANACIÓN: si el permiso sigue
   concedido pero la suscripción se perdió —pasa al actualizar la app o el
   service worker— se vuelve a suscribir en silencio. Sin eso alguien se queda
   sin avisos sin haber tocado nada y sin manera de notarlo. */
import { useState, useEffect } from 'react'
import { Bell, BellOff, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import {
  soportaPush, activarPush, desactivarPush, guardarSuscripcion,
  urlBase64ToUint8Array, VAPID_PUBLIC_KEY,
} from '../../lib/notificaciones'

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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let vigente = true

    const revisar = async () => {
      try {
        if (!soportaPush()) return
        const registration = await navigator.serviceWorker.ready
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

        // Por si se perdió la fila en la base. Es idempotente.
        if (profile?.id) await guardarSuscripcion(profile.id, sub)
        if (vigente) setIsSubscribed(true)
      } catch (err) {
        console.error('Error checking push subscription:', err)
      } finally {
        if (vigente) setLoading(false)
      }
    }

    revisar()
    return () => { vigente = false }
  }, [profile?.id])

  const alternar = async () => {
    setLoading(true); setError(null)
    try {
      if (isSubscribed) {
        await desactivarPush()
        setIsSubscribed(false)
      } else {
        await activarPush(profile?.id)
        setIsSubscribed(true)
      }
    } catch (err) {
      console.error('Push error:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (!soportaPush()) return null

  return (
    <div className="glass-card p-4 mt-6 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${isSubscribed ? 'bg-accent/20 text-accent' : 'bg-slate-100 dark:bg-white/5 text-slate-400'}`}>
          {isSubscribed ? <Bell size={18} /> : <BellOff size={18} />}
        </div>
        <div>
          <p className="text-sm font-bold text-slate-900 dark:text-white">Recordatorios de Partido</p>
          <p className="text-[10px] text-slate-500 max-w-[200px]">Te avisaremos ~45 min antes de cada partido para que no se te pase tu predicción.</p>
        </div>
      </div>

      <div className="flex flex-col items-end gap-1">
        <button
          onClick={alternar}
          disabled={loading}
          aria-label={isSubscribed ? 'Desactivar notificaciones' : 'Activar notificaciones'}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            isSubscribed ? 'bg-accent' : 'bg-slate-300 dark:bg-slate-600'
          }`}
        >
          {loading ? (
            <Loader2 size={14} className="absolute left-1/2 -translate-x-1/2 text-white animate-spin" />
          ) : (
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              isSubscribed ? 'translate-x-6' : 'translate-x-1'
            }`} />
          )}
        </button>
        {error && <span className="text-[9px] text-error">{error}</span>}
      </div>
    </div>
  )
}
