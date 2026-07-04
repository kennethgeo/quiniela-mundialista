// Modal con las estadísticas de un jugador (se abre al tocarlo en el ranking).
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, useDragControls } from 'motion/react'
import { X, Target, Goal, Crown, Zap, XCircle, Percent, Trophy, Swords } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const BADGES = [
  { key: 'is_nostradamus', emoji: '🔮', name: 'Nostradamus', desc: '3+ marcadores exactos' },
  { key: 'is_rey_empate', emoji: '⚖️', name: 'Rey del Empate', desc: '3+ empates acertados' },
  { key: 'is_francotirador', emoji: '🎯', name: 'Francotirador', desc: 'Acierto con x2' },
  { key: 'is_pecho_frio', emoji: '🧊', name: 'Pecho Frío', desc: 'x2 fallado' },
  { key: 'is_mas_conocedor', emoji: '🤡', name: 'El Más Conocedor', desc: '5 fallos' },
  { key: 'is_tortuga', emoji: '🐢', name: 'La Tortuga', desc: 'Predicción al límite' },
  { key: 'is_taylor', emoji: '💩', name: 'Taylor', desc: '0T' },
  { key: 'is_optimista', emoji: '🧨', name: 'El Optimista', desc: 'Todo es goleada' },
  { key: 'is_aburrido', emoji: '🥱', name: 'El Aburrido', desc: 'Ama el 0-0' },
  { key: 'is_fantasma', emoji: '👻', name: 'El Fantasma', desc: 'Aún no juega' },
  { key: 'is_calientabancas', emoji: '🪑', name: 'Calientabancas', desc: 'Varios partidos, 0 pts' },
  { key: 'is_gallina', emoji: '🐔', name: 'El Precavido', desc: 'Nunca usa el comodín' },
  { key: 'is_ludopata', emoji: '🎰', name: 'Ludópata', desc: 'Adicto al x2' },
]

// Calcula estadísticas a partir de las predicciones del jugador en partidos ya jugados.
function computeStats(preds) {
  const played = (preds || []).filter((p) => p.match?.status === 'finished')
  const s = {
    total: played.length,
    hits: 0,
    misses: 0,
    powerupsUsed: 0,
    powerupsHit: 0,
    groupPoints: 0,
    knockoutPoints: 0,
    bestPoints: 0,
  }
  for (const p of played) {
    const pts = p.points_earned || 0
    if (pts > 0) s.hits++
    else s.misses++
    if (p.use_powerup_x2) {
      s.powerupsUsed++
      if (pts > 0) s.powerupsHit++
    }
    if (p.match?.phase === 'groups') s.groupPoints += pts
    else s.knockoutPoints += pts
    if (pts > s.bestPoints) s.bestPoints = pts
  }
  s.accuracy = s.total > 0 ? Math.round((s.hits / s.total) * 100) : 0
  return s
}

export default function PlayerStatsModal({ entry, isCurrentUser, onClose }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)
  const overlayRef = useRef(null)
  const dragControls = useDragControls()

  useEffect(() => {
    if (!entry?.id) return
    let cancelled = false
    setStats(null)
    setLoading(true)
    ;(async () => {
      try {
        // RLS: de otros jugadores solo llegan predicciones de partidos no-pendientes.
        const { data } = await supabase
          .from('predictions')
          .select('points_earned, use_powerup_x2, match:matches(status, phase)')
          .eq('user_id', entry.id)
        if (!cancelled) setStats(computeStats(data))
      } catch {
        if (!cancelled) setStats(computeStats([]))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [entry?.id])

  if (!entry) return null

  const exact = entry.exact_count || 0
  const correct = entry.correct_count || 0 // incluye exactos
  const winnerOnly = Math.max(0, correct - exact)
  const badges = BADGES.filter((b) => entry[b.key])

  const Stat = ({ icon: Icon, label, value, sub, color }) => (
    <div className="bg-slate-50 dark:bg-white/[0.03] rounded-2xl p-3.5 border border-slate-100 dark:border-white/5 flex flex-col items-center text-center">
      <Icon size={17} className={color} />
      <span className="text-2xl font-black text-slate-900 dark:text-white mt-1 leading-none">{value}</span>
      {sub && <span className="text-[10px] text-slate-400 font-medium mt-0.5">{sub}</span>}
      <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mt-1">{label}</span>
    </div>
  )

  const modal = (
    <AnimatePresence>
      <motion.div
        ref={overlayRef}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
      >
        <motion.div
          drag="y"
          dragListener={false}
          dragControls={dragControls}
          dragConstraints={overlayRef}
          dragElastic={0.12}
          dragMomentum={false}
          onDragEnd={(_, info) => { if (info.offset.y > 140 && info.velocity.y >= 0) onClose() }}
          initial={{ opacity: 0, y: 40, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 40, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full sm:max-w-md bg-white dark:bg-[#12121a] rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-white/10 shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
        >
          {/* Asa para arrastrar el panel a la altura deseada (o deslizar para cerrar) */}
          <div
            onPointerDown={(e) => dragControls.start(e)}
            className="shrink-0 flex justify-center pt-2.5 pb-1 cursor-grab active:cursor-grabbing touch-none"
          >
            <div className="h-1.5 w-11 rounded-full bg-slate-300 dark:bg-white/20" />
          </div>

          <div className="overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]">
          {/* Header */}
          <div className="relative p-6 pb-5 bg-gradient-to-br from-accent/15 to-transparent">
            <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors">
              <X size={16} />
            </button>
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-accent/30 to-primary-lighter flex items-center justify-center text-2xl font-bold overflow-hidden shrink-0 ring-2 ring-accent/30">
                {entry.avatar_url ? (
                  <img src={entry.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-accent">{entry.display_name?.charAt(0).toUpperCase()}</span>
                )}
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white truncate">
                  {entry.display_name}
                  {isCurrentUser && <span className="text-[10px] text-accent font-bold ml-1.5">· Tú</span>}
                </h3>
                <p className="text-sm">
                  <span className="text-2xl font-black bg-gradient-to-r from-accent to-purple-500 bg-clip-text text-transparent">{entry.total_points ?? 0}</span>
                  <span className="text-slate-500 text-xs font-semibold ml-1">puntos</span>
                </p>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="p-5 space-y-5">
            {/* Aciertos */}
            <div>
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Aciertos</p>
              <div className="grid grid-cols-2 gap-3">
                <Stat icon={Target} label="Marcadores exactos" value={exact} color="text-amber-500" />
                <Stat icon={Goal} label="Acierto ganador" value={winnerOnly} color="text-emerald-500" />
                <Stat icon={XCircle} label="Fallos" value={loading ? '—' : (stats?.misses ?? 0)} color="text-rose-500" />
                <Stat
                  icon={Percent}
                  label="Efectividad"
                  value={loading ? '—' : `${stats?.accuracy ?? 0}%`}
                  sub={loading ? null : `${stats?.hits ?? 0}/${stats?.total ?? 0} jugados`}
                  color="text-cyan-500"
                />
              </div>
            </div>

            {/* Comodín + Global */}
            <div>
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Comodín y global</p>
              <div className="grid grid-cols-2 gap-3">
                <Stat
                  icon={Zap}
                  label="Comodín x2"
                  value={loading ? '—' : (stats?.powerupsUsed ?? 0)}
                  sub={loading ? null : `${stats?.powerupsHit ?? 0} acertados`}
                  color="text-purple-500"
                />
                <Stat icon={Goal} label="Goles del goleador" value={entry.scorer_goals || 0} color="text-blue-500" />
                <Stat icon={Crown} label="Acertó campeón" value={entry.champion_hit ? 'Sí' : 'No'} color="text-fuchsia-500" />
                <Stat icon={Trophy} label="Mejor partido" value={loading ? '—' : (stats?.bestPoints ?? 0)} sub="pts en un match" color="text-gold" />
              </div>
            </div>

            {/* Puntos por fase */}
            {!loading && stats && (stats.groupPoints > 0 || stats.knockoutPoints > 0) && (
              <div>
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Puntos por fase</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-50 dark:bg-white/[0.03] rounded-2xl p-3.5 border border-slate-100 dark:border-white/5 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
                      <Goal size={16} className="text-emerald-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-lg font-black text-slate-900 dark:text-white leading-none">{stats.groupPoints}</p>
                      <p className="text-[10px] text-slate-500 font-semibold mt-0.5">Fase de grupos</p>
                    </div>
                  </div>
                  <div className="bg-slate-50 dark:bg-white/[0.03] rounded-2xl p-3.5 border border-slate-100 dark:border-white/5 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-purple-500/10 flex items-center justify-center shrink-0">
                      <Swords size={16} className="text-purple-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-lg font-black text-slate-900 dark:text-white leading-none">{stats.knockoutPoints}</p>
                      <p className="text-[10px] text-slate-500 font-semibold mt-0.5">Eliminatoria</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Logros */}
            <div>
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Logros</p>
              {badges.length === 0 ? (
                <p className="text-sm text-slate-400 italic">Aún sin logros.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {badges.map((b) => (
                    <div key={b.key} className="flex items-center gap-1.5 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-full pl-1.5 pr-2.5 py-1" title={b.desc}>
                      <span className="text-sm">{b.emoji}</span>
                      <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">{b.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )

  return createPortal(modal, document.body)
}
