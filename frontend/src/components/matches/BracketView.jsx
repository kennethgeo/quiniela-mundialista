/* Vista de llaves/bracket para fases eliminatorias */
import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { api } from '../../lib/api'
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

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.05 }}
      className={`glass p-3 min-w-[180px] ${isFinished ? 'border-success/20' : ''}`}
    >
      {/* Equipo local */}
      <div className={`flex items-center gap-2 py-1.5 ${
        isFinished && match.home_goals_actual > match.away_goals_actual
          ? 'text-white font-bold' : 'text-slate-400'
      }`}>
        {!isTBD ? (
          <img
            src={`https://flagcdn.com/w40/${match.home_team_code}.png`}
            alt={match.home_team}
            className="w-6 h-4 rounded object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-6 h-4 rounded bg-slate-700" />
        )}
        <span className="text-xs flex-1 truncate">{match.home_team}</span>
        {isFinished && (
          <span className="text-xs font-bold">{match.home_goals_actual}</span>
        )}
      </div>

      <div className="border-t border-white/5 my-0.5" />

      {/* Equipo visitante */}
      <div className={`flex items-center gap-2 py-1.5 ${
        isFinished && match.away_goals_actual > match.home_goals_actual
          ? 'text-white font-bold' : 'text-slate-400'
      }`}>
        {!isTBD ? (
          <img
            src={`https://flagcdn.com/w40/${match.away_team_code}.png`}
            alt={match.away_team}
            className="w-6 h-4 rounded object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-6 h-4 rounded bg-slate-700" />
        )}
        <span className="text-xs flex-1 truncate">{match.away_team}</span>
        {isFinished && (
          <span className="text-xs font-bold">{match.away_goals_actual}</span>
        )}
      </div>
    </motion.div>
  )
}

export default function BracketView() {
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchMatches = async () => {
      try {
        const data = await api.get('/api/matches')
        // Filtrar solo partidos eliminatorios
        setMatches(data.filter(m => m.phase !== 'groups'))
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

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex gap-4 min-w-max px-1">
        {phases.map((phase) => (
          <div key={phase.key} className="flex flex-col items-center">
            {/* Título de fase */}
            <div className="mb-3 px-3 py-1 rounded-full bg-accent/10 border border-accent/20">
              <span className="text-xs font-bold text-accent uppercase tracking-wider">
                {phase.label}
              </span>
            </div>

            {/* Partidos de esta fase */}
            <div className="flex flex-col gap-3 justify-center flex-1">
              {phase.matches.map((match, i) => (
                <div key={match.id} className="relative">
                  <BracketMatch match={match} index={i} />
                  {/* Línea conectora */}
                  {i < phase.matches.length - 1 && phase.key !== 'final' && phase.key !== 'third_place' && (
                    <div className="absolute -right-4 top-1/2 w-4 h-px bg-white/10" />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Hint para scroll horizontal */}
      <p className="text-center text-xs text-slate-500 mt-4 md:hidden">
        ← Desliza para ver todas las fases →
      </p>
    </div>
  )
}
