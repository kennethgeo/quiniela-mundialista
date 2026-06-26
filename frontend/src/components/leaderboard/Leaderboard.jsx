/* Tabla de posiciones con podio animado + Supabase Realtime */
import { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'motion/react'
import { Trophy, Crown, Medal, Radio } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { compareLeaderboard } from '../../lib/leaderboard'
import { provisionalByUser } from '../../lib/provisional'
import LeaderboardRow from './LeaderboardRow'
import LoadingSpinner from '../ui/LoadingSpinner'

// Total a mostrar: el provisional en vivo si lo hay, si no el oficial.
const liveTotal = (e) => (typeof e._liveTotal === 'number' ? e._liveTotal : (e.total_points || 0))

// Ordena por el total EN VIVO y, a igualdad, por el desempate oficial.
function sortLive(entries) {
  return [...(entries || [])].sort((a, b) => (liveTotal(b) - liveTotal(a)) || compareLeaderboard(a, b))
}

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

              {/* Logros */}
              <div className="flex flex-wrap items-center justify-center gap-1 mb-1.5 min-h-[18px]">
                {entry.is_nostradamus && <span className="inline-flex items-center justify-center bg-black/10 dark:bg-white/10 border border-black/5 dark:border-white/10 rounded px-1 text-[9px] leading-none cursor-default" title="Nostradamus (3 pts exactos)">🔮</span>}
                {entry.is_rey_empate && <span className="inline-flex items-center justify-center bg-black/10 dark:bg-white/10 border border-black/5 dark:border-white/10 rounded px-1 text-[9px] leading-none cursor-default" title="Rey del Empate">⚖️</span>}
                {entry.is_francotirador && <span className="inline-flex items-center justify-center bg-black/10 dark:bg-white/10 border border-black/5 dark:border-white/10 rounded px-1 text-[9px] leading-none cursor-default" title="Francotirador (x2 acertado)">🎯</span>}
                {entry.is_pecho_frio && <span className="inline-flex items-center justify-center bg-black/10 dark:bg-white/10 border border-black/5 dark:border-white/10 rounded px-1 text-[9px] leading-none cursor-default" title="Pecho Frío (x2 fallado)">🧊</span>}
                {entry.is_mas_conocedor && <span className="inline-flex items-center justify-center bg-black/10 dark:bg-white/10 border border-black/5 dark:border-white/10 rounded px-1 text-[9px] leading-none cursor-default" title="El Más Conocedor (5 fallos)">🤡</span>}
                {entry.is_tortuga && <span className="inline-flex items-center justify-center bg-black/10 dark:bg-white/10 border border-black/5 dark:border-white/10 rounded px-1 text-[9px] leading-none cursor-default" title="La Tortuga (predicción al límite)">🐢</span>}
                {entry.is_taylor && <span className="inline-flex items-center justify-center gap-0.5 bg-black/10 dark:bg-white/10 border border-black/5 dark:border-white/10 rounded px-1 py-0.5 text-[9px] font-medium text-slate-700 dark:text-slate-300 leading-none cursor-default" title="Taylor (0T)">💩 0T</span>}
                {entry.is_optimista && <span className="inline-flex items-center justify-center bg-black/10 dark:bg-white/10 border border-black/5 dark:border-white/10 rounded px-1 text-[9px] leading-none cursor-default" title="El Optimista (cree que todo es goleada)">🧨</span>}
                {entry.is_aburrido && <span className="inline-flex items-center justify-center bg-black/10 dark:bg-white/10 border border-black/5 dark:border-white/10 rounded px-1 text-[9px] leading-none cursor-default" title="El Aburrido (ama el 0-0)">🥱</span>}
                {entry.is_fantasma && <span className="inline-flex items-center justify-center bg-black/10 dark:bg-white/10 border border-black/5 dark:border-white/10 rounded px-1 text-[9px] leading-none cursor-default" title="El Fantasma (aún no juega ningún partido)">👻</span>}
                {entry.is_calientabancas && <span className="inline-flex items-center justify-center bg-black/10 dark:bg-white/10 border border-black/5 dark:border-white/10 rounded px-1 text-[9px] leading-none cursor-default" title="Calientabancas (varios partidos y 0 puntos)">🪑</span>}
                {entry.is_gallina && <span className="inline-flex items-center justify-center bg-black/10 dark:bg-white/10 border border-black/5 dark:border-white/10 rounded px-1 text-[9px] leading-none cursor-default" title="El Precavido (nunca usa el comodín)">🐔</span>}
                {entry.is_ludopata && <span className="inline-flex items-center justify-center bg-black/10 dark:bg-white/10 border border-black/5 dark:border-white/10 rounded px-1 text-[9px] leading-none cursor-default" title="Ludópata (adicto al comodín x2)">🎰</span>}
              </div>

              {/* Puntos (total en vivo + delta provisional) */}
              <p className={`text-sm font-bold mb-2 ${iconColors[i]}`}>
                {liveTotal(entry)} pts
                {entry.liveDelta > 0 && (
                  <span className="ml-1 text-[10px] font-bold text-emerald-500 animate-pulse">+{entry.liveDelta}</span>
                )}
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
  const [hasLive, setHasLive] = useState(false)
  const debounceRef = useRef(null)

  // Solo los puntos PROVISIONALES (en vivo): consulta liviana de los partidos en
  // curso + sus predicciones, y actualiza el delta sobre las filas ya cargadas.
  // NO vuelve a pedir la vista pesada user_badges_view (eso era lo que disparaba
  // el consumo en cada evento de realtime).
  const applyProvisional = useCallback(async () => {
    try {
      const { data: live } = await supabase
        .from('matches')
        .select('id, home_goals_actual, away_goals_actual')
        .eq('status', 'in_progress')
      const liveMatches = live || []

      let provisional = {}
      if (liveMatches.length) {
        const { data: preds } = await supabase
          .from('predictions')
          .select('user_id, match_id, prediction_type, home_goals_pred, away_goals_pred, penalties_winner_pred, use_powerup_x2')
          .in('match_id', liveMatches.map((m) => m.id))
        provisional = provisionalByUser(liveMatches, preds || [])
      }
      setHasLive(liveMatches.length > 0)
      setEntries((prev) => sortLive(prev.map((e) => {
        const liveDelta = provisional[e.id] || 0
        return { ...e, liveDelta, _liveTotal: (e.total_points || 0) + liveDelta }
      })))
    } catch (err) {
      console.error('Error puntos en vivo:', err)
    }
  }, [])

  // Carga inicial: la vista pesada UNA vez, luego el provisional liviano.
  const fetchInitial = useCallback(async () => {
    try {
      const { data: lb, error } = await supabase.from('user_badges_view').select('*')
      if (error) throw error
      setEntries(sortLive((lb || []).map((e) => ({ ...e, liveDelta: 0, _liveTotal: e.total_points || 0 }))))
    } catch (err) {
      console.error('Error cargando ranking:', err)
    } finally {
      setLoading(false)
    }
    applyProvisional()
  }, [applyProvisional])

  useEffect(() => {
    fetchInitial()
  }, [fetchInitial])

  useEffect(() => {
    // Realtime eficiente:
    //  - users UPDATE: actualizamos total_points EN SITIO (sin consultar nada).
    //  - matches: recalculamos solo el provisional (consulta liviana, con debounce
    //    para no dispararlo en ráfaga durante el live-sync).
    const debouncedProvisional = () => {
      clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(applyProvisional, 1500)
    }
    const channel = supabase
      .channel('leaderboard-live')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users' }, (payload) => {
        const u = payload.new
        setEntries((prev) => sortLive(prev.map((e) =>
          e.id === u.id
            ? { ...e, total_points: u.total_points, _liveTotal: (u.total_points || 0) + (e.liveDelta || 0) }
            : e
        )))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, debouncedProvisional)
      .subscribe()

    return () => {
      clearTimeout(debounceRef.current)
      supabase.removeChannel(channel)
    }
  }, [applyProvisional])

  if (loading) return <LoadingSpinner />

  const top3 = entries.slice(0, 3)
  const rest = entries.slice(3)

  return (
    <div>
      {/* Aviso de puntos en vivo (provisionales) */}
      {hasLive && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-center gap-2 mb-3 px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-500"
        >
          <Radio size={13} className="animate-pulse" />
          <span className="text-[11px] font-bold">EN VIVO · puntos provisionales (parciales)</span>
        </motion.div>
      )}

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
