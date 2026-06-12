/* Lista de partidos finalizados (todas las fases) con acceso al detalle */
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { CheckCircle2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import MatchCard from './MatchCard'
import LoadingSpinner from '../ui/LoadingSpinner'

export default function FinishedMatches() {
  const { profile } = useAuth()

  const { data: matches = [], isLoading: loadingMatches, error } = useQuery({
    queryKey: ['matches', 'finished'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('matches')
        .select('*')
        .eq('status', 'finished')
        .order('kickoff_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  const { data: predictions = [], isLoading: loadingPreds } = useQuery({
    queryKey: ['predictions', profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from('predictions').select('*').eq('user_id', profile.id)
      if (error) throw error
      return data || []
    },
  })

  if (loadingMatches || loadingPreds) return <LoadingSpinner />

  if (error) {
    return (
      <div className="glass-card p-4 border-error/30 text-error text-sm text-center">
        {error.message}
      </div>
    )
  }

  if (matches.length === 0) {
    return (
      <div className="glass-card bg-white dark:bg-transparent p-8 text-center">
        <CheckCircle2 size={32} className="text-slate-400 mx-auto mb-3" />
        <p className="text-slate-600 dark:text-slate-400 text-sm">Aún no hay partidos finalizados</p>
      </div>
    )
  }

  const predByMatch = {}
  predictions.forEach((p) => { predByMatch[p.match_id] = p })

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <p className="text-xs text-slate-500 px-1">{matches.length} {matches.length === 1 ? 'partido finalizado' : 'partidos finalizados'}</p>
      {matches.map((match) => (
        <MatchCard
          key={match.id}
          match={match}
          prediction={predByMatch[match.id]}
          onSavePrediction={() => {}}
          isLoading={false}
          hasReachedLimit={false}
          powerupsUsed={0}
          powerupLimit={0}
        />
      ))}
    </motion.div>
  )
}
