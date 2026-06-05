/* Página de autenticación (login / registro) */
import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'motion/react'
import { useAuth } from '../../hooks/useAuth'
import LoginForm from '../../components/auth/LoginForm'
import RegisterForm from '../../components/auth/RegisterForm'

export default function AuthPage() {
  const { user, loading } = useAuth()
  const [isLogin, setIsLogin] = useState(true)

  // Si ya está autenticado, redirigir al dashboard
  if (!loading && user) return <Navigate to="/" replace />

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center p-4">
      {/* Logo y título */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-8"
      >
        <div className="text-5xl mb-3">⚽</div>
        <h1 className="text-2xl font-bold text-white">Quiniela Mundialista</h1>
        <p className="text-sm text-slate-400 mt-1">FIFA World Cup 2026</p>
      </motion.div>

      {/* Formularios */}
      <div className="w-full max-w-sm">
        <AnimatePresence mode="wait">
          {isLogin ? (
            <motion.div
              key="login"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
            >
              <LoginForm />
            </motion.div>
          ) : (
            <motion.div
              key="register"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <RegisterForm />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Toggle login/registro */}
        <p className="text-center text-sm text-slate-400 mt-6">
          {isLogin ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?'}
          <button
            onClick={() => setIsLogin(!isLogin)}
            className="text-accent font-semibold ml-1 hover:underline"
          >
            {isLogin ? 'Regístrate' : 'Inicia sesión'}
          </button>
        </p>
      </div>
    </div>
  )
}
