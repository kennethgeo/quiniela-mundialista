/* Lista de partidos finalizados (todas las fases) con acceso al detalle */
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { CheckCircle2, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import MatchCard from './MatchCard'
import LoadingSpinner from '../ui/LoadingSpinner'

export default function FinishedMatches() {
  const { profile } = useAuth()
  const navigate = useNavigate()

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
      <p className="text-xs text-slate-500 px-1">{matches.length} {matches.length === 1 ? 'partido finalizado' : 'partidos finalizados'} · toca para ver las predicciones de la liga</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        {matches.map((match) => (
          <div
            key={match.id}
            onClick={() => navigate(`/match/${match.id}`)}
            className="cursor-pointer rounded-2xl transition-shadow hover:ring-1 hover:ring-accent/40"
          >
            <MatchCard
              match={match}
              prediction={predByMatch[match.id]}
              onSavePrediction={() => {}}
              isLoading={false}
              hasReachedLimit={false}
              powerupsUsed={0}
              powerupLimit={0}
            />
            <div className="flex items-center justify-center gap-1 text-[11px] font-semibold text-purple-600 dark:text-purple-400 -mt-2 pb-1">
              Ver predicciones de la liga <ChevronRight size={12} />
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  )
}
