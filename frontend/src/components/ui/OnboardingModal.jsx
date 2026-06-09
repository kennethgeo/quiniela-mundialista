import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Trophy, Zap, Clock, ChevronRight, X } from 'lucide-react'

const SLIDES = [
  {
    title: '¡Bienvenido al Mundial!',
    description: 'Demuestra cuánto sabes de fútbol. Predice los marcadores y compite contra tus amigos por la gloria.',
    icon: Trophy,
    color: 'text-gold',
    bg: 'from-amber-400/20 to-amber-600/20'
  },
  {
    title: 'Sistema de Puntos',
    description: 'Acierta el ganador para ganar 1 punto, o acierta el marcador exacto para llevarte 3 puntos. ¡Cada gol cuenta!',
    icon: Trophy,
    color: 'text-emerald-500',
    bg: 'from-emerald-400/20 to-emerald-600/20'
  },
  {
    title: 'Comodín Rayo x2',
    description: '¿Estás muy seguro de un partido? Usa tu rayo ⚡ para duplicar tus puntos. ¡Gana hasta 6 puntos en un solo juego! Pero úsalo sabiamente, son limitados.',
    icon: Zap,
    color: 'text-accent',
    bg: 'from-accent/20 to-accent-dark/20'
  },
  {
    title: 'El Tiempo es Clave',
    description: 'Recuerda que los partidos se bloquean automáticamente 15 minutos antes de que empiece a rodar el balón. ¡No te quedes por fuera!',
    icon: Clock,
    color: 'text-blue-500',
    bg: 'from-blue-400/20 to-blue-600/20'
  }
]

export default function OnboardingModal() {
  const [isOpen, setIsOpen] = useState(false)
  const [currentSlide, setCurrentSlide] = useState(0)

  useEffect(() => {
    const hasSeenTutorial = localStorage.getItem('tutorial_seen')
    if (!hasSeenTutorial) {
      setIsOpen(true)
    }
  }, [])

  const handleNext = () => {
    if (currentSlide < SLIDES.length - 1) {
      setCurrentSlide(prev => prev + 1)
    } else {
      handleClose()
    }
  }

  const handleClose = () => {
    localStorage.setItem('tutorial_seen', 'true')
    setIsOpen(false)
  }

  if (!isOpen) return null

  const slide = SLIDES[currentSlide]
  const Icon = slide.icon

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-sm overflow-hidden bg-slate-50 dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-white/10"
          >
            {/* Close button */}
            <button
              onClick={handleClose}
              className="absolute top-4 right-4 z-20 p-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition-colors"
            >
              <X size={20} />
            </button>

            {/* Content area */}
            <div className="relative pt-12 pb-8 px-6 text-center">
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentSlide}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
                  className="flex flex-col items-center"
                >
                  <div className={`w-24 h-24 mb-6 rounded-full bg-gradient-to-br ${slide.bg} flex items-center justify-center ring-4 ring-white/10`}>
                    <Icon size={48} className={slide.color} />
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-3">
                    {slide.title}
                  </h2>
                  <p className="text-slate-600 dark:text-slate-300 leading-relaxed text-sm">
                    {slide.description}
                  </p>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Bottom Actions */}
            <div className="bg-slate-100 dark:bg-slate-800/50 p-6 flex flex-col items-center gap-4">
              {/* Pagination Dots */}
              <div className="flex gap-2">
                {SLIDES.map((_, index) => (
                  <div
                    key={index}
                    className={`h-2 rounded-full transition-all duration-300 ${
                      index === currentSlide ? 'w-6 bg-accent' : 'w-2 bg-slate-300 dark:bg-slate-600'
                    }`}
                  />
                ))}
              </div>

              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={handleNext}
                className="w-full py-3.5 rounded-xl gradient-accent text-white font-bold text-lg flex items-center justify-center gap-2 shadow-lg shadow-accent/20"
              >
                {currentSlide === SLIDES.length - 1 ? '¡Empezar a Jugar!' : 'Siguiente'}
                {currentSlide < SLIDES.length - 1 && <ChevronRight size={20} />}
              </motion.button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
