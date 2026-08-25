// Edge Function: aviso push ~45 min antes del saque.
//
// Solo se avisa a quien LE FALTA predecir. Antes le llegaba a todo el miembro
// del torneo, hubiera predicho o no, y un recordatorio que suena aunque ya
// hiciste la tarea se vuelve ruido: la gente lo silencia y después se pierde
// el aviso que sí importaba.
//
// Y se manda UN push por persona, no uno por partido. En una jornada con
// cinco partidos a la misma hora, cinco notificaciones seguidas son la manera
// más rápida de que alguien apague las notificaciones para siempre.
//
// (Antes de esto ya se había arreglado otro bug: buscaba los partidos sin
// filtrar por torneo y los mandaba a TODAS las suscripciones, así que llegaban
// avisos de ligas en las que uno ni juega. El filtro por torneo sigue acá.)
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'https://esm.sh/web-push@3.6.7'
import { faltantesPorUsuario, armarPayload } from './logica.js'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const publicVapidKey = 'BEZacx8-hHDBW6kekpy-K-ZBU4LRHttGOK32Bm5IsAGCkt_lhSGKaXpmhRJCQh3voZnWCHS7gv52_jCqkgP_4DQ'
const privateVapidKey = Deno.env.get('VAPID_PRIVATE_KEY')!

webpush.setVapidDetails(
  'mailto:admin@quinielamundialista.com',
  publicVapidKey,
  privateVapidKey,
)

// Manda un push y limpia la suscripción si el navegador ya la dio de baja.
async function enviar(supabase, sub, payload) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
    )
    return true
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      await supabase.from('push_subscriptions').delete().eq('id', sub.id)
    } else {
      console.error('Error enviando push', err)
    }
    return false
  }
}

serve(async (req) => {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Modo prueba: ?test=1 manda una notificación a todos los suscritos.
    // Acá sí va a todos a propósito — es la prueba manual del admin.
    const isTest = new URL(req.url).searchParams.get('test') === '1'
    if (isTest) {
      const { data: subs } = await supabase.from('push_subscriptions').select('*')
      const payload = JSON.stringify({
        title: '🔔 Notificación de prueba',
        body: 'Si ves esto, las notificaciones push funcionan correctamente. ¡Listo!',
        url: '/',
      })
      let sent = 0
      for (const sub of subs || []) {
        if (await enviar(supabase, sub, payload)) sent++
      }
      return new Response(JSON.stringify({ test: true, sent }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    const now = new Date()
    const desde = new Date(now.getTime() + 45 * 60000)
    const hasta = new Date(now.getTime() + 50 * 60000)

    const { data: matches, error: matchError } = await supabase
      .from('matches')
      .select('id, home_team, away_team, kickoff_at, tournament_id, status')
      .gte('kickoff_at', desde.toISOString())
      .lt('kickoff_at', hasta.toISOString())

    if (matchError) throw matchError

    // Un partido suspendido o pospuesto no se avisa.
    const proximos = (matches || []).filter(
      (m) => m.status !== 'cancelled' && m.status !== 'postponed',
    )
    if (proximos.length === 0) {
      return new Response(JSON.stringify({ message: 'Sin partidos en ~45 min' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // Quién juega cada torneo: miembros de las quinielas de ese torneo.
    const torneos = [...new Set(proximos.map((m) => m.tournament_id))]
    const { data: ligas } = await supabase
      .from('leagues').select('id, tournament_id').in('tournament_id', torneos)

    const ligaIds = (ligas || []).map((l) => l.id)
    const { data: miembros } = ligaIds.length
      ? await supabase.from('league_members').select('league_id, user_id').in('league_id', ligaIds).limit(20000)
      : { data: [] }

    // Quién YA predijo cada uno de estos partidos. Acotado a los partidos de la
    // ventana, así que son pocas filas aunque la tabla sea grande.
    // El límite explícito importa: si PostgREST truncara en su tope por defecto,
    // faltarían filas en 'ya predijo' y le llegaría el recordatorio a gente que
    // sí predijo. Molesto, no grave, pero silencioso.
    const { data: predicciones } = ligaIds.length
      ? await supabase.from('predictions')
          .select('user_id, league_id, match_id')
          .in('match_id', proximos.map((m) => m.id))
          .limit(20000)
      : { data: [] }

    const faltantes = faltantesPorUsuario({
      partidos: proximos,
      ligas: ligas || [],
      miembros: miembros || [],
      predicciones: predicciones || [],
    })

    if (faltantes.size === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          matches_en_ventana: proximos.length,
          message: 'Todos predijeron: nadie necesita recordatorio',
          sent: 0,
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 },
      )
    }

    // Las suscripciones se leen UNA vez, no una por partido como antes.
    const { data: subs } = await supabase
      .from('push_subscriptions').select('*').in('user_id', [...faltantes.keys()])
    const subsPorUsuario = new Map()
    for (const s of subs || []) {
      if (!subsPorUsuario.has(s.user_id)) subsPorUsuario.set(s.user_id, [])
      subsPorUsuario.get(s.user_id).push(s)
    }

    let notificationsSent = 0
    for (const [userId, pendientes] of faltantes) {
      const payload = JSON.stringify(armarPayload(pendientes))
      for (const sub of subsPorUsuario.get(userId) || []) {
        if (await enviar(supabase, sub, payload)) notificationsSent++
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        matches_en_ventana: proximos.length,
        personas_con_pendientes: faltantes.size,
        sent: notificationsSent,
      }),
      { headers: { 'Content-Type': 'application/json' }, status: 200 },
    )
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
