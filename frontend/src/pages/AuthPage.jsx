/* Autenticación — Tico Games (fiel al diseño). Pantalla completa, contenido centrado. */
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
    <div className="min-h-dvh bg-[#0C0C0C] text-[#F3F1EA] flex flex-col justify-center relative overflow-hidden px-[26px] py-8 font-['Archivo']">
      {/* Orbes */}
      <div className="absolute -top-[60px] -right-[60px] w-[220px] h-[220px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle,rgba(46,211,183,.16),transparent 70%)' }} />
      <div className="absolute -bottom-[80px] -left-[60px] w-[220px] h-[220px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle,rgba(255,122,89,.12),transparent 70%)' }} />

      <div className="relative z-10 w-full max-w-[400px] mx-auto">
        {!forgot && (
          <div className="flex flex-col items-center mb-[42px]">
            <div className="mb-[20px]"><TicoLogo size={104} /></div>
            <TicoWordmark />
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
  )
}
