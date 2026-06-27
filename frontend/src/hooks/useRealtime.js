import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useGlobalRealtime() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const channel = supabase.channel('global-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, (payload) => {
        // En vez de re-descargar TODOS los partidos en cada cambio (eso disparaba
        // el egress de PostgREST en vivo), parcheamos en memoria solo el partido
        // que cambió usando el dato que ya viene en el evento (cero consultas).
        const row = payload.new
        if (payload.eventType === 'UPDATE' && row && row.id != null) {
          queryClient.setQueriesData({ queryKey: ['matches'] }, (old) => {
            if (!Array.isArray(old)) return old
            let changed = false
            const next = old.map((m) => {
              if (m.id === row.id) { changed = true; return { ...m, ...row } }
              return m
            })
            return changed ? next : old
          })
        } else {
          // INSERT / DELETE (raro): ahí sí refrescamos la lista.
          queryClient.invalidateQueries({ queryKey: ['matches'] })
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'predictions' }, () => {
        queryClient.invalidateQueries({ queryKey: ['predictions'] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => {
        queryClient.invalidateQueries({ queryKey: ['leaderboard'] })
        queryClient.invalidateQueries({ queryKey: ['user_stats'] })
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [queryClient])
}
