/* Página del Bracket - Fases eliminatorias */
import { Swords, Sparkles } from 'lucide-react'
import { motion } from 'motion/react'
import BracketView from '../components/matches/BracketView'

export default function BracketPage() {
  return (
    <div className="px-4 py-5 relative">
      {/* Premium header */}
      <motion.div
        initial={{ opacity: 0, y: -15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-6 relative z-10"
      >
        <div className="flex items-center gap-3 mb-1.5">
          <div className="w-10 h-10 rounded-2xl gradient-gold flex items-center justify-center shadow-lg shadow-amber-500/20">
            <Swords size={20} className="text-slate-900" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Fases Eliminatorias</h1>
            <p className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
              <Sparkles size={12} className="text-accent" />
              <span>FIFA World Cup 2026™</span>
              <span className="w-1 h-1 rounded-full bg-accent inline-block" />
              <span className="text-accent font-semibold">Camino al título</span>
            </p>
          </div>
        </div>

        {/* Decorative line */}
        <div className="mt-4 h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      </motion.div>

      <BracketView />
    </div>
  )
}
