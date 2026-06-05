import { useEffect, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../ui/LoadingSpinner'

export default function ProtectedRoute() {
  const { user, loading: authLoading } = useAuth()
  const [isEmailVerified, setIsEmailVerified] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const checkEmailVerification = async () => {
      if (!user) {
        setIsLoading(false)
        return
      }

      try {
        // Get user profile to check email_confirmed_at
        const { data: userProfile } = await supabase
          .from('users')
          .select('email_confirmed_at')
          .eq('id', user.id)
          .single()

        const verified = userProfile?.email_confirmed_at !== null
        setIsEmailVerified(verified)
      } catch (error) {
        console.error('Error checking email verification:', error)
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
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
        <div className="text-center bg-slate-800 border border-slate-700 rounded-lg p-8 max-w-md">
          <svg
            className="mx-auto h-12 w-12 text-yellow-500 mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
          <h2 className="text-2xl font-bold text-white mb-2">Email no verificado</h2>
          <p className="text-slate-300 mb-4">
            Por favor, verifica tu correo electrónico para acceder a la Quiniela.
          </p>
          <p className="text-slate-400 text-sm">
            Revisa tu bandeja de entrada (o spam) para encontrar el link de verificación.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
          >
            Recargar
          </button>
        </div>
      </div>
    )
  }

  return <Outlet />
}
