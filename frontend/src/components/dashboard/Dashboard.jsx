// Dashboard principal - vista de inicio con resumen del estado del usuario
import { motion } from 'motion/react'
import { useAuth } from '../../hooks/useAuth'
import UserPoints from './UserPoints'
import UpcomingMatches from './UpcomingMatches'
import TopRanking from './TopRanking'

export default function Dashboard() {
  const { profile } = useAuth()
  const displayName = profile?.display_name || 'Jugador'

  return (
    <div className="space-y-6 pb-4">
      {/* Saludo con animación */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-1"
      >
        <h2 className="text-2xl font-bold text-white">
          ¡Hola, {displayName}! 👋
        </h2>
        <p className="text-sm text-slate-400">
          Revisa tus predicciones y sube en el ranking
        </p>
      </motion.div>

      {/* Tarjeta de puntos */}
      <UserPoints />

      {/* Próximos partidos */}
      <UpcomingMatches />

      {/* Top ranking */}
      <TopRanking />
    </div>
  )
}
