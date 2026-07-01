// Formulario "¿Olvidaste tu contraseña?" — envía el email de recuperación.
import { useState } from 'react'
import { motion } from 'motion/react'
import { Mail, AlertCircle, ArrowLeft, Send } from 'lucide-react'
import { supabase } from '../../lib/supabase'

export default function ForgotPasswordForm({ onBack }) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [focused, setFocused] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (err) throw err
      setSent(true)
    } catch (err) {
      setError(err.message || 'No se pudo enviar el correo. Intentá de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full">
      <div className="w-full box-border relative p-6 sm:p-10 rounded-[2rem] bg-white dark:bg-[#161622] border border-slate-200 dark:border-white/[0.08] shadow-[0_8px_30px_rgb(0,0,0,0.06)] dark:shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] transition-colors duration-500 overflow-hidden">
        <div className="mb-8">
          <h2 className="text-[1.65rem] font-bold text-slate-900 dark:text-white tracking-tight leading-tight">
            Recuperar contraseña
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 font-medium">
            Te enviamos un enlace para restablecerla
          </p>
        </div>

        {sent ? (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-2.5 p-3.5 mb-6 rounded-xl bg-emerald-100 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-sm"
          >
            <div className="shrink-0 mt-0.5 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center text-white font-bold text-[10px]">✓</div>
            <span className="leading-snug">
              Si <b>{email}</b> tiene una cuenta, te llegó un correo con el enlace para restablecer tu contraseña. Revisá también el spam.
            </span>
          </motion.div>
        ) : (
          <>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-start gap-2.5 p-3.5 mb-6 rounded-xl bg-red-50 dark:bg-red-500/8 border border-red-200 dark:border-red-500/15 text-red-600 dark:text-red-400 text-sm"
              >
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <span className="leading-snug">{error}</span>
              </motion.div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-[0.08em] ml-0.5">
                  Correo Electrónico
                </label>
                <div className={`relative flex items-center rounded-xl border transition-all duration-300 ${
                  focused
                    ? 'border-purple-500 bg-purple-50/50 dark:border-purple-500/50 dark:bg-white/[0.04] shadow-[0_0_0_3px_rgba(139,92,246,0.1)]'
                    : 'border-slate-300 bg-slate-50 hover:border-slate-400 dark:border-white/[0.06] dark:bg-white/[0.02]'
                }`}>
                  <div className="pl-3.5">
                    <Mail size={16} className={focused ? 'text-purple-500 dark:text-purple-400' : 'text-slate-400 dark:text-slate-600'} />
                  </div>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    placeholder="tu@email.com"
                    required
                    className="w-full px-3 py-3.5 bg-transparent text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none text-[15px]"
                  />
                </div>
              </div>

              <motion.button
                type="submit"
                disabled={loading}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                className="w-full py-3.5 mt-3 relative group rounded-xl font-semibold text-[15px] flex items-center justify-center gap-2.5 transition-all disabled:opacity-50 overflow-hidden shadow-md"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-purple-600 to-purple-500 group-hover:from-purple-500 group-hover:to-purple-400 transition-all duration-300" />
                <span className="relative text-white flex items-center gap-2">
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>Enviar enlace <Send size={16} /></>
                  )}
                </span>
              </motion.button>
            </form>
          </>
        )}

        <div className="text-center mt-7">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-sm text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300 font-semibold transition-colors"
          >
            <ArrowLeft size={15} /> Volver a iniciar sesión
          </button>
        </div>
      </div>
    </div>
  )
}
