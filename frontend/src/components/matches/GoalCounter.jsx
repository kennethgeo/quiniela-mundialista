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
        className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-accent hover:border-accent/40 active:bg-accent/10 transition-all disabled:opacity-20 disabled:cursor-not-allowed touch-manipulation"
      >
        <Plus size={16} strokeWidth={2.5} />
      </motion.button>

      {/* Display del número */}
      <motion.div
        key={value}
        initial={{ scale: 1.4, color: '#2ED3B7' }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 15 }}
        className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] flex items-center justify-center text-xl font-bold font-['JetBrains_Mono'] text-slate-900 dark:text-[#F3F1EA] tabular-nums transition-colors duration-300"
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
        className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-[#0C0C0C] border border-slate-200 dark:border-[#262626] flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-accent hover:border-accent/40 active:bg-accent/10 transition-all disabled:opacity-20 disabled:cursor-not-allowed touch-manipulation"
      >
        <Minus size={16} strokeWidth={2.5} />
      </motion.button>
    </div>
  )
}
