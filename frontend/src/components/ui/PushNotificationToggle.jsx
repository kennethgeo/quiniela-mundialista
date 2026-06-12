import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { Bell, BellOff, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

const VAPID_PUBLIC_KEY = 'BPwgdqT0yBA36k0bpYgo2coMCCnFIkel5nV8lQyARE-bV6lQRrYy76n9b0RRPAdf42k6pZv1-To2TbLI5r_gnVE'

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

export default function PushNotificationToggle() {
  const { profile } = useAuth()
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    checkSubscription()
  }, [])

  const checkSubscription = async () => {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setLoading(false)
        return
      }

      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      
      setIsSubscribed(!!subscription)
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

        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        })

        // Guardar en Supabase
        const subData = JSON.parse(JSON.stringify(subscription))
        const { error: dbError } = await supabase
          .from('push_subscriptions')
          .insert({
            user_id: profile.id,
            endpoint: subData.endpoint,
            p256dh: subData.keys.p256dh,
            auth: subData.keys.auth
          })

        if (dbError) throw dbError
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
          <p className="text-[10px] text-slate-500 max-w-[200px]">Te avisaremos 30 min antes de que cierre la predicción si no la has hecho.</p>
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
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              isSubscribed ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
        {error && <span className="text-[9px] text-error">{error}</span>}
      </div>
    </div>
  )
}
