/* Página principal - Dashboard */
import { motion } from 'motion/react'
import { Trophy, Sparkles } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import Dashboard from '../components/dashboard/Dashboard'

export default function DashboardPage() {
  const { profile } = useAuth()
  const displayName = profile?.display_name || 'Jugador'

  // Determine time-based greeting
  const hour = new Date().getHours()
  const greeting =
    hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches'

  return (
    <div className="relative h-full pb-4 bg-world-cup">
      {/* ── Hero Section ── */}
      <div className="relative overflow-hidden">
        {/* Ambient gradient orbs */}
        <div className="absolute -top-20 -left-20 w-64 h-64 rounded-full bg-accent/8 blur-3xl pointer-events-none" />
        <div className="absolute -top-10 right-0 w-48 h-48 rounded-full bg-gold/6 blur-3xl pointer-events-none" />
        <div className="absolute top-20 left-1/2 w-32 h-32 rounded-full bg-accent/5 blur-2xl pointer-events-none" />

        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 px-5 pt-6 pb-2"
        >
          {/* World Cup badge */}
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="flex items-center gap-2 mb-4"
          >
            <div className="w-8 h-8 rounded-xl gradient-gold flex items-center justify-center shadow-lg shadow-amber-500/20">
              <Trophy size={16} className="text-slate-900" />
            </div>
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-amber-400/80">
              Mundial 2026
            </span>
          </motion.div>

          {/* Greeting */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
          >
            <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">{greeting},</p>
            <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white mt-0.5 tracking-tight">
              {displayName}{' '}
              <motion.span
                animate={{ rotate: [0, 14, -8, 14, 0] }}
                transition={{ duration: 1.5, delay: 0.8, ease: 'easeInOut' }}
                className="inline-block"
              >
                👋
              </motion.span>
            </h1>
          </motion.div>

          {/* Motivational message */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45, duration: 0.5 }}
            className="flex items-center gap-2 mt-3 glass-card px-3.5 py-2.5 w-fit"
          >
            <Sparkles size={14} className="text-accent shrink-0" />
            <p className="text-xs text-slate-700 dark:text-slate-300 font-medium">
              ¡Predice los resultados y compite por la gloria! ⚽🏆
            </p>
          </motion.div>
        </motion.div>
      </div>

      {/* ── Dashboard Content ── */}
      <div className="relative z-10 px-4 mt-4">
        <Dashboard />
      </div>
    </div>
  )
}
