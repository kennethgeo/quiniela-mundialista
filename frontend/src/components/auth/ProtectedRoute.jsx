import { useEffect, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../ui/LoadingSpinner'
import { motion } from 'motion/react'
import { Mail, RefreshCw } from 'lucide-react'

export default function ProtectedRoute({ children }) {
  const { user, loading: authLoading } = useAuth()
  const [isEmailVerified, setIsEmailVerified] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const checkEmailVerification = async () => {
      if (!user) {
        setIsLoading(false)
        return
      }

      // Check local user object first (fast path)
      if (user.email_confirmed_at) {
        setIsEmailVerified(true)
        setIsLoading(false)
        return
      }

      try {
        // Wrap the fetch in a 3-second timeout to prevent PWA hang on slow networks
        const fetchPromise = supabase
          .from('users')
          .select('email_confirmed_at')
          .eq('id', user.id)
          .single()

        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('timeout')), 3000)
        )

        const { data: userProfile } = await Promise.race([fetchPromise, timeoutPromise])

        const verified = userProfile?.email_confirmed_at !== null
        setIsEmailVerified(verified)
      } catch (error) {
        console.warn('Error or timeout checking email verification, allowing access fallback:', error)
        // If it times out or fails, we assume verified to prevent blocking the user from the app 
        // if they are already logged in and just have a slow connection.
        setIsEmailVerified(true) 
      } finally {
        setIsLoading(false)
      }
    }

    if (!authLoading) {
      checkEmailVerification()
    }
  }, [user, authLoading])

  if (authLoading || isLoading) {
    return <LoadingSpinner />
  }

  if (!user) {
    return <Navigate to="/auth" replace />
  }

  if (!isEmailVerified) {
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

            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl gradient-gold text-slate-950 font-bold text-sm shadow-lg shadow-amber-500/20 transition-all"
            >
              <RefreshCw size={16} />
              Recargar
            </motion.button>
          </div>
        </motion.div>
      </div>
    )
  }

  return children ? children : <Outlet />
}
