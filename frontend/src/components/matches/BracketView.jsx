/* Vista de llaves/bracket — Tico Games (rediseño). */
import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { Swords } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { resolveKnockoutTeams } from '../../lib/bracketResolver'
import LoadingSpinner from '../ui/LoadingSpinner'

const KNOCKOUT_PHASES = [
  { key: 'round_of_32', label: 'RONDA 32' },
  { key: 'round_of_16', label: 'OCTAVOS' },
  { key: 'quarter_finals', label: 'CUARTOS' },
  { key: 'semi_finals', label: 'SEMIFINAL' },
  { key: 'third_place', label: '3ER PUESTO' },
  { key: 'final', label: 'FINAL' },
]

const BRACKET_ORDER = {
  round_of_32: [74, 77, 73, 75, 83, 84, 81, 82, 76, 78, 79, 80, 86, 88, 85, 87],
  round_of_16: [89, 90, 93, 94, 91, 92, 95, 96],
  quarter_finals: [97, 98, 99, 100],
  semi_finals: [101, 102],
  third_place: [103],
  final: [104],
}

const isSlot = (n) => !n || n === 'TBD' || /^[123WL][A-Z0-9]/.test(n)

function BracketMatch({ match, isFinal }) {
  const navigate = useNavigate()
  const home = match.home_team_resolved || match.home_team
  const away = match.away_team_resolved || match.away_team
  const tbdH = isSlot(home)
  const tbdA = isSlot(away)
  const finished = match.status === 'finished'

  const penDecided = finished && match.goes_to_penalties && match.penalties_winner_real
  const homePen = penDecided && match.penalties_winner_real === home
  const awayPen = penDecided && match.penalties_winner_real === away
  const homeWins = finished && (penDecided ? homePen : match.home_goals_actual > match.away_goals_actual)
  const awayWins = finished && (penDecided ? awayPen : match.away_goals_actual > match.home_goals_actual)

  // Borde: final coral, próximo (definido y sin jugar) teal, resto gris.
  const border = isFinal ? '#FF7A59' : (!finished && !tbdH && !tbdA ? '#2ED3B7' : '#262626')

  const Row = ({ name, tbd, goals, win, pen }) => {
    const color = win ? '#F3F1EA' : finished ? '#5c5c5c' : (tbd ? '#5c5c5c' : '#8A8A8A')
    return (
      <div className="flex justify-between items-center gap-2">
        <span className={`truncate font-['Archivo'] ${win ? 'font-bold' : 'font-semibold'} ${tbd ? 'italic' : ''}`}
          style={{ color, fontSize: 11.5 }}>{name}</span>
        <span className="font-['JetBrains_Mono'] font-extrabold shrink-0 flex items-center gap-1" style={{ color, fontSize: 12 }}>
          {pen && <span className="text-[7px] font-black tracking-wider text-[#FF7A59] bg-[#FF7A59]/15 border border-[#FF7A59]/30 rounded px-1 py-px leading-none">PEN</span>}
          {finished && goals != null ? goals : (tbd ? '' : '—')}
        </span>
      </div>
    )
  }

  return (
    <button onClick={() => navigate(`/match/${match.id}`)}
      className="text-left rounded-[11px] px-2.5 py-2.5 flex flex-col gap-1.5 transition-transform active:scale-[0.98] hover:brightness-125"
      style={{ background: '#161616', border: `1px solid ${border}` }}>
      <Row name={home} tbd={tbdH} goals={match.home_goals_actual} win={homeWins} pen={homePen} />
      <Row name={away} tbd={tbdA} goals={match.away_goals_actual} win={awayWins} pen={awayPen} />
    </button>
  )
}

export default function BracketView() {
  const [allMatches, setAllMatches] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('matches').select('*').order('kickoff_at', { ascending: true })
      .then(({ data }) => { setAllMatches(data || []); setLoading(false) })
  }, [])

  if (loading) return <LoadingSpinner />

  const resolved = resolveKnockoutTeams(allMatches)
  const phases = KNOCKOUT_PHASES.map((phase) => ({
    ...phase,
    matches: resolved.filter((m) => m.phase === phase.key).sort((a, b) => {
      const order = BRACKET_ORDER[phase.key] || []
      const ia = order.indexOf(a.id), ib = order.indexOf(b.id)
      if (ia !== -1 && ib !== -1) return ia - ib
      if (ia !== -1) return -1
      if (ib !== -1) return 1
      return new Date(a.kickoff_at) - new Date(b.kickoff_at)
    }),
  })).filter((p) => p.matches.length > 0)

  if (phases.length === 0) {
    return (
      <div className="rounded-2xl p-10 text-center" style={{ background: '#0C0C0C', border: '1px solid #1a1a1a' }}>
        <Swords size={30} className="text-[#5c5c5c] mx-auto mb-3" />
        <p className="text-[#8A8A8A] text-sm">Las llaves se revelarán cuando termine la fase de grupos.</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl p-5 overflow-x-auto scrollbar-hide font-['Archivo']" style={{ background: '#0C0C0C', border: '1px solid #1a1a1a' }}>
      <div className="flex gap-9" style={{ minWidth: 900 }}>
        {phases.map((phase) => (
          <div key={phase.key} className="flex-1 flex flex-col justify-around gap-3.5 min-w-[150px]">
            <div className="font-['JetBrains_Mono'] font-bold text-[9px] tracking-[0.14em] text-[#8A8A8A] text-center mb-1">{phase.label}</div>
            {phase.matches.map((m, i) => (
              <motion.div key={m.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.04 }}>
                <BracketMatch match={m} isFinal={phase.key === 'final'} />
              </motion.div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
