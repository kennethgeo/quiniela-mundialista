/* Autenticación — Tico Games (rediseño). Oscuro, centrado, con el logo nuevo. */
import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { useAuth } from '../hooks/useAuth'
import { TicoLogo, TicoWordmark } from '../components/auth/TicoBrand'
import LoginForm from '../components/auth/LoginForm'
import RegisterForm from '../components/auth/RegisterForm'
import ForgotPasswordForm from '../components/auth/ForgotPasswordForm'

export default function AuthPage() {
  const { user, loading, signOut } = useAuth()
  const [isLogin, setIsLogin] = useState(true)
  const [forgot, setForgot] = useState(false)
  const [confirmationMessage, setConfirmationMessage] = useState('')

  useEffect(() => {
    const hash = window.location.hash
    if (hash && hash.includes('type=signup')) {
      setConfirmationMessage('¡Tu correo fue confirmado! Ya podés iniciar sesión.')
      setIsLogin(true)
      if (user) signOut()
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [user, signOut])

  if (!loading && user && !confirmationMessage) return <Navigate to="/" replace />

  return (
    <div className="min-h-dvh bg-[#050505] flex items-center justify-center p-4 font-['Archivo']">
      <div className="w-full max-w-[380px] relative overflow-hidden rounded-3xl bg-[#0C0C0C] border border-[#1a1a1a] px-7 py-9 sm:px-9">
        {/* Orbes */}
        <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle,rgba(46,211,183,.16),transparent 70%)' }} />
        <div className="absolute -bottom-20 -left-16 w-56 h-56 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle,rgba(255,122,89,.12),transparent 70%)' }} />

        <div className="relative z-10">
          {!forgot && (
            <div className="flex flex-col items-center mb-8">
              <TicoLogo size={56} />
              <div className="mt-3.5"><TicoWordmark /></div>
            </div>
          )}

          <AnimatePresence mode="wait">
            {forgot ? (
              <motion.div key="forgot" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                <ForgotPasswordForm onBack={() => setForgot(false)} />
              </motion.div>
            ) : isLogin ? (
              <motion.div key="login" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                <LoginForm onToggle={() => setIsLogin(false)} onForgot={() => setForgot(true)} confirmationMessage={confirmationMessage} />
              </motion.div>
            ) : (
              <motion.div key="register" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                <RegisterForm onToggle={() => setIsLogin(true)} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <p className="absolute bottom-4 text-[10px] text-[#3a3a3a] font-['JetBrains_Mono'] tracking-wider">© 2026 TICO GAMES</p>
    </div>
  )
}
