// Modal con las estadísticas de un jugador (se abre al tocarlo en el ranking).
import { motion, AnimatePresence } from 'motion/react'
import { X, Target, Zap, Goal, Crown } from 'lucide-react'

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

export default function PlayerStatsModal({ entry, isCurrentUser, onClose }) {
  if (!entry) return null

  const exact = entry.exact_count || 0
  const correct = entry.correct_count || 0 // incluye exactos
  const winnerOnly = Math.max(0, correct - exact)
  const badges = BADGES.filter((b) => entry[b.key])

  const Stat = ({ icon: Icon, label, value, color }) => (
    <div className="bg-slate-50 dark:bg-white/[0.03] rounded-2xl p-4 border border-slate-100 dark:border-white/5 flex flex-col items-center text-center">
      <Icon size={18} className={color} />
      <span className="text-2xl font-black text-slate-900 dark:text-white mt-1">{value}</span>
      <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mt-0.5">{label}</span>
    </div>
  )

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
      >
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 40, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full sm:max-w-md bg-white dark:bg-[#12121a] rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-white/10 shadow-2xl overflow-hidden max-h-[85vh] overflow-y-auto"
        >
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
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Stat icon={Target} label="Marcadores exactos" value={exact} color="text-amber-500" />
              <Stat icon={Goal} label="Acierto ganador" value={winnerOnly} color="text-emerald-500" />
              <Stat icon={Goal} label="Goles del goleador" value={entry.scorer_goals || 0} color="text-blue-500" />
              <Stat icon={Crown} label="Acertó campeón" value={entry.champion_hit ? 'Sí' : 'No'} color="text-purple-500" />
            </div>

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
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
