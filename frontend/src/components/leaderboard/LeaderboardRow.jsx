/* Fila individual del leaderboard — Diseño Premium */
import { motion } from 'motion/react'
import { Trophy } from 'lucide-react'

const medalColors = {
  1: 'text-gold',
  2: 'text-silver',
  3: 'text-bronze',
}

const medalBg = {
  1: 'bg-gold/10 border-gold/30',
  2: 'bg-silver/10 border-silver/30',
  3: 'bg-bronze/10 border-bronze/30',
}

export default function LeaderboardRow({ entry, position, isCurrentUser }) {
  const isTopThree = position <= 3

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(position * 0.03, 0.5) }}
      className={`flex items-center gap-3 p-3.5 rounded-2xl transition-all duration-300 ${
        isCurrentUser
          ? 'bg-accent/10 border border-accent/20 shadow-[0_0_20px_rgba(245,158,11,0.08)]'
          : 'hover:bg-white/[0.04]'
      }`}
    >
      {/* Posición */}
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 ${
        isTopThree
          ? `${medalBg[position]} border ${medalColors[position]}`
          : 'bg-white/5 text-slate-500'
      }`}>
        {isTopThree ? <Trophy size={14} /> : position}
      </div>

      {/* Avatar */}
      <div className={`w-10 h-10 rounded-full bg-gradient-to-br from-accent/30 to-primary-lighter flex items-center justify-center text-sm font-bold overflow-hidden shrink-0 ${
        isCurrentUser ? 'ring-2 ring-accent/40' : ''
      }`}>
        {entry.avatar_url ? (
          <img src={entry.avatar_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className={isTopThree ? medalColors[position] : 'text-accent'}>{entry.display_name?.charAt(0).toUpperCase() || '?'}</span>
        )}
      </div>

      {/* Nombre y Medallas */}
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className="flex items-center gap-1">
          <p className={`text-sm font-semibold truncate ${isCurrentUser ? 'text-accent' : 'text-slate-200'}`}>
            {entry.display_name}
            {isCurrentUser && <span className="text-xs text-accent/60 ml-1.5">(tú)</span>}
          </p>
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          {entry.is_nostradamus && <span title="Nostradamus (3 pts exactos)">🔮</span>}
          {entry.is_rey_empate && <span title="Rey del Empate">⚖️</span>}
          {entry.is_francotirador && <span title="Francotirador (x2 acertado)">🎯</span>}
          {entry.is_pecho_frio && <span title="Pecho Frío (x2 fallado)">🧊</span>}
          {entry.is_mas_conocedor && <span title="El Más Conocedor (5 fallos)">🤡</span>}
          {entry.is_tortuga && <span title="La Tortuga (predicción al límite)">🐢</span>}
          {entry.is_taylor && <span title="Taylor (0T)">0T 💩</span>}
        </div>
      </div>

      {/* Puntos */}
      <div className={`text-right ${isTopThree ? medalColors[position] : 'text-slate-300'}`}>
        <span className="text-lg font-bold tabular-nums">{entry.total_points}</span>
        <span className="text-xs text-slate-500 ml-1">pts</span>
      </div>
    </motion.div>
  )
}
