/* Pestaña "Hoy": partidos de hoy (grupos + eliminatorias en una sola lista).
   Si hoy no hay partidos, cae automáticamente al próximo día con partidos,
   para no quedar nunca vacía. */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { CalendarDays } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { resolveKnockoutTeams } from '../../lib/bracketResolver'
import MatchList from './MatchList'
import LoadingSpinner from '../ui/LoadingSpinner'

const startOfDay = (d) => {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
const addDays = (d, n) => {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export default function TodayMatches() {
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

  // Recalcular la jornada de cada partido de grupos (igual que GroupStage) para
  // que la llave de límite de comodín (phase_matchday) sea correcta.
  const matchdayById = {}
  const byGroup = {}
  resolved
    .filter((m) => m.phase === 'groups')
    .forEach((m) => { (byGroup[m.group_name] ||= []).push(m) })
  Object.values(byGroup).forEach((arr) => {
    arr.sort((a, b) => new Date(a.kickoff_at) - new Date(b.kickoff_at))
    arr.forEach((m, idx) => { matchdayById[m.id] = Math.floor(idx / 2) + 1 })
  })

  // Normalizar: equipos resueltos en eliminatoria, matchday recalculado en grupos.
  const normalized = resolved
    .map((m) => {
      if (m.phase === 'groups') {
        return { ...m, matchday: matchdayById[m.id] ?? m.matchday }
      }
      const fullyDefined = m.home_team_resolved && m.away_team_resolved && !m.home_is_partial && !m.away_is_partial
      const isPlayed = m.status === 'finished' || m.status === 'in_progress'
      // Eliminatorias aún sin equipos definidos no son predecibles: se ven en su
      // pestaña como bloqueadas, no acá.
      if (!isPlayed && !fullyDefined) return null
      return {
        ...m,
        matchday: null,
        home_team: m.home_team_resolved || m.home_team,
        away_team: m.away_team_resolved || m.away_team,
        home_team_code: m.home_team_code_resolved || m.home_team_code,
        away_team_code: m.away_team_code_resolved || m.away_team_code,
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.kickoff_at) - new Date(b.kickoff_at))

  // Uso global de comodines por fase/jornada (para respetar el límite real).
  const powerupUsage = {}
  normalized.forEach((m) => {
    if (predictions.find((p) => p.match_id === m.id)?.use_powerup_x2) {
      const key = m.matchday ? `${m.phase}_${m.matchday}` : m.phase
      powerupUsage[key] = (powerupUsage[key] || 0) + 1
    }
  })

  // Partidos de HOY (rango [hoy 00:00, mañana 00:00)).
  const today0 = startOfDay(new Date())
  const tomorrow0 = addDays(today0, 1)
  const todays = normalized.filter((m) => {
    const k = new Date(m.kickoff_at)
    return k >= today0 && k < tomorrow0
  })

  // Si hoy no hay, tomar el próximo DÍA con partidos (todos los de ese día).
  let shown = todays
  let isToday = todays.length > 0
  if (!isToday) {
    const future = normalized.filter((m) => new Date(m.kickoff_at) >= tomorrow0)
    if (future.length > 0) {
      const day0 = startOfDay(future[0].kickoff_at)
      const dayEnd = addDays(day0, 1)
      shown = future.filter((m) => {
        const k = new Date(m.kickoff_at)
        return k >= day0 && k < dayEnd
      })
    } else {
      shown = []
    }
  }

  const dayLabel = isToday
    ? 'Hoy'
    : shown.length > 0
      ? new Date(shown[0].kickoff_at).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })
      : null

  return (
    <div className="relative z-10">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-2 mb-5 px-1"
      >
        <CalendarDays size={16} className="text-accent" />
        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-200">
          {isToday ? 'Partidos de hoy' : 'Próximos partidos'}
        </h2>
        {dayLabel && !isToday && (
          <span className="text-xs text-slate-500 capitalize">· {dayLabel}</span>
        )}
        {shown.length > 0 && (
          <span className="text-xs text-slate-500 ml-auto">
            {shown.length} {shown.length === 1 ? 'partido' : 'partidos'}
          </span>
        )}
      </motion.div>

      {shown.length === 0 ? (
        <div className="glass-card bg-white dark:bg-transparent p-8 text-center">
          <CalendarDays size={28} className="text-slate-400 mx-auto mb-3" />
          <p className="text-slate-600 dark:text-slate-400 text-sm">No hay más partidos programados</p>
        </div>
      ) : (
        <MatchList
          matches={shown}
          predictions={predictions}
          onSavePrediction={(p) => saveMutation.mutate(p)}
          isLoading={saveMutation.isPending}
          powerupLimits={powerupLimits}
          powerupUsage={powerupUsage}
        />
      )}
    </div>
  )
}
