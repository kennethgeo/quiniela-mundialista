/* Predicciones de fases eliminatorias — bloqueadas hasta que los equipos estén definidos */
import { motion } from 'motion/react'
import { Lock } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { resolveKnockoutTeams } from '../../lib/bracketResolver'
import MatchCard from './MatchCard'
import LoadingSpinner from '../ui/LoadingSpinner'

const KNOCKOUT_PHASES = [
  { key: 'round_of_32', label: 'Ronda de 32' },
  { key: 'round_of_16', label: 'Octavos' },
  { key: 'quarter_finals', label: 'Cuartos' },
  { key: 'semi_finals', label: 'Semifinales' },
  { key: 'third_place', label: '3er Puesto' },
  { key: 'final', label: 'Final' },
]

function LockedKnockoutCard({ phaseDoneHint }) {
  return (
    <div className="glass-card bg-white dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 p-4 md:p-5 opacity-90">
      <div className="flex items-center justify-center gap-1.5 text-[11px] font-semibold text-slate-400 mb-4">
        <Lock size={12} /> {phaseDoneHint}
      </div>
      <div className="flex items-center justify-center gap-6">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <div className="w-12 h-8 rounded bg-slate-100 dark:bg-white/5 flex items-center justify-center text-slate-400 shimmer">?</div>
            <span className="text-xs text-slate-400">Por definir</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function KnockoutStage() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()

  const { data: allMatches = [], isLoading: lm } = useQuery({
    queryKey: ['matches', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('matches').select('*').order('kickoff_at', { ascending: true })
      if (error) throw error
      return data || []
    },
  })

  const { data: predictions = [], isLoading: lp } = useQuery({
    queryKey: ['predictions', profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from('predictions').select('*').eq('user_id', profile.id)
      if (error) throw error
      return data || []
    },
  })

  const { data: powerupLimits = {}, isLoading: ll } = useQuery({
    queryKey: ['powerup_limits'],
    queryFn: async () => {
      const { data } = await supabase.from('powerup_limits').select('*')
      const o = {}
      ;(data || []).forEach((l) => { o[l.matchday ? `${l.phase}_${l.matchday}` : l.phase] = l.max_uses })
      return o
    },
  })

  const saveMutation = useMutation({
    mutationFn: async (prediction) => {
      const { data, error } = await supabase
        .from('predictions')
        .upsert({ ...prediction, user_id: profile.id }, { onConflict: 'user_id, match_id' })
        .select()
      if (error) throw error
      return data?.[0] || prediction
    },
    onSuccess: (newPred) => {
      queryClient.setQueryData(['predictions', profile?.id], (old = []) => {
        const i = old.findIndex((p) => p.match_id === newPred.match_id)
        if (i >= 0) {
          const u = [...old]
          u[i] = { ...u[i], ...newPred }
          return u
        }
        return [...old, newPred]
      })
    },
  })

  if (lm || lp || ll) return <LoadingSpinner />

  const resolved = resolveKnockoutTeams(allMatches)
  const findPred = (id) => predictions.find((p) => p.match_id === id)

  // Comodines usados por fase de eliminatoria
  const powerupUsage = {}
  resolved.forEach((m) => {
    if (findPred(m.id)?.use_powerup_x2) powerupUsage[m.phase] = (powerupUsage[m.phase] || 0) + 1
  })

  const phases = KNOCKOUT_PHASES.map((ph) => ({
    ...ph,
    matches: resolved
      .filter((m) => m.phase === ph.key)
      .sort((a, b) => new Date(a.kickoff_at) - new Date(b.kickoff_at)),
  })).filter((p) => p.matches.length > 0)

  if (phases.length === 0) {
    return (
      <div className="glass-card p-8 text-center">
        <Lock size={28} className="text-slate-400 mx-auto mb-3" />
        <p className="text-slate-500 text-sm">Las eliminatorias se revelarán cuando termine la fase de grupos</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {phases.map((phase) => {
        const limit = powerupLimits[phase.key] ?? 0
        const used = powerupUsage[phase.key] ?? 0
        const reached = used >= limit
        return (
          <div key={phase.key}>
            <div className="flex items-center gap-3 mb-4 px-1">
              <div className="w-1.5 h-1.5 rounded-full bg-accent" />
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-700 dark:text-slate-300">{phase.label}</h3>
              <span className="text-[11px] text-slate-400">comodines {used}/{limit}</span>
              <div className="flex-1 h-px bg-gradient-to-r from-slate-300 dark:from-white/10 to-transparent" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              {phase.matches.map((m) => {
                const fullyDefined = m.home_team_resolved && m.away_team_resolved && !m.home_is_partial && !m.away_is_partial
                const isPlayed = m.status === 'finished' || m.status === 'in_progress'
                if (isPlayed || fullyDefined) {
                  const dm = {
                    ...m,
                    home_team: m.home_team_resolved || m.home_team,
                    away_team: m.away_team_resolved || m.away_team,
                    home_team_code: m.home_team_code_resolved || m.home_team_code,
                    away_team_code: m.away_team_code_resolved || m.away_team_code,
                  }
                  return (
                    <MatchCard
                      key={m.id}
                      match={dm}
                      prediction={findPred(m.id)}
                      onSavePrediction={(p) => saveMutation.mutate(p)}
                      isLoading={saveMutation.isPending}
                      hasReachedLimit={reached}
                      powerupsUsed={used}
                      powerupLimit={limit}
                    />
                  )
                }
                return <LockedKnockoutCard key={m.id} phaseDoneHint="Se habilita al definirse los equipos" />
              })}
            </div>
          </div>
        )
      })}
      <div className="h-32 w-full shrink-0 md:hidden pointer-events-none" />
    </div>
  )
}
