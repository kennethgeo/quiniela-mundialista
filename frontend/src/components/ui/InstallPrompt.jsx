import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Download, X, Share, PlusSquare } from 'lucide-react'

export default function InstallPrompt() {
  const [isIOS, setIsIOS] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [showPrompt, setShowPrompt] = useState(false)

  useEffect(() => {
    // Verificar si la app ya está instalada o corriendo en modo standalone
    const isStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone
    setIsStandalone(isStandaloneMode)

    if (isStandaloneMode) return

    // Comprobar si el usuario ya cerró el prompt previamente
    const hasDismissed = localStorage.getItem('pwaPromptDismissed') === 'true'
    if (hasDismissed) return

    // Detección de iOS (Safari)
    const userAgent = window.navigator.userAgent.toLowerCase()
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent)
    setIsIOS(isIOSDevice)

    if (isIOSDevice) {
      // En iOS mostramos el prompt manualmente tras un par de segundos
      setTimeout(() => setShowPrompt(true), 2000)
    }

    // Interceptar el evento en Android/Chrome
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault() // Prevenir el prompt por defecto
      setDeferredPrompt(e)
      setShowPrompt(true)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    }
  }, [])

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt() // Mostrar el prompt nativo
      const { outcome } = await deferredPrompt.userChoice
      if (outcome === 'accepted') {
        console.log('User accepted the install prompt')
      }
      setDeferredPrompt(null)
      setShowPrompt(false)
    }
  }

  const dismissPrompt = () => {
    setShowPrompt(false)
    localStorage.setItem('pwaPromptDismissed', 'true')
  }

  if (isStandalone || !showPrompt) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 50, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 50, scale: 0.9 }}
        className="fixed bottom-24 left-4 right-4 md:bottom-6 md:left-auto md:right-6 z-[100] flex justify-center md:justify-end pointer-events-none"
      >
        <div className="bg-white/90 dark:glass-strong shadow-[0_10px_40px_rgba(0,0,0,0.2)] dark:shadow-[0_10px_40px_rgba(0,0,0,0.5)] w-full max-w-sm p-4 relative overflow-hidden pointer-events-auto border border-slate-200 dark:border-white/10 rounded-2xl backdrop-blur-md">
          
          {/* Brillo de fondo — amber glow sutil */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

          {/* Botón Cerrar (X) */}
          <button 
            onClick={dismissPrompt}
            className="absolute top-2 right-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white p-1.5 rounded-full hover:bg-slate-200/50 dark:hover:bg-white/10 transition-all"
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>

          <div className="flex gap-3 items-start relative z-10">
            <div className="gradient-gold rounded-xl p-2.5 shadow-lg shadow-amber-500/20 shrink-0 mt-1">
              <Download className="text-slate-950" size={20} />
            </div>
            
            <div className="flex-1">
              <h3 className="font-bold text-slate-900 dark:text-white text-base leading-tight pr-5">App Quiniela</h3>
              <p className="text-slate-600 dark:text-slate-400 text-xs mt-0.5 mb-3 leading-snug">
                Instálala en tu inicio para una experiencia nativa y rápida.
              </p>

              {isIOS ? (
                <div className="bg-slate-100 dark:bg-white/5 rounded-xl p-3 text-xs text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-white/[0.06] mb-1">
                  <p className="font-semibold text-slate-900 dark:text-white mb-1.5">En tu iPhone:</p>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-amber-400"><Share size={12} /></span>
                    <span>1. Toca Compartir</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-amber-400"><PlusSquare size={12} /></span>
                    <span>2. "Agregar a inicio"</span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={dismissPrompt}
                    className="flex-1 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/5 transition-all"
                  >
                    Ahora no
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={handleInstallClick}
                    className="flex-1 py-2 rounded-xl text-xs font-bold gradient-gold text-slate-950 shadow-md shadow-amber-500/20 transition-all"
                  >
                    Instalar
                  </motion.button>
                </div>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
