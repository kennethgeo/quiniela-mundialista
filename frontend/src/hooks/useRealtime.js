import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useGlobalRealtime() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const channel = supabase.channel('global-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, (payload) => {
        console.log('Realtime Match Update:', payload)
        // Invalidate all matches queries
        queryClient.invalidateQueries({ queryKey: ['matches'] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'predictions' }, (payload) => {
        console.log('Realtime Prediction Update:', payload)
        // Invalidate predictions
        queryClient.invalidateQueries({ queryKey: ['predictions'] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, (payload) => {
        console.log('Realtime Users Update:', payload)
        // Invalidate leaderboard and stats
        queryClient.invalidateQueries({ queryKey: ['leaderboard'] })
        queryClient.invalidateQueries({ queryKey: ['user_stats'] })
      })
      .subscribe((status) => {
        console.log('Global Realtime subscription status:', status)
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [queryClient])
}
