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
      // 1. Obtener todos los subs
      const { data: subs, error: subError } = await supabase.from('push_subscriptions').select('*')
      if (subError || !subs) continue

      // 2. Obtener usuarios que YA predijeron
      const { data: preds } = await supabase
        .from('predictions')
        .select('user_id')
        .eq('match_id', match.id)

      const usersWithPrediction = new Set(preds?.map(p => p.user_id) || [])

      // 3. Filtrar subs de usuarios que NO han predicho
      const usersToNotify = subs.filter(sub => !usersWithPrediction.has(sub.user_id))

      const payload = JSON.stringify({
        title: '⚽ ¡Faltan ~45 minutos!',
        body: `${match.home_team} vs ${match.away_team} está por comenzar. Aún no has hecho tu predicción — ¡hazla antes de que se cierre!`,
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
