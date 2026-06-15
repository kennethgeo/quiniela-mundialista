import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'https://esm.sh/web-push@3.6.7'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// VAPID keys. La pública DEBE coincidir con la del frontend
// (PushNotificationToggle.jsx) y la privada (VAPID_PRIVATE_KEY, formato raw
// base64url) debe ser su par. Si no coinciden, los navegadores rechazan el push.
const publicVapidKey = 'BEZacx8-hHDBW6kekpy-K-ZBU4LRHttGOK32Bm5IsAGCkt_lhSGKaXpmhRJCQh3voZnWCHS7gv52_jCqkgP_4DQ'
const privateVapidKey = Deno.env.get('VAPID_PRIVATE_KEY')!

webpush.setVapidDetails(
  'mailto:admin@quinielamundialista.com',
  publicVapidKey,
  privateVapidKey
)

serve(async (req) => {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Modo prueba: ?test=1 envía una notificación de prueba a todos los
    // suscritos de inmediato, sin depender de la ventana de 45 min.
    const isTest = new URL(req.url).searchParams.get('test') === '1'
    if (isTest) {
      const { data: subs } = await supabase.from('push_subscriptions').select('*')
      const payload = JSON.stringify({
        title: '🔔 Notificación de prueba',
        body: 'Si ves esto, las notificaciones push funcionan correctamente. ¡Listo!',
        url: '/'
      })
      let sent = 0
      for (const sub of subs || []) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          )
          sent++
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            await supabase.from('push_subscriptions').delete().eq('id', sub.id)
          } else {
            console.error('Error sending test push', err)
          }
        }
      }
      return new Response(JSON.stringify({ test: true, sent }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // Buscar partidos que empiecen en exactamente 45 minutos (se bloquean en 30)
    // Para no enviar duplicados, buscamos en una ventana de 5 minutos
    const now = new Date()
    const targetTimeStart = new Date(now.getTime() + 45 * 60000)
    const targetTimeEnd = new Date(now.getTime() + 50 * 60000)

    const { data: matches, error: matchError } = await supabase
      .from('matches')
      .select('id, home_team, away_team, kickoff_at')
      .gte('kickoff_at', targetTimeStart.toISOString())
      .lt('kickoff_at', targetTimeEnd.toISOString())

    if (matchError) throw matchError
    if (!matches || matches.length === 0) {
      return new Response(JSON.stringify({ message: 'No matches in 45 mins' }), { status: 200 })
    }

    // Por cada partido, notificar a quienes no hayan predicho
    let notificationsSent = 0

    for (const match of matches) {
      // Notificar a TODOS los dispositivos suscritos
      const { data: subs, error: subError } = await supabase.from('push_subscriptions').select('*')
      if (subError || !subs) continue

      const usersToNotify = subs

      const payload = JSON.stringify({
        title: '⚽ ¡Faltan ~45 minutos!',
        body: `${match.home_team} vs ${match.away_team} está por comenzar. ¡Haz o revisa tu predicción antes de que se cierre!`,
        url: `/match/${match.id}`
      })

      // 4. Enviar PUSH
      for (const sub of usersToNotify) {
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth
          }
        }

        try {
          await webpush.sendNotification(pushSubscription, payload)
          notificationsSent++
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            // Sub expirada, borrar de DB
            await supabase.from('push_subscriptions').delete().eq('id', sub.id)
          } else {
            console.error('Error sending push', err)
          }
        }
      }
    }

    return new Response(JSON.stringify({ success: true, sent: notificationsSent }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
