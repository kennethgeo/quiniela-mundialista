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
  const liveTotal = typeof entry._liveTotal === 'number' ? entry._liveTotal : entry.total_points
  const liveDelta = entry.liveDelta || 0

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
        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          {entry.is_nostradamus && <span className="inline-flex items-center justify-center bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[10px] leading-none cursor-default" title="Nostradamus (3 pts exactos)">🔮</span>}
          {entry.is_rey_empate && <span className="inline-flex items-center justify-center bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[10px] leading-none cursor-default" title="Rey del Empate">⚖️</span>}
          {entry.is_francotirador && <span className="inline-flex items-center justify-center bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[10px] leading-none cursor-default" title="Francotirador (x2 acertado)">🎯</span>}
          {entry.is_pecho_frio && <span className="inline-flex items-center justify-center bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[10px] leading-none cursor-default" title="Pecho Frío (x2 fallado)">🧊</span>}
          {entry.is_mas_conocedor && <span className="inline-flex items-center justify-center bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[10px] leading-none cursor-default" title="El Más Conocedor (5 fallos)">🤡</span>}
          {entry.is_tortuga && <span className="inline-flex items-center justify-center bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[10px] leading-none cursor-default" title="La Tortuga (predicción al límite)">🐢</span>}
          {entry.is_taylor && <span className="inline-flex items-center justify-center gap-1 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[10px] font-medium text-slate-300 leading-none cursor-default" title="Taylor (0T)">💩 0T</span>}
          {entry.is_optimista && <span className="inline-flex items-center justify-center bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[10px] leading-none cursor-default" title="El Optimista (cree que todo es goleada)">🧨</span>}
          {entry.is_aburrido && <span className="inline-flex items-center justify-center bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[10px] leading-none cursor-default" title="El Aburrido (ama el 0-0)">🥱</span>}
          {entry.is_fantasma && <span className="inline-flex items-center justify-center bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[10px] leading-none cursor-default" title="El Fantasma (aún no juega ningún partido)">👻</span>}
          {entry.is_calientabancas && <span className="inline-flex items-center justify-center bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[10px] leading-none cursor-default" title="Calientabancas (varios partidos y 0 puntos)">🪑</span>}
          {entry.is_gallina && <span className="inline-flex items-center justify-center bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[10px] leading-none cursor-default" title="El Precavido (nunca usa el comodín)">🐔</span>}
          {entry.is_ludopata && <span className="inline-flex items-center justify-center bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[10px] leading-none cursor-default" title="Ludópata (adicto al comodín x2)">🎰</span>}
        </div>
      </div>

      {/* Puntos (total en vivo + delta provisional) */}
      <div className={`text-right ${isTopThree ? medalColors[position] : 'text-slate-300'}`}>
        <div className="flex items-center justify-end gap-1">
          <span className="text-lg font-bold tabular-nums">{liveTotal}</span>
          {liveDelta > 0 && (
            <span className="text-[10px] font-bold text-emerald-500 animate-pulse">+{liveDelta}</span>
          )}
        </div>
        <span className="text-xs text-slate-500">pts</span>
      </div>
    </motion.div>
  )
}
