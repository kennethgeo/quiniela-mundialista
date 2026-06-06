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
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 50 }}
        className="fixed bottom-0 left-0 right-0 z-[100] p-4 flex justify-center"
      >
        <div className="glass-strong shadow-[0_0_40px_rgba(245,158,11,0.12)] w-full max-w-md p-5 relative overflow-hidden">
          
          {/* Brillo de fondo — amber glow */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

          {/* Botón Cerrar */}
          <button 
            onClick={dismissPrompt}
            className="absolute top-3 right-3 text-slate-400 hover:text-white p-1.5 rounded-xl hover:bg-white/10 transition-all"
          >
            <X size={18} />
          </button>

          <div className="flex gap-4 items-start relative z-10">
            <div className="gradient-gold rounded-2xl p-3 shadow-lg shadow-amber-500/25 shrink-0">
              <Download className="text-slate-950" size={24} />
            </div>
            
            <div className="flex-1 pt-1">
              <h3 className="font-bold text-white text-lg leading-tight">Instala la App</h3>
              <p className="text-slate-400 text-sm mt-1 mb-3">
                Agrega la Quiniela a tu inicio para una experiencia más rápida en pantalla completa.
              </p>

              {isIOS ? (
                <div className="bg-white/5 rounded-2xl p-3.5 text-sm text-slate-300 border border-white/[0.06] space-y-2.5">
                  <p className="font-semibold text-white mb-2">En tu iPhone/iPad:</p>
                  <div className="flex items-center gap-2.5">
                    <span className="bg-amber-500/10 text-amber-400 p-1.5 rounded-lg"><Share size={14} /></span>
                    <span>1. Toca Compartir abajo</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="bg-amber-500/10 text-amber-400 p-1.5 rounded-lg"><PlusSquare size={14} /></span>
                    <span>2. Selecciona "Agregar a inicio"</span>
                  </div>
                </div>
              ) : (
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={handleInstallClick}
                  className="w-full gradient-gold text-slate-950 font-bold py-3 rounded-2xl transition-all shadow-lg shadow-amber-500/20 flex justify-center items-center gap-2"
                >
                  <Download size={18} />
                  Instalar ahora
                </motion.button>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
