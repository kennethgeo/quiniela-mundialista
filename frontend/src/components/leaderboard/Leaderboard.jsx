/* Tabla de posiciones con podio animado + Supabase Realtime */
import { useState, useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { Trophy, Crown, Medal, Zap } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import LeaderboardRow from './LeaderboardRow'
import LoadingSpinner from '../ui/LoadingSpinner'

function Podium({ top3 }) {
  if (top3.length < 3) return null

  const podiumOrder = [top3[1], top3[0], top3[2]] // Plata, Oro, Bronce
  const heights = ['h-24', 'h-36', 'h-20']
  const avatarSizes = ['w-14 h-14', 'w-18 h-18', 'w-12 h-12']
  const colors = [
    'from-silver/30 to-silver/5 border-silver/40',
    'from-gold/40 to-gold/5 border-gold/50',
    'from-bronze/30 to-bronze/5 border-bronze/40'
  ]
  const icons = [Medal, Crown, Medal]
  const iconColors = ['text-silver', 'text-gold', 'text-bronze']
  const iconSizes = [18, 24, 16]
  const positions = ['2°', '1°', '3°']
  const ringColors = ['ring-silver/40', 'ring-gold/50', 'ring-bronze/40']
  const shadowColors = ['shadow-silver/10', 'shadow-amber-400/20', 'shadow-orange-400/10']

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="glass-card p-5 mb-5"
    >
      <div className="flex items-end justify-center gap-3 pt-6 pb-2">
        {podiumOrder.map((entry, i) => {
          const Icon = icons[i]
          const isFirst = i === 1
          return (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0, y: 40, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: i === 1 ? 0 : 0.15 + i * 0.1, type: 'spring', stiffness: 180, damping: 18 }}
              className="flex flex-col items-center"
            >
              {/* Crown glow for 1st place */}
              {isFirst && (
                <motion.div
                  animate={{ y: [0, -4, 0] }}
                  transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
                  className="mb-1"
                >
                  <Crown size={20} className="text-gold drop-shadow-[0_0_8px_rgba(255,215,0,0.6)]" />
                </motion.div>
              )}

              {/* Avatar */}
              <div className={`${isFirst ? 'w-16 h-16' : avatarSizes[i]} rounded-full bg-gradient-to-br from-accent/30 to-primary-lighter flex items-center justify-center text-lg font-bold overflow-hidden mb-2 ring-2 ${ringColors[i]} shadow-lg ${shadowColors[i]}`}>
                {entry.avatar_url ? (
                  <img src={entry.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className={`${iconColors[i]} ${isFirst ? 'text-xl' : 'text-base'} font-bold`}>{entry.display_name?.charAt(0).toUpperCase()}</span>
                )}
              </div>

              {/* Nombre */}
              <p className={`text-xs font-semibold text-slate-600 dark:text-slate-300 mb-0.5 max-w-[80px] truncate text-center ${isFirst ? 'text-sm text-slate-900 dark:text-white' : ''}`}>
                {entry.display_name}
              </p>

              {/* Puntos */}
              <p className={`text-sm font-bold mb-2 ${iconColors[i]}`}>
                {entry.total_points} pts
              </p>

              {/* Podio - bloque 3D */}
              <div className={`${heights[i]} ${isFirst ? 'w-24' : 'w-20'} rounded-t-2xl bg-gradient-to-t ${colors[i]} border border-b-0 flex items-start justify-center pt-3 relative overflow-hidden`}>
                <div className="flex flex-col items-center relative z-10">
                  <Icon size={iconSizes[i]} className={`${iconColors[i]} drop-shadow-lg`} />
                  <span className={`text-sm font-bold ${iconColors[i]} mt-1`}>{positions[i]}</span>
                </div>
                {/* Inner shine effect */}
                <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none" />
              </div>
            </motion.div>
          )
        })}
      </div>
    </motion.div>
  )
}

export default function Leaderboard() {
  const { user } = useAuth()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const channelRef = useRef(null)

  useEffect(() => {
    // Cargar ranking inicial
    const fetchLeaderboard = async () => {
      try {
        const { data, error } = await supabase
          .from('user_badges_view')
          .select('*')
          .order('total_points', { ascending: false })

        if (error) throw error
        setEntries(data || [])
      } catch (err) {
        console.error('Error cargando ranking:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchLeaderboard()
  }, [])

  useEffect(() => {
    // Configurar Realtime subscription
    const channel = supabase
      .channel('users-leaderboard')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'users'
        },
        (payload) => {
          const updatedUser = payload.new

          // Actualizar usuario en la lista
          setEntries((prevEntries) => {
            const updated = prevEntries.map((entry) =>
              entry.id === updatedUser.id
                ? { ...entry, total_points: updatedUser.total_points }
                : entry
            )

            // Reordenar por puntos (descendente)
            return updated.sort((a, b) => b.total_points - a.total_points)
          })
        }
      )
      .subscribe((status) => {
        console.log('Realtime channel status:', status)
      })

    channelRef.current = channel

    // Cleanup: unsubscribe al desmontar
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
      }
    }
  }, [])

  if (loading) return <LoadingSpinner />

  const top3 = entries.slice(0, 3)
  const rest = entries.slice(3)

  return (
    <div>
      {/* Podio top 3 */}
      {top3.length >= 3 && <Podium top3={top3} />}

      {/* Tabla — mostrar si hay resto o si no se completó el podio */}
      {((rest.length > 0 || top3.length < 3) && entries.length > 0) && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="glass-card p-4"
        >
          {/* Tabla completa (sin repetir el podio) */}
          <div className="glass p-3">
            <div className="flex items-center gap-2 px-3 py-2.5 mb-2">
              <Trophy size={16} className="text-accent" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-300">Ranking en vivo</h3>
              <span className="text-xs text-slate-500 ml-auto">{entries.length} jugadores</span>
            </div>

            <div className="space-y-1">
              {rest.length === 0 && top3.length < 3 ? (
                entries.map((entry, idx) => (
                  <LeaderboardRow
                    key={entry.id}
                    entry={entry}
                    position={idx + 1}
                    isCurrentUser={entry.id === user?.id}
                  />
                ))
              ) : (
                rest.map((entry, idx) => (
                  <LeaderboardRow
                    key={entry.id}
                    entry={entry}
                    position={idx + 4}
                    isCurrentUser={entry.id === user?.id}
                  />
                ))
              )}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  )
}
