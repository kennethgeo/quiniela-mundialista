import { useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../ui/LoadingSpinner'
import { motion } from 'motion/react'
import { Mail, RefreshCw, Send, Check } from 'lucide-react'
import { puedeEntrar } from '../../lib/verificacionCorreo'

export default function ProtectedRoute({ children }) {
  const { user, loading: authLoading } = useAuth()
  const [reenviando, setReenviando] = useState(false)
  const [reenviado, setReenviado] = useState(false)

  /* Antes esto consultaba public.users.email_confirmed_at, una columna que NO
     EXISTE: la consulta fallaba siempre, caía al catch y ahí hacía
     setIsEmailVerified(true). O sea que la puerta quedaba abierta para
     cualquiera y encima con un efecto asíncrono y un timeout de 3s de por
     medio. La sesión de Supabase ya trae el dato; no hace falta nada de eso.
     La regla de qué cuenta como verificado vive en lib/verificacionCorreo.js,
     con tests. */
  const verificado = puedeEntrar(user)

  const reenviarCorreo = async () => {
    if (!user?.email || reenviando) return
    try {
      setReenviando(true)
      const { error } = await supabase.auth.resend({ type: 'signup', email: user.email })
      if (error) throw error
      setReenviado(true)
    } catch {
      /* Si falla, queda el botón de recargar. */
    } finally {
      setReenviando(false)
    }
  }

  if (authLoading) {
    return <LoadingSpinner />
  }

  if (!user) {
    return <Navigate to="/auth" replace />
  }

  if (!verificado) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-primary bg-world-cup">
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
          className="glass-card p-8 max-w-md mx-4 text-center relative overflow-hidden"
        >
          {/* Background glow */}
          <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-48 h-48 bg-amber-500/8 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 250 }}
              className="w-16 h-16 rounded-2xl gradient-gold flex items-center justify-center mx-auto mb-5 shadow-lg shadow-amber-500/20"
            >
              <Mail size={28} className="text-slate-950" />
            </motion.div>

            <h2 className="text-2xl font-bold text-white mb-2">Email no verificado</h2>
            <p className="text-slate-300 mb-2 text-sm">
              Por favor, verifica tu correo electrónico para acceder a la Quiniela.
            </p>
            <p className="text-slate-500 text-xs mb-6">
              Revisa tu bandeja de entrada (o spam) para encontrar el link de verificación.
            </p>

            <div className="flex flex-col gap-2.5 items-center">
              {/* "Recargar" no sirve de nada si el correo nunca llegó. */}
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={reenviarCorreo}
                disabled={reenviando || reenviado}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl gradient-gold text-slate-950 font-bold text-sm shadow-lg shadow-amber-500/20 transition-all disabled:opacity-60"
              >
                {reenviado ? <Check size={16} /> : <Send size={16} />}
                {reenviado ? 'Correo reenviado' : reenviando ? 'Enviando…' : 'Reenviar el correo'}
              </motion.button>
              <button
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-1.5 text-slate-400 text-xs font-semibold"
              >
                <RefreshCw size={13} />
                Ya lo verifiqué, recargar
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    )
  }

  return children ? children : <Outlet />
}
