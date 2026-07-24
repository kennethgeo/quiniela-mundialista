import { useEffect } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Mientras la app esté abierta (en cualquier pantalla) y haya algún partido en
 * curso, le pide al backend sincronizar cada 30s. Así el marcador y el cálculo
 * de puntos al finalizar avanzan sin depender del cron, sin importar en qué
 * página esté el usuario. El endpoint tiene throttle (1 sync/20s), así que es
 * seguro aunque varias pestañas lo llamen.
 */
export function useLiveSync() {
  useEffect(() => {
    let interval = null

    const tick = () => {
      fetch('/_backend/api/matches/refresh-live', { method: 'POST' }).catch(() => {})
    }

    const update = async () => {
      try {
        // "En vivo" = ya en curso, O ya arrancó (kickoff en las últimas ~4h) pero
        // sigue 'pending' porque el sync todavía no lo pasó a in_progress. Sin esto
        // había un bloqueo circular: la Liga CR nunca arrancaba el polling.
        const nowIso = new Date().toISOString()
        const cutoff = new Date(Date.now() - 4 * 3600 * 1000).toISOString()
        const { data } = await supabase
          .from('matches')
          .select('id')
          .in('status', ['pending', 'in_progress'])
          .lte('kickoff_at', nowIso)
          .gte('kickoff_at', cutoff)
          .limit(1)
        const hasLive = (data?.length || 0) > 0
        if (hasLive && !interval) {
          tick()
          interval = setInterval(tick, 30000)
        } else if (!hasLive && interval) {
          clearInterval(interval)
          interval = null
        }
      } catch {
        /* ignorar */
      }
    }

    update()

    const channel = supabase
      .channel('live-sync-global')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, update)
      .subscribe()

    return () => {
      if (interval) clearInterval(interval)
      supabase.removeChannel(channel)
    }
  }, [])
}
