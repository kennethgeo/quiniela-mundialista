import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { Bell, BellOff, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

// Llave pública VAPID. DEBE coincidir con la llave privada usada por el
// emisor (edge function `notify-upcoming` y backend). Si se rota, hay que
// actualizarla en los tres lugares a la vez.
const VAPID_PUBLIC_KEY = 'BEZacx8-hHDBW6kekpy-K-ZBU4LRHttGOK32Bm5IsAGCkt_lhSGKaXpmhRJCQh3voZnWCHS7gv52_jCqkgP_4DQ'

// Utilidad para convertir la llave VAPID
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/')

  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

// Compara la llave applicationServerKey de una suscripción existente con la actual.
function sameApplicationServerKey(existing, current) {
  if (!existing) return false // no podemos saberlo → no migramos
  const a = new Uint8Array(existing)
  if (a.length !== current.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== current[i]) return false
  }
  return true
}

export default function PushNotificationToggle() {
  const { profile } = useAuth()
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    checkSubscription()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  const persistSubscription = async (subscription) => {
    if (!profile?.id) return
    const subData = JSON.parse(JSON.stringify(subscription))
    // delete-then-insert por endpoint (las políticas RLS permiten DELETE/INSERT,
    // no UPDATE) para no chocar con la restricción UNIQUE al re-suscribir.
    await supabase.from('push_subscriptions').delete().eq('endpoint', subData.endpoint)
    await supabase.from('push_subscriptions').insert({
      user_id: profile.id,
      endpoint: subData.endpoint,
      p256dh: subData.keys.p256dh,
      auth: subData.keys.auth,
    })
  }

  const checkSubscription = async () => {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setLoading(false)
        return
      }

      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()

      if (!subscription) {
        setIsSubscribed(false)
        return
      }

      // ¿La suscripción usa una llave VAPID antigua? Si el permiso ya está
      // concedido, la migramos automáticamente (sin pedir nada al usuario)
      // para que vuelva a recibir notificaciones con la llave nueva.
      const currentKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      const matches = sameApplicationServerKey(subscription.options?.applicationServerKey, currentKey)

      if (!matches && profile?.id && Notification.permission === 'granted') {
        try {
          const oldEndpoint = subscription.endpoint
          await subscription.unsubscribe()
          await supabase.from('push_subscriptions').delete().eq('endpoint', oldEndpoint)
          const newSub = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: currentKey,
          })
          await persistSubscription(newSub)
          setIsSubscribed(true)
          return
        } catch (migErr) {
          console.error('Error migrando suscripción push:', migErr)
          setIsSubscribed(false)
          return
        }
      }

      setIsSubscribed(true)
    } catch (err) {
      console.error('Error checking push subscription:', err)
    } finally {
      setLoading(false)
    }
  }

  const toggleSubscription = async () => {
    try {
      setLoading(true)
      setError(null)

      const registration = await navigator.serviceWorker.ready

      if (isSubscribed) {
        // Desuscribirse
        const subscription = await registration.pushManager.getSubscription()
        if (subscription) {
          await subscription.unsubscribe()
          // Eliminar de Supabase
          await supabase
            .from('push_subscriptions')
            .delete()
            .eq('endpoint', subscription.endpoint)
        }
        setIsSubscribed(false)
      } else {
        // Suscribirse
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') {
          throw new Error('Permiso denegado para notificaciones')
        }

        // Limpia cualquier suscripción previa (p.ej. con una llave VAPID vieja)
        // para evitar InvalidStateError al suscribir con la llave actual.
        const existing = await registration.pushManager.getSubscription()
        if (existing) {
          await existing.unsubscribe()
          await supabase.from('push_subscriptions').delete().eq('endpoint', existing.endpoint)
        }

        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        })

        await persistSubscription(subscription)
        setIsSubscribed(true)
      }
    } catch (err) {
      console.error('Push error:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return null // El navegador no soporta Push
  }

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
          onClick={toggleSubscription}
          disabled={loading}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            isSubscribed ? 'bg-accent' : 'bg-slate-300 dark:bg-slate-600'
          }`}
        >
          {loading ? (
            <Loader2 size={14} className="absolute left-1/2 -translate-x-1/2 text-white animate-spin" />
          ) : (
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                isSubscribed ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          )}
        </button>
        {error && <span className="text-[9px] text-error">{error}</span>}
      </div>
    </div>
  )
}
