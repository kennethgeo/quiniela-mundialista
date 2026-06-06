// Tarjeta animada de puntos totales del usuario
import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Star, TrendingUp, Zap } from 'lucide-react'
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
      className="relative overflow-hidden rounded-2xl"
    >
      {/* ── Neon gradient border (outer glow) ── */}
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-purple-500/40 via-cyan-500/20 to-purple-600/30 p-[1px]">
        <div className="w-full h-full rounded-2xl bg-slate-950/90" />
      </div>

      {/* ── Card content ── */}
      <div className="relative p-6">
        {/* Decorative ambient glows */}
        <div className="absolute -top-16 -right-16 w-40 h-40 rounded-full bg-purple-500/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-12 -left-12 w-32 h-32 rounded-full bg-cyan-500/15 blur-3xl pointer-events-none" />
        <div className="absolute top-0 left-1/3 w-24 h-24 rounded-full bg-pink-500/10 blur-2xl pointer-events-none" />

        {/* Header label */}
        <div className="relative flex items-center gap-2 mb-4">
          <Zap size={12} className="text-purple-400" />
          <p className="text-[11px] text-purple-400/90 uppercase tracking-[0.2em] font-bold">
            Tus Puntos
          </p>
        </div>

        {/* Main content row */}
        <div className="relative flex items-center justify-between">
          {/* Points display */}
          <div className="space-y-1">
            <div className="flex items-baseline gap-3">
              <motion.span
                key={displayPoints}
                initial={{ scale: 1.1, opacity: 0.7 }}
                animate={{ scale: 1, opacity: 1 }}
                className="text-5xl font-black tabular-nums bg-gradient-to-br from-purple-400 via-cyan-400 to-purple-500 bg-clip-text text-transparent drop-shadow-lg px-1 -ml-1"
              >
                {displayPoints}
              </motion.span>
              <span className="text-sm font-semibold text-purple-400/60 uppercase tracking-wider">
                pts
              </span>
            </div>
          </div>

          {/* Animated star icon with glow */}
          <motion.div
            animate={{ rotate: [0, 10, -10, 0] }}
            transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
            className="relative"
          >
            {/* Glow ring */}
            <div className="absolute inset-0 rounded-2xl bg-purple-500/20 blur-xl scale-125" />
            <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500/30 to-cyan-500/20 border border-purple-500/30 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Star size={30} className="text-cyan-400" fill="currentColor" />
            </div>
          </motion.div>
        </div>

        {/* Indicador de tendencia */}
        <div className="relative flex items-center gap-1.5 mt-5 pt-4 border-t border-white/5">
          <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-semibold">
            <TrendingUp size={14} />
            <span>Sigue prediciendo para ganar más puntos</span>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
