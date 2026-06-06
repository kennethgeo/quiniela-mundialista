/* Página de autenticación (login / registro) - Diseño Premium 2026 */
import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'motion/react'
import { Trophy, Star, Users, Target } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import LoginForm from '../components/auth/LoginForm'
import RegisterForm from '../components/auth/RegisterForm'

export default function AuthPage() {
  const { user, loading, signOut } = useAuth()
  const [isLogin, setIsLogin] = useState(true)
  const [confirmationMessage, setConfirmationMessage] = useState('')

  // Detectar si venimos de un link de confirmación de email
  useEffect(() => {
    const hash = window.location.hash
    if (hash && hash.includes('type=signup')) {
      setConfirmationMessage('¡Tu correo ha sido confirmado con éxito! Por favor, inicia sesión.')
      setIsLogin(true)
      // Si Supabase intentó autologuearnos, cerramos la sesión para forzar el login
      if (user) {
        signOut()
      }
      // Limpiar el hash de la URL para no repetir
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [user, signOut])

  // Si ya está autenticado (y no es un recién confirmado), redirigir al dashboard
  if (!loading && user && !confirmationMessage) return <Navigate to="/" replace />

  const features = [
    { icon: Target, text: 'Predice marcadores exactos' },
    { icon: Users, text: 'Compite con tus amigos' },
    { icon: Star, text: 'Escala en el ranking global' },
  ]

  return (
    <div className="relative min-h-screen flex flex-col lg:flex-row items-stretch overflow-hidden bg-[#0a0a0f] font-sans">
      
      {/* ── Background layers ── */}
      <div className="absolute inset-0 z-0">
        <img 
          src="/bg-hero.png" 
          alt="" 
          aria-hidden="true"
          className="w-full h-full object-cover opacity-30 scale-110"
        />
        {/* Multi-layer gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#0a0a0f] via-[#0a0a0f]/85 to-purple-950/40" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0f] via-transparent to-[#0a0a0f]/60" />
      </div>

      {/* ── Animated orbs ── */}
      <motion.div 
        animate={{ x: [0, 30, 0], y: [0, -20, 0] }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute top-[10%] left-[5%] w-[500px] h-[500px] bg-purple-600/15 rounded-full blur-[150px] pointer-events-none z-0" 
      />
      <motion.div 
        animate={{ x: [0, -20, 0], y: [0, 30, 0] }}
        transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute bottom-[5%] right-[0%] w-[400px] h-[400px] bg-cyan-500/10 rounded-full blur-[130px] pointer-events-none z-0" 
      />
      <motion.div 
        animate={{ scale: [1, 1.2, 1] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute top-[40%] left-[50%] w-[300px] h-[300px] bg-pink-500/8 rounded-full blur-[120px] pointer-events-none z-0" 
      />

      {/* ── LEFT: Hero text (Desktop only) ── */}
      <div className="hidden lg:flex flex-col justify-center w-[55%] px-16 xl:px-24 relative z-10">
        <motion.div
          initial={{ opacity: 0, x: -40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-xl"
        >
          {/* Badge */}
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-white/[0.04] border border-white/[0.08] backdrop-blur-lg mb-10"
          >
            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-purple-500 to-cyan-400 flex items-center justify-center">
              <Trophy size={10} className="text-white" />
            </div>
            <span className="text-[11px] font-semibold tracking-[0.15em] text-slate-300 uppercase">FIFA World Cup 2026</span>
          </motion.div>
          
          {/* Headline */}
          <h1 className="text-[3.5rem] xl:text-[4.2rem] font-extrabold leading-[1.05] mb-8 tracking-tight">
            <span className="text-white block">Vive la pasión.</span>
            <span className="bg-gradient-to-r from-purple-400 via-cyan-400 to-purple-400 bg-clip-text text-transparent block mt-1">
              Predice el futuro.
            </span>
          </h1>
          
          {/* Subtitle */}
          <p className="text-lg text-slate-400 leading-relaxed max-w-md font-light mb-12">
            Únete a la quiniela mundialista definitiva. Desafía a tus amigos, acierta marcadores exactos y conviértete en leyenda.
          </p>

          {/* Feature pills */}
          <div className="flex flex-col gap-3.5">
            {features.map((feat, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 + i * 0.1, duration: 0.5 }}
                className="flex items-center gap-3 group"
              >
                <div className="w-9 h-9 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center group-hover:bg-purple-500/10 group-hover:border-purple-500/20 transition-all duration-300">
                  <feat.icon size={16} className="text-purple-400" />
                </div>
                <span className="text-sm text-slate-400 font-medium group-hover:text-slate-300 transition-colors">{feat.text}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* ── RIGHT: Form container ── */}
      <div className="w-full lg:w-[45%] flex flex-col items-center justify-center px-5 sm:px-8 py-12 lg:py-8 relative z-10 min-h-screen lg:min-h-0">
        
        {/* Mobile header */}
        <motion.div
          initial={{ opacity: 0, y: -15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="lg:hidden text-center mb-10 w-full"
        >
          {/* Logo icon */}
          <div className="relative inline-flex mb-5">
            <div className="absolute inset-0 bg-purple-500/30 blur-2xl rounded-full scale-150" />
            <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-cyan-500 p-[1.5px]">
              <div className="w-full h-full bg-[#0a0a0f] rounded-[14px] flex items-center justify-center">
                <Trophy size={26} className="text-white" />
              </div>
            </div>
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">
            Quiniela Mundialista
          </h1>
          <p className="text-[11px] font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent tracking-[0.2em] uppercase mt-2">
            World Cup 2026
          </p>
        </motion.div>

        {/* Form card */}
        <div className="w-full max-w-[420px]">
          <AnimatePresence mode="wait">
            {isLogin ? (
              <motion.div
                key="login"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              >
                <LoginForm onToggle={() => setIsLogin(false)} />
              </motion.div>
            ) : (
              <motion.div
                key="register"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              >
                <RegisterForm onToggle={() => setIsLogin(true)} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <motion.p 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="text-[11px] text-slate-600 mt-10 text-center"
        >
          © 2026 Quiniela Mundialista. Todos los derechos reservados.
        </motion.p>
      </div>
    </div>
  )
}
