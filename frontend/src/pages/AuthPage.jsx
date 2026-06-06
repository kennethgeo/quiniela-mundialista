/* Página de autenticación (login / registro) - Diseño Premium */
import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'motion/react'
import { useAuth } from '../hooks/useAuth'
import LoginForm from '../components/auth/LoginForm'
import RegisterForm from '../components/auth/RegisterForm'

export default function AuthPage() {
  const { user, loading } = useAuth()
  const [isLogin, setIsLogin] = useState(true)

  // Si ya está autenticado, redirigir al dashboard
  if (!loading && user) return <Navigate to="/" replace />

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center p-4 overflow-hidden bg-slate-950">
      
      {/* Fondo Premium */}
      <div className="absolute inset-0 z-0">
        <img 
          src="/bg-hero.png" 
          alt="World Cup Background" 
          className="w-full h-full object-cover opacity-60 mix-blend-screen scale-105"
        />
        {/* Gradientes y Viñetas */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-900/40 via-transparent to-cyan-900/30 mix-blend-overlay" />
      </div>

      {/* Círculos decorativos flotantes (Glassmorphism blobs) */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-accent/20 rounded-full blur-[100px] pointer-events-none -z-0" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-600/20 rounded-full blur-[100px] pointer-events-none -z-0" />

      {/* Contenido principal */}
      <div className="z-10 w-full max-w-md">
        
        {/* Logo y título */}
        <motion.div
          initial={{ opacity: 0, y: -30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="text-center mb-10"
        >
          <motion.div 
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 20, delay: 0.1 }}
            className="w-20 h-20 mx-auto mb-4 bg-gradient-to-tr from-accent to-indigo-500 rounded-3xl p-[2px] shadow-2xl shadow-accent/20"
          >
            <div className="w-full h-full bg-slate-950/80 rounded-[22px] flex items-center justify-center backdrop-blur-xl">
              <span className="text-4xl drop-shadow-lg">🏆</span>
            </div>
          </motion.div>
          <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-200 to-slate-400 tracking-tight drop-shadow-md">
            Quiniela Mundialista
          </h1>
          <p className="text-sm font-medium text-accent tracking-[0.2em] uppercase mt-2 drop-shadow-md">
            FIFA World Cup 2026
          </p>
        </motion.div>

        {/* Formularios */}
        <div className="relative">
          <AnimatePresence mode="wait">
            {isLogin ? (
              <motion.div
                key="login"
                initial={{ opacity: 0, x: -20, filter: "blur(10px)" }}
                animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, x: 20, filter: "blur(10px)" }}
                transition={{ duration: 0.3 }}
              >
                <LoginForm onToggle={() => setIsLogin(false)} />
              </motion.div>
            ) : (
              <motion.div
                key="register"
                initial={{ opacity: 0, x: 20, filter: "blur(10px)" }}
                animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, x: -20, filter: "blur(10px)" }}
                transition={{ duration: 0.3 }}
              >
                <RegisterForm onToggle={() => setIsLogin(true)} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
