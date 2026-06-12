// Dashboard principal - vista de inicio con resumen del estado del usuario
import { motion } from 'motion/react'
import UserPoints from './UserPoints'
import LiveNow from './LiveNow'
import UpcomingMatches from './UpcomingMatches'
import RecentResults from './RecentResults'
import TopRanking from './TopRanking'

/** Stagger container for child animations */
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.12,
      delayChildren: 0.1,
    },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  },
}

export default function Dashboard() {
  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-6"
    >
      {/* ── Puntos del usuario ── */}
      <motion.div variants={itemVariants} className="md:col-span-1">
        <UserPoints />
      </motion.div>

      {/* ── Top ranking (pasó arriba en PC) ── */}
      <motion.div variants={itemVariants} className="md:col-span-1 lg:col-span-2">
        <TopRanking />
      </motion.div>

      {/* ── Jugando ahora (en vivo) — no renderiza nada si no hay partidos ── */}
      <LiveNow />

      {/* ── Próximos partidos ── */}
      <motion.div variants={itemVariants} className="md:col-span-2 lg:col-span-3">
        <UpcomingMatches />
      </motion.div>

      {/* ── Resultados (finalizados) ── */}
      <motion.div variants={itemVariants} className="md:col-span-2 lg:col-span-3">
        <RecentResults />
      </motion.div>
    </motion.div>
  )
}
