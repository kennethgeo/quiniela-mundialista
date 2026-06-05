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
    <div className="flex items-center gap-1">
      {/* Botón decrementar */}
      <motion.button
        type="button"
        whileTap={{ scale: 0.85 }}
        onClick={handleDecrement}
        disabled={disabled || value <= 0}
        className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <Minus size={16} />
      </motion.button>

      {/* Display del número */}
      <motion.div
        key={value}
        initial={{ scale: 1.3, color: '#fbbf24' }}
        animate={{ scale: 1, color: '#ffffff' }}
        transition={{ duration: 0.2 }}
        className="w-10 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-lg font-bold tabular-nums"
      >
        {value}
      </motion.div>

      {/* Botón incrementar */}
      <motion.button
        type="button"
        whileTap={{ scale: 0.85 }}
        onClick={handleIncrement}
        disabled={disabled || value >= 20}
        className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <Plus size={16} />
      </motion.button>
    </div>
  )
}
