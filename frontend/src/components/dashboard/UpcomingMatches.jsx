// Carrusel horizontal de próximos partidos con cuenta regresiva
import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { Clock, Lock, ChevronRight } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'

export default function UpcomingMatches() {
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    const fetchMatches = async () => {
      try {
        const data = await api.get('/api/matches?status=scheduled&limit=6')
        setMatches(data)
      } catch {
        // Si falla la API, mostramos estado vacío
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
            <div key={i} className="glass min-w-[220px] h-28 shimmer" />
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
        <div className="glass p-6 text-center">
          <p className="text-slate-500 text-sm">No hay partidos próximos</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          Próximos Partidos
        </h3>
        <button
          onClick={() => navigate('/matches')}
          className="text-xs text-accent flex items-center gap-0.5 hover:text-accent-light transition-colors"
        >
          Ver todos <ChevronRight size={14} />
        </button>
      </div>

      {/* Scroll horizontal de tarjetas */}
      <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-hide">
        {matches.map((match, index) => (
          <UpcomingMatchCard key={match.id} match={match} index={index} />
        ))}
      </div>
    </div>
  )
}

/** Tarjeta individual de partido próximo */
function UpcomingMatchCard({ match, index }) {
  const kickoff = new Date(match.kickoff)
  const now = new Date()
  const isLocked = (kickoff - now) <= 15 * 60 * 1000 // 15 minutos

  // Intentar obtener la cuenta regresiva legible
  let countdown = ''
  try {
    countdown = formatDistanceToNow(kickoff, { addSuffix: false, locale: es })
  } catch {
    countdown = '—'
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.08 }}
      className="glass min-w-[220px] p-4 snap-start hover:bg-white/[0.07] transition-colors cursor-pointer"
    >
      {/* Equipos */}
      <div className="flex items-center justify-between mb-3">
        {/* Equipo local */}
        <div className="flex flex-col items-center gap-1 flex-1">
          <img
            src={`https://flagcdn.com/w80/${match.home_team?.code?.toLowerCase() || 'xx'}.png`}
            alt={match.home_team?.name}
            className="w-10 h-7 object-cover rounded shadow-sm"
            onError={(e) => { e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' }}
          />
          <span className="text-[11px] text-white font-medium text-center leading-tight truncate max-w-[70px]">
            {match.home_team?.name || 'Local'}
          </span>
        </div>

        {/* VS */}
        <div className="text-xs text-slate-500 font-bold px-2">VS</div>

        {/* Equipo visitante */}
        <div className="flex flex-col items-center gap-1 flex-1">
          <img
            src={`https://flagcdn.com/w80/${match.away_team?.code?.toLowerCase() || 'xx'}.png`}
            alt={match.away_team?.name}
            className="w-10 h-7 object-cover rounded shadow-sm"
            onError={(e) => { e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' }}
          />
          <span className="text-[11px] text-white font-medium text-center leading-tight truncate max-w-[70px]">
            {match.away_team?.name || 'Visitante'}
          </span>
        </div>
      </div>

      {/* Cuenta regresiva / estado bloqueado */}
      <div className={`flex items-center justify-center gap-1.5 text-[11px] font-medium ${
        isLocked ? 'text-error-light' : 'text-accent'
      }`}>
        {isLocked ? <Lock size={12} /> : <Clock size={12} />}
        <span>{isLocked ? 'Bloqueado' : `En ${countdown}`}</span>
      </div>
    </motion.div>
  )
}
