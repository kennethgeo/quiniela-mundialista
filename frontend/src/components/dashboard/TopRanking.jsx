// Podio del top 3 con diseño gold/silver/bronze
import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { Trophy, Crown, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'

/** Colores y estilos para cada posición del podio */
const podiumStyles = {
  0: {
    border: 'border-gold/40',
    bg: 'bg-gold/10',
    text: 'text-gold',
    size: 'w-16 h-16',
    label: '🥇',
    order: 'order-2', // centro
    height: 'h-28',
  },
  1: {
    border: 'border-silver/40',
    bg: 'bg-silver/10',
    text: 'text-silver',
    size: 'w-13 h-13',
    label: '🥈',
    order: 'order-1', // izquierda
    height: 'h-22',
  },
  2: {
    border: 'border-bronze/40',
    bg: 'bg-bronze/10',
    text: 'text-bronze',
    size: 'w-13 h-13',
    label: '🥉',
    order: 'order-3', // derecha
    height: 'h-18',
  },
}

export default function TopRanking() {
  const [topUsers, setTopUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    const fetchTop = async () => {
      try {
        const data = await api.get('/api/leaderboard?limit=3')
        setTopUsers(data)
      } catch {
        setTopUsers([])
      } finally {
        setLoading(false)
      }
    }

    fetchTop()
  }, [])

  if (loading) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider px-1">
          Top Ranking
        </h3>
        <div className="glass p-6 h-40 shimmer" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
          <Trophy size={14} className="text-accent" />
          Top Ranking
        </h3>
        <button
          onClick={() => navigate('/leaderboard')}
          className="text-xs text-accent flex items-center gap-0.5 hover:text-accent-light transition-colors"
        >
          Ver ranking <ChevronRight size={14} />
        </button>
      </div>

      <div className="glass p-5">
        {topUsers.length === 0 ? (
          <p className="text-center text-slate-500 text-sm py-4">
            Aún no hay datos de ranking
          </p>
        ) : (
          <div className="flex items-end justify-center gap-4">
            {topUsers.map((user, index) => {
              const style = podiumStyles[index] || podiumStyles[2]
              return (
                <motion.div
                  key={user.user_id || index}
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.15 }}
                  className={`flex flex-col items-center gap-2 ${style.order}`}
                >
                  {/* Corona para el primer lugar */}
                  {index === 0 && (
                    <motion.div
                      animate={{ y: [0, -3, 0] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    >
                      <Crown size={20} className="text-gold" fill="currentColor" />
                    </motion.div>
                  )}

                  {/* Avatar */}
                  <div className={`${style.size} rounded-full ${style.bg} border-2 ${style.border} flex items-center justify-center font-bold ${style.text} text-lg`}>
                    {user.display_name?.charAt(0)?.toUpperCase() || '?'}
                  </div>

                  {/* Nombre y puntos */}
                  <div className="text-center">
                    <p className="text-xs font-medium text-white truncate max-w-[80px]">
                      {user.display_name || 'Anónimo'}
                    </p>
                    <p className={`text-sm font-bold ${style.text}`}>
                      {user.total_points ?? 0} pts
                    </p>
                  </div>

                  {/* Medalla */}
                  <span className="text-lg">{style.label}</span>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
