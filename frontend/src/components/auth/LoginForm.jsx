// Formulario de inicio de sesión - Diseño Premium Moderno
import { useState } from 'react'
import { motion } from 'motion/react'
import { Mail, Lock, Eye, EyeOff, AlertCircle, ArrowRight } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'

export default function LoginForm({ onToggle, confirmationMessage }) {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [focusedField, setFocusedField] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await signIn(email, password)
    } catch (err) {
      setError(err.message === 'Invalid login credentials'
        ? 'Credenciales inválidas. Revisa tu email y contraseña.'
        : err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full">
      {/* Card container with solid background to prevent Chromium rendering bugs */}
      <div className="w-full box-border relative p-6 sm:p-10 rounded-[2rem] bg-white dark:bg-[#161622] border border-slate-200 dark:border-white/[0.08] shadow-[0_8px_30px_rgb(0,0,0,0.06)] dark:shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] transition-colors duration-500 overflow-hidden">
        
        {/* Header */}
        <div className="mb-8">
            <h2 className="text-[1.65rem] font-bold text-slate-900 dark:text-white tracking-tight leading-tight transition-colors duration-500">
              Bienvenido de vuelta
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 font-medium transition-colors duration-500">
              Ingresa tus credenciales para continuar
            </p>
          </div>

          {/* Success / Confirmation Message */}
          {confirmationMessage && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-2.5 p-3.5 mb-6 rounded-xl bg-emerald-100 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-sm transition-colors duration-500"
            >
              <div className="shrink-0 mt-0.5 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center text-white font-bold text-[10px]">✓</div>
              <span className="leading-snug">{confirmationMessage}</span>
            </motion.div>
          )}

          {/* Error message */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-2.5 p-3.5 mb-6 rounded-xl bg-red-50 dark:bg-red-500/8 border border-red-200 dark:border-red-500/15 text-red-600 dark:text-red-400 text-sm transition-colors duration-500"
            >
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span className="leading-snug">{error}</span>
            </motion.div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email field */}
            <div className="space-y-2">
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-[0.08em] ml-0.5 transition-colors duration-500">
                Correo Electrónico
              </label>
              <div className={`relative flex items-center rounded-xl border transition-all duration-300 ${
                focusedField === 'email' 
                  ? 'border-purple-500 bg-purple-50/50 dark:border-purple-500/50 dark:bg-white/[0.04] shadow-[0_0_0_3px_rgba(139,92,246,0.1)] dark:shadow-[0_0_0_3px_rgba(139,92,246,0.08)]' 
                  : 'border-slate-300 bg-slate-50 hover:border-slate-400 dark:border-white/[0.06] dark:bg-white/[0.02] dark:hover:border-white/[0.1]'
              }`}>
                <div className="pl-3.5 pr-0">
                  <Mail size={16} className={`transition-colors duration-300 ${focusedField === 'email' ? 'text-purple-500 dark:text-purple-400' : 'text-slate-400 dark:text-slate-600'}`} />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={() => setFocusedField('email')}
                  onBlur={() => setFocusedField(null)}
                  placeholder="tu@email.com"
                  required
                  className="w-full px-3 py-3.5 bg-transparent text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none text-[15px] transition-colors duration-500"
                />
              </div>
            </div>

            {/* Password field */}
            <div className="space-y-2">
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-[0.08em] ml-0.5 transition-colors duration-500">
                Contraseña
              </label>
              <div className={`relative flex items-center rounded-xl border transition-all duration-300 ${
                focusedField === 'password' 
                  ? 'border-purple-500 bg-purple-50/50 dark:border-purple-500/50 dark:bg-white/[0.04] shadow-[0_0_0_3px_rgba(139,92,246,0.1)] dark:shadow-[0_0_0_3px_rgba(139,92,246,0.08)]' 
                  : 'border-slate-300 bg-slate-50 hover:border-slate-400 dark:border-white/[0.06] dark:bg-white/[0.02] dark:hover:border-white/[0.1]'
              }`}>
                <div className="pl-3.5 pr-0">
                  <Lock size={16} className={`transition-colors duration-300 ${focusedField === 'password' ? 'text-purple-500 dark:text-purple-400' : 'text-slate-400 dark:text-slate-600'}`} />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocusedField('password')}
                  onBlur={() => setFocusedField(null)}
                  placeholder="••••••••"
                  required
                  className="w-full px-3 py-3.5 bg-transparent text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none text-[15px] transition-colors duration-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="pr-3.5 pl-2 text-slate-400 hover:text-slate-600 dark:text-slate-600 dark:hover:text-slate-400 transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Submit button */}
            <motion.button
              type="submit"
              disabled={loading}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              className="w-full py-3.5 mt-3 relative group rounded-xl font-semibold text-[15px] flex items-center justify-center gap-2.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden shadow-md hover:shadow-lg"
            >
              {/* Button gradient background */}
              <div className="absolute inset-0 bg-gradient-to-r from-purple-600 to-purple-500 group-hover:from-purple-500 group-hover:to-purple-400 transition-all duration-300" />
              {/* Shine effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 translate-x-[-100%] group-hover:translate-x-[100%]" style={{ transition: 'transform 0.6s' }} />
              
              <span className="relative text-white flex items-center gap-2">
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    Entrar a la Quiniela
                    <ArrowRight size={18} className="group-hover:translate-x-0.5 transition-transform" />
                  </>
                )}
              </span>
            </motion.button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-4 my-7">
            <div className="flex-1 h-px bg-slate-200 dark:bg-white/[0.06] transition-colors duration-500" />
            <span className="text-[11px] text-slate-400 dark:text-slate-600 font-medium uppercase tracking-wider transition-colors duration-500">ó</span>
            <div className="flex-1 h-px bg-slate-200 dark:bg-white/[0.06] transition-colors duration-500" />
          </div>

          {/* Toggle to register */}
          <div className="text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400 transition-colors duration-500">
              ¿Nuevo en el torneo?{' '}
              <button
                onClick={onToggle}
                className="text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300 font-semibold transition-colors"
              >
                Crea tu cuenta
              </button>
            </p>
          </div>
        </div>
    </div>
  )
}
