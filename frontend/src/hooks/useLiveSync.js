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
        const { count } = await supabase
          .from('matches')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'in_progress')
        const hasLive = (count || 0) > 0
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
