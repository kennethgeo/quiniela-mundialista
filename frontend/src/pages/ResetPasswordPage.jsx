// Página de restablecer contraseña: a donde llega el enlace del email de reset.
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { Lock, Eye, EyeOff, AlertCircle, Trophy, CheckCircle2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [ready, setReady] = useState(false)

  // Supabase procesa el token del enlace y abre una sesión de recuperación.
  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (mounted && data?.session) setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) setReady(true)
    })
    return () => {
      mounted = false
      sub?.subscription?.unsubscribe?.()
    }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.')
      return
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.')
      return
    }
    setLoading(true)
    try {
      const { error: err } = await supabase.auth.updateUser({ password })
      if (err) throw err
      setDone(true)
      setTimeout(() => navigate('/', { replace: true }), 1800)
    } catch (err) {
      setError(
        /session|Auth session missing/i.test(err.message || '')
          ? 'El enlace expiró o no es válido. Pedí uno nuevo desde "¿Olvidaste tu contraseña?".'
          : (err.message || 'No se pudo actualizar la contraseña.')
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0a0a0f] px-4 py-16">
      <div className="w-full max-w-[420px]">
        <div className="text-center mb-8">
          <div className="relative inline-flex mb-4">
            <div className="absolute inset-0 bg-purple-500/30 blur-2xl rounded-full scale-150" />
            <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500 to-cyan-500 p-[1.5px]">
              <div className="w-full h-full bg-slate-50 dark:bg-[#0a0a0f] rounded-[14px] flex items-center justify-center">
                <Trophy size={24} className="text-purple-600 dark:text-white" />
              </div>
            </div>
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">Nueva contraseña</h1>
        </div>

        <div className="p-6 sm:p-8 rounded-[2rem] bg-white dark:bg-[#161622] border border-slate-200 dark:border-white/[0.08] shadow-lg">
          {done ? (
            <div className="text-center py-4">
              <CheckCircle2 size={40} className="text-emerald-500 mx-auto mb-3" />
              <p className="text-slate-700 dark:text-slate-200 font-semibold">¡Contraseña actualizada!</p>
              <p className="text-sm text-slate-500 mt-1">Entrando a la quiniela…</p>
            </div>
          ) : (
            <>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-start gap-2.5 p-3.5 mb-5 rounded-xl bg-red-50 dark:bg-red-500/8 border border-red-200 dark:border-red-500/15 text-red-600 dark:text-red-400 text-sm"
                >
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <span className="leading-snug">{error}</span>
                </motion.div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {[
                  { val: password, set: setPassword, ph: 'Nueva contraseña' },
                  { val: confirm, set: setConfirm, ph: 'Repetir contraseña' },
                ].map((f, i) => (
                  <div key={i} className="relative flex items-center rounded-xl border border-slate-300 bg-slate-50 dark:border-white/[0.06] dark:bg-white/[0.02]">
                    <div className="pl-3.5"><Lock size={16} className="text-slate-400 dark:text-slate-600" /></div>
                    <input
                      type={show ? 'text' : 'password'}
                      value={f.val}
                      onChange={(e) => f.set(e.target.value)}
                      placeholder={f.ph}
                      required
                      className="w-full px-3 py-3.5 bg-transparent text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none text-[15px]"
                    />
                    {i === 0 && (
                      <button type="button" onClick={() => setShow(!show)} className="pr-3.5 pl-2 text-slate-400 hover:text-slate-600">
                        {show ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    )}
                  </div>
                ))}

                <motion.button
                  type="submit"
                  disabled={loading}
                  whileTap={{ scale: 0.98 }}
                  className="w-full py-3.5 mt-2 relative group rounded-xl font-semibold text-[15px] flex items-center justify-center transition-all disabled:opacity-50 overflow-hidden shadow-md"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-purple-600 to-purple-500 group-hover:from-purple-500 group-hover:to-purple-400 transition-all" />
                  <span className="relative text-white">
                    {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Guardar contraseña'}
                  </span>
                </motion.button>
              </form>

              {!ready && (
                <p className="text-[11px] text-slate-400 text-center mt-4">
                  Abrí esta página desde el enlace del correo de recuperación.
                </p>
              )}
              <div className="text-center mt-5">
                <button onClick={() => navigate('/auth')} className="text-sm text-purple-600 dark:text-purple-400 font-semibold hover:underline">
                  Volver a iniciar sesión
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
