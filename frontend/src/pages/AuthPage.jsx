/* Página de autenticación (login / registro) - Diseño Ultra Premium */
import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'motion/react'
import { Trophy } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import LoginForm from '../components/auth/LoginForm'
import RegisterForm from '../components/auth/RegisterForm'

export default function AuthPage() {
  const { user, loading } = useAuth()
  const [isLogin, setIsLogin] = useState(true)

  // Si ya está autenticado, redirigir al dashboard
  if (!loading && user) return <Navigate to="/" replace />

  return (
    <div className="relative min-h-screen flex flex-col lg:flex-row items-stretch justify-center overflow-hidden bg-slate-950 font-sans">
      
      {/* Fondo Premium - Ocupa toda la pantalla detrás */}
      <div className="absolute inset-0 z-0">
        <img 
          src="/bg-hero.png" 
          alt="World Cup Background" 
          className="w-full h-full object-cover opacity-50 mix-blend-screen scale-105"
        />
        {/* Gradientes de oscurecimiento para dar contraste */}
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/80 lg:via-slate-950/50 to-slate-950/90" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-slate-950" />
      </div>

      {/* Esferas de luz decorativas flotantes */}
      <div className="absolute top-[-10%] left-[-10%] w-[40vw] h-[40vw] bg-accent/20 rounded-full blur-[120px] pointer-events-none z-0" />
      <div className="absolute bottom-[-10%] right-[-5%] w-[35vw] h-[35vw] bg-indigo-600/20 rounded-full blur-[120px] pointer-events-none z-0" />

      {/* MITAD IZQUIERDA (Texto y Presentación - Solo Desktop) */}
      <div className="hidden lg:flex flex-col justify-center w-1/2 p-12 lg:p-24 relative z-10">
        <motion.div
          initial={{ opacity: 0, x: -50 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          {/* Logo Badge */}
          <div className="inline-flex items-center gap-3 px-4 py-2 rounded-full bg-white/5 border border-white/10 backdrop-blur-md mb-8 shadow-lg shadow-black/20">
            <Trophy size={18} className="text-accent" />
            <span className="text-xs font-bold tracking-[0.2em] text-slate-300 uppercase">FIFA World Cup 2026</span>
          </div>
          
          <h1 className="text-6xl xl:text-7xl font-extrabold text-transparent bg-clip-text bg-gradient-to-br from-white via-slate-100 to-slate-500 mb-6 leading-[1.1] drop-shadow-xl">
            Vive la pasión.<br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent to-teal-200">Predice el futuro.</span>
          </h1>
          
          <p className="text-xl text-slate-400 max-w-lg leading-relaxed font-light">
            Únete a la Quiniela Mundialista definitiva. Desafía a tus amigos, acierta marcadores exactos y conviértete en la leyenda del pronóstico.
          </p>

          {/* Decorative Elements */}
          <div className="mt-12 flex gap-4 opacity-60">
            <div className="w-16 h-1 bg-accent rounded-full" />
            <div className="w-4 h-1 bg-white/20 rounded-full" />
            <div className="w-4 h-1 bg-white/20 rounded-full" />
          </div>
        </motion.div>
      </div>

      {/* MITAD DERECHA (Formulario) */}
      <div className="w-full lg:w-1/2 flex flex-col items-center justify-center p-6 sm:p-12 relative z-10">
        
        {/* Cabecera Móvil (Oculta en Desktop) */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="lg:hidden text-center mb-8 w-full"
        >
          <div className="inline-flex items-center justify-center w-16 h-16 mb-4 bg-gradient-to-tr from-accent to-indigo-500 rounded-2xl p-[2px] shadow-2xl shadow-accent/20">
            <div className="w-full h-full bg-slate-950/90 rounded-[14px] flex items-center justify-center backdrop-blur-xl">
              <Trophy size={28} className="text-white drop-shadow-lg" />
            </div>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight drop-shadow-md">
            Quiniela Mundialista
          </h1>
          <p className="text-xs font-bold text-accent tracking-[0.2em] uppercase mt-2">
            World Cup 2026
          </p>
        </motion.div>

        {/* Contenedor del Formulario */}
        <div className="w-full max-w-[440px] perspective-1000">
          <AnimatePresence mode="wait">
            {isLogin ? (
              <motion.div
                key="login"
                initial={{ opacity: 0, rotateY: -10, filter: "blur(10px)", scale: 0.95 }}
                animate={{ opacity: 1, rotateY: 0, filter: "blur(0px)", scale: 1 }}
                exit={{ opacity: 0, rotateY: 10, filter: "blur(10px)", scale: 0.95 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              >
                <LoginForm onToggle={() => setIsLogin(false)} />
              </motion.div>
            ) : (
              <motion.div
                key="register"
                initial={{ opacity: 0, rotateY: 10, filter: "blur(10px)", scale: 0.95 }}
                animate={{ opacity: 1, rotateY: 0, filter: "blur(0px)", scale: 1 }}
                exit={{ opacity: 0, rotateY: -10, filter: "blur(10px)", scale: 0.95 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
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
