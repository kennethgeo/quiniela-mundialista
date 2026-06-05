// Componente Toast para notificaciones con auto-dismiss y animación slide-in
import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { CheckCircle, XCircle, X } from 'lucide-react'

// ── Contexto del Toast ──
const ToastContext = createContext(null)

/**
 * Hook para mostrar notificaciones toast.
 * Uso: const { showToast } = useToast()
 *      showToast('Guardado correctamente', 'success')
 */
export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast debe usarse dentro de un ToastProvider')
  }
  return context
}

/**
 * Provider que gestiona la cola de toasts y renderiza las notificaciones.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const showToast = useCallback((message, variant = 'success', duration = 3500) => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev, { id, message, variant, duration }])
  }, [])

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}

      {/* Contenedor de toasts */}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        <AnimatePresence mode="popLayout">
          {toasts.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

/** Componente individual de toast con auto-dismiss */
function ToastItem({ toast, onRemove }) {
  const { id, message, variant, duration } = toast

  useEffect(() => {
    const timer = setTimeout(() => onRemove(id), duration)
    return () => clearTimeout(timer)
  }, [id, duration, onRemove])

  const isSuccess = variant === 'success'
  const Icon = isSuccess ? CheckCircle : XCircle

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 80, scale: 0.9 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 80, scale: 0.9 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={`pointer-events-auto glass-strong flex items-center gap-3 px-4 py-3 shadow-xl ${
        isSuccess ? 'border-success/20' : 'border-error/20'
      }`}
    >
      <Icon
        size={20}
        className={isSuccess ? 'text-success shrink-0' : 'text-error shrink-0'}
      />
      <p className="text-sm text-white flex-1">{message}</p>
      <button
        onClick={() => onRemove(id)}
        className="text-slate-500 hover:text-white transition-colors shrink-0"
      >
        <X size={14} />
      </button>
    </motion.div>
  )
}
