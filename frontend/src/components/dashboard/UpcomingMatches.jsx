// Carrusel horizontal de próximos partidos con cuenta regresiva
import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { Clock, Lock, ChevronRight, Calendar } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

export default function UpcomingMatches() {
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    const fetchMatches = async () => {
      try {
        const { data, error } = await supabase
          .from('matches')
          .select('*')
          .in('status', ['pending', 'scheduled', 'in_progress'])
          .order('kickoff_at', { ascending: true })
          .limit(6)
        
        if (error) throw error
        setMatches(data || [])
      } catch (err) {
        console.error('Error fetching matches:', err)
        setMatches([])
      } finally {
        setLoading(false)
      }
    }

    fetchMatches()
  }, [])

  // Estado de carga con skeleton
  if (loading) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider px-1">
          Próximos Partidos
        </h3>
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass-card min-w-[260px] h-36 shimmer" />
          ))}
        </div>
      </div>
    )
  }

  if (matches.length === 0) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider px-1">
          Próximos Partidos
        </h3>
        <div className="glass-card p-8 text-center">
          <Calendar size={28} className="text-slate-600 mx-auto mb-2" />
          <p className="text-slate-500 text-sm">No hay partidos próximos</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <h3 className="text-sm font-bold text-slate-200 uppercase tracking-[0.15em] flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-emerald-500/20 flex items-center justify-center">
            <span className="text-xs">⚽</span>
          </div>
          Próximos Partidos
        </h3>
        <button
          onClick={() => navigate('/matches')}
          className="text-xs text-purple-400 flex items-center gap-1 hover:text-amber-300 transition-colors font-semibold"
        >
          Ver todos <ChevronRight size={14} />
        </button>
      </div>

      {/* Scroll horizontal de tarjetas */}
      <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-hide -mx-1 px-1">
        {matches.map((match, index) => (
          <UpcomingMatchCard key={match.id} match={match} index={index} />
        ))}
      </div>
    </div>
  )
}

/** Tarjeta individual de partido próximo */
function UpcomingMatchCard({ match, index }) {
  const kickoff = new Date(match.kickoff_at)
  const now = new Date()
  const isLocked = (kickoff - now) <= 15 * 60 * 1000 // 15 minutos

  // Intentar obtener la cuenta regresiva legible
  let countdown = ''
  try {
    countdown = formatDistanceToNow(kickoff, { addSuffix: false, locale: es })
  } catch {
    countdown = '—'
  }

  // Format time for display
  const matchTime = kickoff.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const matchDate = kickoff.toLocaleDateString('es', { day: 'numeric', month: 'short' })

  return (
    <motion.div
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.08 }}
      className="glass-card min-w-[260px] snap-start cursor-pointer group relative overflow-hidden"
    >
      {/* Top accent line */}
      <div className={`absolute top-0 left-0 right-0 h-[2px] ${isLocked ? 'bg-gradient-to-r from-rose-500/50 via-rose-400/30 to-transparent' : 'bg-gradient-to-r from-purple-400/50 via-purple-500/20 to-transparent'}`} />

      <div className="p-4 pt-5">
        {/* Match date/time header */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
            {matchDate}
          </span>
          <span className="text-[10px] text-slate-400 font-mono font-bold bg-white/5 rounded-md px-2 py-0.5">
            {matchTime}
          </span>
        </div>

        {/* Teams row */}
        <div className="flex items-center justify-between mb-4">
          {/* Equipo local */}
          <div className="flex flex-col items-center gap-2 flex-1">
            <div className="relative">
              <div className="absolute inset-0 bg-white/10 blur-lg rounded-full scale-110" />
              <img
                src={`https://flagcdn.com/w80/${(match.home_team_code || 'xx').toLowerCase()}.png`}
                alt={match.home_team}
                className="relative w-12 h-8 object-cover rounded-md shadow-lg shadow-black/30 ring-1 ring-white/10"
                onError={(e) => { e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' }}
              />
            </div>
            <span className="text-[11px] text-white font-semibold text-center leading-tight truncate max-w-[80px]">
              {match.home_team || 'Local'}
            </span>
          </div>

          {/* VS Divider */}
          <div className="flex flex-col items-center gap-1 px-3">
            <div className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
              <span className="text-[10px] font-black text-slate-400 tracking-wider">VS</span>
            </div>
          </div>

          {/* Equipo visitante */}
          <div className="flex flex-col items-center gap-2 flex-1">
            <div className="relative">
              <div className="absolute inset-0 bg-white/10 blur-lg rounded-full scale-110" />
              <img
                src={`https://flagcdn.com/w80/${(match.away_team_code || 'xx').toLowerCase()}.png`}
                alt={match.away_team}
                className="relative w-12 h-8 object-cover rounded-md shadow-lg shadow-black/30 ring-1 ring-white/10"
                onError={(e) => { e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' }}
              />
            </div>
            <span className="text-[11px] text-white font-semibold text-center leading-tight truncate max-w-[80px]">
              {match.away_team || 'Visitante'}
            </span>
          </div>
        </div>

        {/* Cuenta regresiva / estado bloqueado */}
        <div className={`flex items-center justify-center gap-1.5 text-[11px] font-bold rounded-xl py-1.5 ${
          isLocked
            ? 'bg-rose-500/10 text-rose-400 border border-rose-500/15'
            : 'bg-purple-400/8 text-purple-400 border border-purple-400/10'
        }`}>
          {isLocked ? <Lock size={12} /> : <Clock size={12} />}
          <span>{isLocked ? 'Bloqueado' : `En ${countdown}`}</span>
        </div>
      </div>
    </motion.div>
  )
}
