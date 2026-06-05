// Spinner de carga a pantalla completa con balón de fútbol animado
import { motion } from 'motion/react'

export default function LoadingSpinner({ message = 'Cargando...' }) {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-primary/80 backdrop-blur-sm z-50">
      {/* Balón animado */}
      <motion.div
        animate={{
          rotate: 360,
          y: [0, -20, 0],
        }}
        transition={{
          rotate: { duration: 1.5, repeat: Infinity, ease: 'linear' },
          y: { duration: 0.8, repeat: Infinity, ease: 'easeInOut' },
        }}
        className="text-5xl mb-4"
      >
        ⚽
      </motion.div>

      {/* Sombra del balón */}
      <motion.div
        animate={{ scale: [1, 0.7, 1], opacity: [0.3, 0.15, 0.3] }}
        transition={{ duration: 0.8, repeat: Infinity, ease: 'easeInOut' }}
        className="w-10 h-2 bg-white/20 rounded-full blur-sm mb-4"
      />

      {/* Texto de carga */}
      <p className="text-slate-400 text-sm font-medium">{message}</p>
    </div>
  )
}
