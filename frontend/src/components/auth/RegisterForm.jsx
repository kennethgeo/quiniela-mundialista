// Formulario de registro con diseño glassmorphism ultra-premium
import { useState } from 'react'
import { motion } from 'motion/react'
import { User, Mail, Lock, UserPlus, Eye, EyeOff, AlertCircle } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'

export default function RegisterForm({ onToggle }) {
  const { signUp } = useAuth()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccessMsg('')
    setLoading(true)

    try {
      const data = await signUp(email, password, username)
      if (data && !data.session) {
        setSuccessMsg('¡Cuenta creada exitosamente! Revisa tu bandeja de entrada para verificar tu correo.')
        // Limpiamos el formulario
        setUsername('')
        setEmail('')
        setPassword('')
      } else {
        setSuccessMsg('¡Cuenta creada con éxito! Entrando...')
      }
    } catch (err) {
      setError(err.message === 'User already registered'
        ? 'El correo electrónico ya está registrado.'
        : err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full">
      <div className="relative p-8 sm:p-10 rounded-[2rem] bg-slate-900/40 backdrop-blur-3xl border border-white/10 shadow-[0_8px_32px_0_rgba(0,0,0,0.4)]">
        
        {/* Encabezado */}
        <div className="text-center space-y-1 mb-8">
          <h2 className="text-2xl font-bold text-white tracking-wide">Únete al Torneo</h2>
          <p className="text-sm text-slate-400">Crea tu cuenta para empezar a predecir</p>
        </div>

        {/* Mensaje de error */}
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0, scale: 0.9 }}
            animate={{ opacity: 1, height: 'auto', scale: 1 }}
            className="flex items-center gap-2 p-3 mb-6 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm"
          >
            <AlertCircle size={16} className="shrink-0" />
            <span>{error}</span>
          </motion.div>
        )}

        {/* Mensaje de éxito */}
        {successMsg && (
          <motion.div
            initial={{ opacity: 0, height: 0, scale: 0.9 }}
            animate={{ opacity: 1, height: 'auto', scale: 1 }}
            className="flex items-center gap-2 p-3 mb-6 rounded-xl bg-teal-500/10 border border-teal-500/20 text-teal-400 text-sm"
          >
            <AlertCircle size={16} className="shrink-0" />
            <span>{successMsg}</span>
          </motion.div>
        )}

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Campo username */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider ml-1">Nombre de Usuario</label>
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <User size={18} className="text-slate-500 group-focus-within:text-accent transition-colors" />
              </div>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Ej. GoalMaster"
                required
                minLength={3}
                className="w-full pl-11 pr-4 py-3.5 bg-slate-950/50 border border-white/5 rounded-2xl text-white placeholder-slate-600 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all shadow-inner"
              />
            </div>
          </div>

          {/* Campo email */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider ml-1">Correo Electrónico</label>
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Mail size={18} className="text-slate-500 group-focus-within:text-accent transition-colors" />
              </div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                required
                className="w-full pl-11 pr-4 py-3.5 bg-slate-950/50 border border-white/5 rounded-2xl text-white placeholder-slate-600 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all shadow-inner"
              />
            </div>
          </div>

          {/* Campo contraseña */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider ml-1">Contraseña</label>
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Lock size={18} className="text-slate-500 group-focus-within:text-accent transition-colors" />
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                required
                minLength={6}
                className="w-full pl-11 pr-12 py-3.5 bg-slate-950/50 border border-white/5 rounded-2xl text-white placeholder-slate-600 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all shadow-inner"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-500 hover:text-white transition-colors"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* Botón de envío */}
          <motion.button
            type="submit"
            disabled={loading}
            whileHover={{ scale: 1.02, boxShadow: "0 0 20px rgba(45,212,191,0.4)" }}
            whileTap={{ scale: 0.98 }}
            className="w-full py-4 mt-4 bg-gradient-to-r from-accent to-teal-400 text-slate-900 font-bold rounded-2xl flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_4px_14px_0_rgba(45,212,191,0.39)]"
          >
            {loading ? (
              <div className="w-6 h-6 border-2 border-slate-900/30 border-t-slate-900 rounded-full animate-spin" />
            ) : (
              <>
                <UserPlus size={20} />
                <span className="text-lg">Crear Cuenta</span>
              </>
            )}
          </motion.button>
        </form>

        {/* Enlace a login */}
        <div className="text-center text-sm text-slate-400 mt-8">
          ¿Ya estás participando?{' '}
          <button
            onClick={onToggle}
            className="text-accent hover:text-white font-bold transition-colors underline decoration-accent/50 underline-offset-4"
          >
            Inicia sesión
          </button>
        </div>
      </div>
    </div>
  )
}
