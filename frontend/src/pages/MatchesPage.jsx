/* Página de partidos - Fase de Grupos / Finalizados */
import { useState } from 'react'
import { Calendar, Trophy, CheckCircle2 } from 'lucide-react'
import { motion } from 'motion/react'
import GroupStage from '../components/matches/GroupStage'
import FinishedMatches from '../components/matches/FinishedMatches'

export default function MatchesPage() {
  const [tab, setTab] = useState('groups') // 'groups' | 'finished'

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
            <Trophy size={20} className="text-slate-900" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Partidos</h1>
            <p className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
              <Calendar size={12} />
              <span>FIFA World Cup 2026™</span>
              <span className="w-1 h-1 rounded-full bg-accent inline-block" />
              <span className="text-accent font-semibold">12 Grupos</span>
            </p>
          </div>
        </div>

        {/* Decorative line */}
        <div className="mt-4 h-px w-full bg-gradient-to-r from-transparent via-slate-300 dark:via-white/10 to-transparent" />
      </motion.div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 relative z-10">
        <button
          onClick={() => setTab('groups')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
            tab === 'groups'
              ? 'bg-accent text-white shadow-lg shadow-accent/20'
              : 'glass-strong text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 bg-white dark:bg-transparent'
          }`}
        >
          <Trophy size={15} /> Fase de Grupos
        </button>
        <button
          onClick={() => setTab('finished')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
            tab === 'finished'
              ? 'bg-accent text-white shadow-lg shadow-accent/20'
              : 'glass-strong text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 bg-white dark:bg-transparent'
          }`}
        >
          <CheckCircle2 size={15} /> Finalizados
        </button>
      </div>

      {tab === 'groups' ? <GroupStage /> : <FinishedMatches />}
    </div>
  )
}
