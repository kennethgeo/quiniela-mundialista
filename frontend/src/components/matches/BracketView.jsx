/* Vista de llaves/bracket para fases eliminatorias */
import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { Trophy, Swords } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { useNavigate } from 'react-router-dom'
import LoadingSpinner from '../ui/LoadingSpinner'

const KNOCKOUT_PHASES = [
  { key: 'round_of_32', label: 'Ronda de 32', short: 'R32' },
  { key: 'round_of_16', label: 'Octavos', short: 'R16' },
  { key: 'quarter_finals', label: 'Cuartos', short: 'QF' },
  { key: 'semi_finals', label: 'Semifinales', short: 'SF' },
  { key: 'third_place', label: '3er Puesto', short: '3rd' },
  { key: 'final', label: 'Final', short: 'F' },
]

// Orden VERTICAL de cada columna según el árbol real del bracket 2026, para que
// el ganador de cada par quede alineado con su partido de la ronda siguiente
// (89=W74-W77, 90=W73-W75, …). Ordenar por hora de inicio descalzaba las llaves.
const BRACKET_ORDER = {
  round_of_32: [74, 77, 73, 75, 83, 84, 81, 82, 76, 78, 79, 80, 86, 88, 85, 87],
  round_of_16: [89, 90, 93, 94, 91, 92, 95, 96],
  quarter_finals: [97, 98, 99, 100],
  semi_finals: [101, 102],
  third_place: [103],
  final: [104],
}

function BracketMatch({ match, index }) {
  const navigate = useNavigate()
  
  const homeTeamName = match.home_team_resolved || match.home_team;
  const awayTeamName = match.away_team_resolved || match.away_team;
  const homeTeamCode = match.home_team_code_resolved || match.home_team_code;
  const awayTeamCode = match.away_team_code_resolved || match.away_team_code;

  const isTBDHome = homeTeamName === 'TBD' || homeTeamName.match(/^[123WL][A-Z0-9]/);
  const isTBDAway = awayTeamName === 'TBD' || awayTeamName.match(/^[123WL][A-Z0-9]/);
  const isFinished = match.status === 'finished';

  const TeamRow = ({ team, teamCode, goals, isWinner, isTbd, isPartial }) => (
    <div className={`flex items-center gap-2.5 py-2 px-2.5 rounded-xl transition-colors ${
      isWinner ? 'bg-amber-500/10' : ''
    } ${isPartial ? 'opacity-60' : ''}`}>
      {!isTbd && teamCode ? (
        <img
          src={`https://flagcdn.com/w40/${(teamCode || 'xx').toLowerCase()}.png`}
          alt={team}
          className="w-7 h-5 rounded-sm object-cover shadow-sm"
          loading="lazy"
          onError={(e) => { e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' }}
        />
      ) : (
        <div className={`w-7 h-5 rounded-sm flex items-center justify-center text-[8px] font-bold text-slate-500 bg-slate-200 dark:bg-slate-800 ${isTbd ? 'shimmer' : ''}`}>
          {isTbd ? '-' : ''}
        </div>
      )}
      <span className={`text-xs flex-1 truncate ${
        isWinner ? 'text-slate-900 dark:text-white font-bold' : isTbd ? 'text-slate-500 dark:text-slate-600 italic font-mono text-[10px]' : 'text-slate-700 dark:text-slate-300'
      }`}>
        {team}
      </span>
      {isFinished && goals !== null && (
        <span className={`text-sm font-bold tabular-nums ${
          isWinner ? 'text-amber-500 dark:text-amber-400' : 'text-slate-500'
        }`}>
          {goals}
        </span>
      )}
    </div>
  )

  const homeWins = isFinished && match.home_goals_actual > match.away_goals_actual
  const awayWins = isFinished && match.away_goals_actual > match.home_goals_actual

  const dateString = match.kickoff_at.endsWith('Z') || match.kickoff_at.includes('+')
    ? match.kickoff_at
    : `${match.kickoff_at}Z`
  const kickoff = new Date(dateString)

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.05 }}
      onClick={() => navigate(`/match/${match.id}`)}
      className={`glass-card min-w-[220px] relative overflow-hidden group cursor-pointer hover:ring-1 hover:ring-accent/50 transition-all ${
        isFinished ? 'border-success/20 ring-1 ring-success/10' : 'border-white/10'
      }`}
    >
      {/* Glow background */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />

      <div className="p-2" style={{ paddingTop: '8px' }}>
        {/* Fecha superior */}
        <div className="flex justify-between items-center mb-2 px-1">
          <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            {format(kickoff, "d MMM", { locale: es })}
          </span>
        <span className="text-[9px] font-mono font-bold bg-slate-100 dark:bg-white/5 text-slate-500 rounded px-1.5 py-0.5">
          {format(kickoff, "HH:mm")}
        </span>
      </div>

      {/* Equipo local */}
      <TeamRow
        team={homeTeamName}
        teamCode={homeTeamCode}
        goals={match.home_goals_actual}
        isWinner={homeWins}
        isTbd={isTBDHome}
        isPartial={match.home_is_partial}
      />

      <div className="border-t border-slate-200 dark:border-white/10 mx-2 my-0.5" />

      {/* Equipo visitante */}
      <TeamRow
        team={awayTeamName}
        teamCode={awayTeamCode}
        goals={match.away_goals_actual}
        isWinner={awayWins}
        isTbd={isTBDAway}
        isPartial={match.away_is_partial}
      />
      </div>
    </motion.div>
  )
}

import { resolveKnockoutTeams } from '../../lib/bracketResolver'

export default function BracketView() {
  const [allMatches, setAllMatches] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchMatches = async () => {
      try {
        const { data, error } = await supabase
          .from('matches')
          .select('*')
          // Removed neq('phase', 'groups') so we can calculate group standings
          .order('kickoff_at', { ascending: true })
          
        if (error) throw error
        setAllMatches(data || [])
      } catch (err) {
        console.error('Error cargando bracket:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchMatches()
  }, [])

  if (loading) return <LoadingSpinner />

  // Resolver los equipos dinamicamente en base a las posiciones de fase de grupos
  const resolvedKnockouts = resolveKnockoutTeams(allMatches)

  // Agrupar por fase y asegurar orden cronologico
  const phases = KNOCKOUT_PHASES.map(phase => ({
    ...phase,
    matches: resolvedKnockouts
      .filter(m => m.phase === phase.key)
      .sort((a, b) => {
        // Ordenar por posición en el árbol (para que las llaves calcen); si no
        // se reconoce el id, caer al orden cronológico.
        const order = BRACKET_ORDER[phase.key] || []
        const ia = order.indexOf(a.id)
        const ib = order.indexOf(b.id)
        if (ia !== -1 && ib !== -1) return ia - ib
        if (ia !== -1) return -1
        if (ib !== -1) return 1
        return new Date(a.kickoff_at) - new Date(b.kickoff_at)
      })
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
      <div className="flex flex-row gap-8 min-w-max px-2 items-stretch">
        {phases.map((phase) => (
          <div key={phase.key} className="flex flex-col w-[240px]">
            {/* Título de fase */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`mb-6 px-4 py-1.5 rounded-2xl border text-center ${
                phase.key === 'final'
                  ? 'gradient-gold text-slate-900 border-transparent shadow-lg shadow-amber-500/20'
                  : 'glass-strong border-accent/20'
              }`}
            >
              <span className={`text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 ${
                phase.key === 'final' ? '' : 'text-accent'
              }`}>
                {phase.key === 'final' && <Trophy size={12} />}
                {phase.label}
              </span>
            </motion.div>

            {/* Partidos de esta fase */}
            <div className="flex flex-col gap-4 justify-around flex-1">
              {phase.matches.map((match, i) => (
                <div key={match.id} className="relative w-full">
                  <BracketMatch match={match} index={i} />
                  {/* Línea conectora rediseñada */}
                  {phase.key !== 'final' && phase.key !== 'third_place' && (
                    <div className="absolute -right-8 top-1/2 w-8 flex items-center justify-center pointer-events-none">
                      <div className="w-full h-[2px] bg-gradient-to-r from-accent/50 to-transparent" />
                    </div>
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
      
      {/* Spacer para que el BottomNav no tape el bracket en móvil */}
      <div className="h-32 w-full shrink-0 md:hidden pointer-events-none" />
    </div>
  )
}
