// Podio del top 3 con diseño gold/silver/bronze
import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { Trophy, Crown, ChevronRight, Medal } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

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
    glow: 'shadow-gold/30',
    gradient: 'from-amber-400/30 via-yellow-500/10 to-amber-600/20',
    pedestalGradient: 'from-amber-400/20 to-amber-600/8',
    pedestalH: 'h-24',
    ringColor: 'ring-amber-400/40',
    avatarGlow: 'bg-amber-400/20',
  },
  1: {
    border: 'border-silver/40',
    bg: 'bg-silver/10',
    text: 'text-silver',
    size: 'w-13 h-13',
    label: '🥈',
    order: 'order-1', // izquierda
    height: 'h-22',
    glow: 'shadow-silver/20',
    gradient: 'from-slate-300/20 via-slate-400/5 to-slate-300/10',
    pedestalGradient: 'from-slate-300/15 to-slate-400/5',
    pedestalH: 'h-16',
    ringColor: 'ring-slate-300/30',
    avatarGlow: 'bg-slate-300/15',
  },
  2: {
    border: 'border-bronze/40',
    bg: 'bg-bronze/10',
    text: 'text-bronze',
    size: 'w-13 h-13',
    label: '🥉',
    order: 'order-3', // derecha
    height: 'h-18',
    glow: 'shadow-bronze/20',
    gradient: 'from-orange-400/20 via-orange-500/5 to-orange-600/10',
    pedestalGradient: 'from-orange-400/12 to-orange-600/5',
    pedestalH: 'h-12',
    ringColor: 'ring-orange-400/30',
    avatarGlow: 'bg-orange-400/12',
  },
}

export default function TopRanking() {
  const [topUsers, setTopUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    const fetchTop = async () => {
      try {
        const { data, error } = await supabase
          .from('users')
          .select('id, display_name, avatar_url, total_points')
          .order('total_points', { ascending: false })
          .limit(3)
          
        if (error) throw error
        setTopUsers(data || [])
      } catch (err) {
        console.error('Error fetching leaderboard:', err)
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
        <div className="glass-card p-6 h-52 shimmer" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-200 uppercase tracking-[0.15em] flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg gradient-2026 flex items-center justify-center">
            <Trophy size={12} className="text-white" />
          </div>
          Top Ranking
        </h3>
        <button
          onClick={() => navigate('/leaderboard')}
          className="text-xs text-purple-600 dark:text-purple-400 flex items-center gap-1 hover:text-purple-500 transition-colors font-semibold"
        >
          Ver ranking <ChevronRight size={14} />
        </button>
      </div>

      {/* Podium card */}
      <div className="glass-card p-6 relative overflow-hidden">
        {/* Ambient light effects */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-40 h-20 bg-amber-400/6 blur-3xl rounded-full pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/5 to-transparent" />

        {topUsers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Medal size={32} className="text-slate-400 dark:text-slate-600" />
            <p className="text-center text-slate-500 text-sm">
              Aún no hay datos de ranking
            </p>
          </div>
        ) : (
          <div className="flex items-end justify-center gap-5 pt-4 pb-2" style={{ perspective: '600px' }}>
            {topUsers.map((user, index) => {
              const style = podiumStyles[index] || podiumStyles[2]
              return (
                <motion.div
                  key={user.user_id || index}
                  initial={{ opacity: 0, y: 40, rotateX: 15 }}
                  animate={{ opacity: 1, y: 0, rotateX: 0 }}
                  transition={{
                    delay: index === 0 ? 0.2 : index === 1 ? 0.05 : 0.35,
                    duration: 0.6,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  className={`flex flex-col items-center gap-2 ${style.order}`}
                >
                  {/* Corona para el primer lugar */}
                  {index === 0 && (
                    <motion.div
                      animate={{ y: [0, -4, 0] }}
                      transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                      className="mb-[-4px]"
                    >
                      <Crown size={24} className="text-amber-400 drop-shadow-lg" fill="currentColor" />
                    </motion.div>
                  )}

                  {/* Avatar with glow ring */}
                  <div className="relative">
                    {/* Glow behind avatar */}
                    <div className={`absolute inset-0 ${style.avatarGlow} rounded-full blur-lg scale-150`} />
                    <div
                      className={`relative ${style.size} rounded-full ${style.bg} border-2 ${style.border} flex items-center justify-center font-bold ${style.text} text-lg ring-2 ${style.ringColor} ring-offset-2 ring-offset-primary`}
                    >
                      {user.display_name?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                  </div>

                  {/* Nombre y puntos */}
                  <div className="text-center mt-1">
                    <p className="text-xs font-semibold text-slate-900 dark:text-white truncate max-w-[80px]">
                      {user.display_name || 'Anónimo'}
                    </p>
                    <p className={`text-sm font-bold ${style.text} mt-0.5`}>
                      {user.total_points ?? 0} pts
                    </p>
                  </div>

                  {/* Pedestal */}
                  <div className={`w-16 ${style.pedestalH} rounded-t-xl bg-gradient-to-t ${style.pedestalGradient} border border-accent/10 border-b-0 flex items-start justify-center pt-2`}>
                    <span className="text-xl">{style.label}</span>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
