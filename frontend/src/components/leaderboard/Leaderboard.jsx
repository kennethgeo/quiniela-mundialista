/* Tabla de posiciones con podio animado + Supabase Realtime */
import { useState, useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { Trophy, Crown, Medal } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../hooks/useAuth'
import LeaderboardRow from './LeaderboardRow'
import LoadingSpinner from '../ui/LoadingSpinner'

function Podium({ top3 }) {
  if (top3.length < 3) return null

  const podiumOrder = [top3[1], top3[0], top3[2]] // Plata, Oro, Bronce
  const heights = ['h-20', 'h-28', 'h-16']
  const colors = [
    'from-silver/30 to-silver/5 border-silver/30',
    'from-gold/30 to-gold/5 border-gold/30',
    'from-bronze/30 to-bronze/5 border-bronze/30'
  ]
  const icons = [Medal, Crown, Medal]
  const iconColors = ['text-silver', 'text-gold', 'text-bronze']
  const positions = ['2°', '1°', '3°']

  return (
    <div className="flex items-end justify-center gap-3 mb-8 pt-4">
      {podiumOrder.map((entry, i) => {
        const Icon = icons[i]
        return (
          <motion.div
            key={entry.id}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.15, type: 'spring', stiffness: 200 }}
            className="flex flex-col items-center"
          >
            {/* Avatar */}
            <div className={`w-12 h-12 rounded-full bg-gradient-to-br from-accent/30 to-primary-lighter flex items-center justify-center text-lg font-bold overflow-hidden mb-2 ${
              i === 1 ? 'ring-2 ring-gold/50 w-14 h-14' : ''
            }`}>
              {entry.avatar_url ? (
                <img src={entry.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className={iconColors[i]}>{entry.display_name?.charAt(0).toUpperCase()}</span>
              )}
            </div>

            {/* Nombre */}
            <p className="text-xs font-medium text-slate-300 mb-1 max-w-[80px] truncate text-center">
              {entry.display_name}
            </p>

            {/* Puntos */}
            <p className={`text-sm font-bold mb-2 ${iconColors[i]}`}>
              {entry.total_points} pts
            </p>

            {/* Podio */}
            <div className={`${heights[i]} w-20 rounded-t-xl bg-gradient-to-t ${colors[i]} border border-b-0 flex items-start justify-center pt-2`}>
              <div className="flex flex-col items-center">
                <Icon size={16} className={iconColors[i]} />
                <span className={`text-xs font-bold ${iconColors[i]} mt-0.5`}>{positions[i]}</span>
              </div>
            </div>
          </motion.div>
        )
      })}
    </div>
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
          .from('users')
          .select('id, display_name, avatar_url, total_points')
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

      {/* Tabla completa */}
      <div className="glass p-2">
        <div className="flex items-center gap-2 px-3 py-2 mb-1">
          <Trophy size={16} className="text-accent" />
          <h3 className="text-sm font-semibold text-slate-300">Ranking en vivo</h3>
          <span className="text-xs text-slate-500 ml-auto">{entries.length} jugadores</span>
        </div>

        <div className="space-y-0.5">
          {entries.map((entry, idx) => (
            <LeaderboardRow
              key={entry.id}
              entry={entry}
              position={idx + 1}
              isCurrentUser={entry.id === user?.id}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
