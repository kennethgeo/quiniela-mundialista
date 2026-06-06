// Dashboard principal - vista de inicio con resumen del estado del usuario
import { motion } from 'motion/react'
import UserPoints from './UserPoints'
import UpcomingMatches from './UpcomingMatches'
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
      className="space-y-6 pb-6"
    >
      {/* ── Puntos del usuario ── */}
      <motion.div variants={itemVariants}>
        <UserPoints />
      </motion.div>

      {/* ── Próximos partidos ── */}
      <motion.div variants={itemVariants}>
        <UpcomingMatches />
      </motion.div>

      {/* ── Separador visual sutil ── */}
      <motion.div variants={itemVariants}>
        <div className="h-px bg-gradient-to-r from-transparent via-white/8 to-transparent" />
      </motion.div>

      {/* ── Top ranking ── */}
      <motion.div variants={itemVariants}>
        <TopRanking />
      </motion.div>
    </motion.div>
  )
}
