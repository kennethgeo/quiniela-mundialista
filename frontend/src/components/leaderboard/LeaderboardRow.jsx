/* Fila individual del leaderboard */
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

export default function LeaderboardRow({ entry, isCurrentUser }) {
  const isTopThree = entry.rank <= 3

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${
        isCurrentUser
          ? 'bg-accent/10 border border-accent/20'
          : 'hover:bg-white/[0.03]'
      }`}
    >
      {/* Posición */}
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
        isTopThree
          ? `${medalBg[entry.rank]} border ${medalColors[entry.rank]}`
          : 'bg-white/5 text-slate-500'
      }`}>
        {isTopThree ? <Trophy size={14} /> : entry.rank}
      </div>

      {/* Avatar */}
      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-accent/30 to-primary-lighter flex items-center justify-center text-sm font-bold text-accent overflow-hidden">
        {entry.avatar_url ? (
          <img src={entry.avatar_url} alt="" className="w-full h-full object-cover" />
        ) : (
          entry.display_name?.charAt(0).toUpperCase() || '?'
        )}
      </div>

      {/* Nombre */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${isCurrentUser ? 'text-accent' : 'text-slate-200'}`}>
          {entry.display_name}
          {isCurrentUser && <span className="text-xs text-slate-400 ml-1">(tú)</span>}
        </p>
      </div>

      {/* Puntos */}
      <div className={`text-right ${isTopThree ? medalColors[entry.rank] : 'text-slate-300'}`}>
        <span className="text-lg font-bold">{entry.total_points}</span>
        <span className="text-xs text-slate-500 ml-1">pts</span>
      </div>
    </motion.div>
  )
}
