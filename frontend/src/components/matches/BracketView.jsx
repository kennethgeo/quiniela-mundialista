/* Vista de llaves/bracket para fases eliminatorias */
import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { Trophy, Swords } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../ui/LoadingSpinner'

const KNOCKOUT_PHASES = [
  { key: 'round_of_32', label: 'Ronda de 32', short: 'R32' },
  { key: 'round_of_16', label: 'Octavos', short: 'R16' },
  { key: 'quarter_finals', label: 'Cuartos', short: 'QF' },
  { key: 'semi_finals', label: 'Semifinales', short: 'SF' },
  { key: 'third_place', label: '3er Puesto', short: '3rd' },
  { key: 'final', label: 'Final', short: 'F' },
]

function BracketMatch({ match, index }) {
  const isTBD = match.home_team === 'TBD'
  const isFinished = match.status === 'finished'

  const TeamRow = ({ team, teamCode, goals, isWinner, isTbd }) => (
    <div className={`flex items-center gap-2.5 py-2 px-2.5 rounded-xl transition-colors ${
      isWinner ? 'bg-amber-500/10' : ''
    }`}>
      {!isTbd ? (
        <img
          src={`https://flagcdn.com/w40/${(teamCode || 'xx').toLowerCase()}.png`}
          alt={team}
          className="w-7 h-5 rounded-sm object-cover shadow-sm"
          loading="lazy"
        />
      ) : (
        <div className="w-7 h-5 rounded-sm bg-slate-700/60 shimmer" />
      )}
      <span className={`text-xs flex-1 truncate ${
        isWinner ? 'text-slate-900 dark:text-white font-bold' : isTbd ? 'text-slate-500 dark:text-slate-600 italic' : 'text-slate-600 dark:text-slate-400'
      }`}>
        {team}
      </span>
      {isFinished && (
        <span className={`text-sm font-bold tabular-nums ${
          isWinner ? 'text-amber-400' : 'text-slate-500'
        }`}>
          {goals}
        </span>
      )}
    </div>
  )

  const homeWins = isFinished && match.home_goals_actual > match.away_goals_actual
  const awayWins = isFinished && match.away_goals_actual > match.home_goals_actual

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.05 }}
      className={`glass-card p-1.5 min-w-[200px] ${
        isFinished ? 'border-success/15' : ''
      }`}
    >
      {/* Equipo local */}
      <TeamRow
        team={match.home_team}
        teamCode={match.home_team_code}
        goals={match.home_goals_actual}
        isWinner={homeWins}
        isTbd={isTBD}
      />

      <div className="border-t border-white/[0.04] mx-2" />

      {/* Equipo visitante */}
      <TeamRow
        team={match.away_team}
        teamCode={match.away_team_code}
        goals={match.away_goals_actual}
        isWinner={awayWins}
        isTbd={isTBD}
      />
    </motion.div>
  )
}

export default function BracketView() {
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchMatches = async () => {
      try {
        const { data, error } = await supabase
          .from('matches')
          .select('*')
          .neq('phase', 'groups')
          .order('kickoff_at', { ascending: true })
          
        if (error) throw error
        setMatches(data || [])
      } catch (err) {
        console.error('Error cargando bracket:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchMatches()
  }, [])

  if (loading) return <LoadingSpinner />

  // Agrupar por fase
  const phases = KNOCKOUT_PHASES.map(phase => ({
    ...phase,
    matches: matches.filter(m => m.phase === phase.key)
  })).filter(p => p.matches.length > 0)

  if (phases.length === 0) {
    return (
      <div className="glass-card p-10 text-center">
        <Swords size={32} className="text-slate-600 mx-auto mb-3" />
        <p className="text-slate-400 text-sm">Las llaves se revelarán cuando termine la fase de grupos</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto pb-4 scrollbar-hide">
      <div className="flex gap-5 min-w-max px-1 items-start">
        {phases.map((phase) => (
          <div key={phase.key} className="flex flex-col items-center">
            {/* Título de fase */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`mb-4 px-4 py-1.5 rounded-2xl border ${
                phase.key === 'final'
                  ? 'gradient-gold text-slate-900 border-transparent shadow-lg shadow-amber-500/20'
                  : 'glass-strong border-accent/20'
              }`}
            >
              <span className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${
                phase.key === 'final' ? '' : 'text-accent'
              }`}>
                {phase.key === 'final' && <Trophy size={12} />}
                {phase.label}
              </span>
            </motion.div>

            {/* Partidos de esta fase */}
            <div className="flex flex-col gap-3 justify-center flex-1">
              {phase.matches.map((match, i) => (
                <div key={match.id} className="relative">
                  <BracketMatch match={match} index={i} />
                  {/* Línea conectora */}
                  {i < phase.matches.length - 1 && phase.key !== 'final' && phase.key !== 'third_place' && (
                    <div className="absolute -right-5 top-1/2 w-5 h-px bg-gradient-to-r from-white/15 to-white/5" />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Hint para scroll horizontal */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="text-center text-xs text-slate-600 mt-5 md:hidden"
      >
        ← Desliza para ver todas las fases →
      </motion.p>
    </div>
  )
}
