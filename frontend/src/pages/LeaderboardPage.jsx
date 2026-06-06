/* Página de Ranking */
import { motion } from 'motion/react'
import { Crown, Sparkles } from 'lucide-react'
import Leaderboard from '../components/leaderboard/Leaderboard'

export default function LeaderboardPage() {
  return (
    <div className="px-4 py-6">
      {/* Premium header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3 mb-6"
      >
        <div className="gradient-gold p-2.5 rounded-2xl shadow-lg shadow-amber-500/20">
          <Crown size={22} className="text-slate-950" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Ranking</h1>
          <p className="text-xs text-slate-500 flex items-center gap-1">
            <Sparkles size={10} className="text-amber-400" />
            Tabla de posiciones en vivo
          </p>
        </div>
      </motion.div>

      <Leaderboard />
    </div>
  )
}
