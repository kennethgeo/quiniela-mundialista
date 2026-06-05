// Tarjeta animada de puntos totales del usuario
import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Star, TrendingUp } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'

export default function UserPoints() {
  const { profile } = useAuth()
  const totalPoints = profile?.total_points ?? 0
  const [displayPoints, setDisplayPoints] = useState(0)

  // Animación de contador incremental
  useEffect(() => {
    if (totalPoints === 0) {
      setDisplayPoints(0)
      return
    }

    const duration = 1200 // ms
    const steps = 40
    const increment = totalPoints / steps
    let current = 0
    let step = 0

    const timer = setInterval(() => {
      step++
      current = Math.min(Math.round(increment * step), totalPoints)
      setDisplayPoints(current)

      if (step >= steps) {
        clearInterval(timer)
        setDisplayPoints(totalPoints)
      }
    }, duration / steps)

    return () => clearInterval(timer)
  }, [totalPoints])

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="glass p-5 relative overflow-hidden"
    >
      {/* Brillo de fondo decorativo */}
      <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-accent/10 blur-2xl" />

      <div className="relative flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-xs text-slate-400 uppercase tracking-wider font-medium">
            Tus Puntos
          </p>
          <div className="flex items-baseline gap-2">
            <motion.span
              key={displayPoints}
              className="text-4xl font-extrabold text-white tabular-nums"
            >
              {displayPoints}
            </motion.span>
            <span className="text-sm text-slate-400">pts</span>
          </div>
        </div>

        {/* Ícono decorativo */}
        <motion.div
          animate={{ rotate: [0, 10, -10, 0] }}
          transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
          className="w-14 h-14 rounded-2xl bg-accent/20 flex items-center justify-center"
        >
          <Star size={28} className="text-accent" fill="currentColor" />
        </motion.div>
      </div>

      {/* Indicador de tendencia */}
      <div className="flex items-center gap-1 mt-3 text-success text-xs font-medium">
        <TrendingUp size={14} />
        <span>Sigue prediciendo para ganar más puntos</span>
      </div>
    </motion.div>
  )
}
