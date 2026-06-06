// Stepper de goles optimizado para móvil con botones [-] y [+]
import { motion } from 'motion/react'
import { Minus, Plus } from 'lucide-react'

export default function GoalCounter({ value = 0, onChange, disabled = false }) {
  const handleDecrement = () => {
    if (value > 0 && !disabled) {
      onChange(value - 1)
    }
  }

  const handleIncrement = () => {
    if (value < 20 && !disabled) {
      onChange(value + 1)
    }
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      {/* Botón incrementar */}
      <motion.button
        type="button"
        whileTap={{ scale: 0.82 }}
        whileHover={{ scale: 1.05 }}
        onClick={handleIncrement}
        disabled={disabled || value >= 20}
        className="w-11 h-11 rounded-2xl glass-strong flex items-center justify-center text-slate-300 hover:text-amber-400 hover:border-amber-500/30 active:bg-amber-500/10 transition-all disabled:opacity-20 disabled:cursor-not-allowed touch-manipulation"
      >
        <Plus size={18} strokeWidth={2.5} />
      </motion.button>

      {/* Display del número */}
      <motion.div
        key={value}
        initial={{ scale: 1.4, color: '#f59e0b' }}
        animate={{ scale: 1, color: '#ffffff' }}
        transition={{ type: 'spring', stiffness: 400, damping: 15 }}
        className="w-12 h-12 rounded-2xl bg-white/[0.06] border border-white/10 flex items-center justify-center text-2xl font-bold tabular-nums shadow-inner"
      >
        {value}
      </motion.div>

      {/* Botón decrementar */}
      <motion.button
        type="button"
        whileTap={{ scale: 0.82 }}
        whileHover={{ scale: 1.05 }}
        onClick={handleDecrement}
        disabled={disabled || value <= 0}
        className="w-11 h-11 rounded-2xl glass-strong flex items-center justify-center text-slate-300 hover:text-amber-400 hover:border-amber-500/30 active:bg-amber-500/10 transition-all disabled:opacity-20 disabled:cursor-not-allowed touch-manipulation"
      >
        <Minus size={18} strokeWidth={2.5} />
      </motion.button>
    </div>
  )
}
