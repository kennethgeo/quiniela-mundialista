/* Restablecer contraseña — Tico Games (rediseño). Llega desde el enlace del correo. */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, CheckCircle2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { TicoLogo, AUTH_INPUT, AUTH_BTN } from '../components/auth/TicoBrand'

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data }) => { if (mounted && data?.session) setReady(true) })
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) setReady(true)
    })
    return () => { mounted = false; sub?.subscription?.unsubscribe?.() }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (password.length < 6) { setError('La contraseña debe tener al menos 6 caracteres.'); return }
    if (password !== confirm) { setError('Las contraseñas no coinciden.'); return }
    setLoading(true)
    try {
      const { error: err } = await supabase.auth.updateUser({ password })
      if (err) throw err
      setDone(true)
      setTimeout(() => navigate('/', { replace: true }), 1800)
    } catch (err) {
      setError(/session|Auth session missing/i.test(err.message || '')
        ? 'El enlace expiró o no es válido. Pedí uno nuevo desde "¿Olvidaste tu contraseña?".'
        : (err.message || 'No se pudo actualizar la contraseña.'))
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-dvh bg-[#050505] flex items-center justify-center p-4 font-['Archivo']">
      <div className="w-full max-w-[380px] relative overflow-hidden rounded-3xl bg-[#0C0C0C] border border-[#1a1a1a] px-7 py-9 sm:px-9">
        <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle,rgba(46,211,183,.16),transparent 70%)' }} />
        <div className="relative z-10">
          <div className="flex justify-center mb-6"><TicoLogo size={48} /></div>

          {done ? (
            <div className="text-center py-4">
              <CheckCircle2 size={40} className="text-[#2ED3B7] mx-auto mb-3" />
              <p className="text-[#F3F1EA] font-semibold">¡Contraseña actualizada!</p>
              <p className="text-sm text-[#8A8A8A] mt-1">Entrando…</p>
            </div>
          ) : (
            <>
              <div className="mb-5">
                <div className="font-['Unbounded'] font-bold text-[19px] text-[#F3F1EA] mb-2">Nueva contraseña</div>
                <div className="text-[12px] text-[#8A8A8A] leading-relaxed">Definí tu nueva clave para volver a entrar.</div>
              </div>

              {error && (
                <div className="text-[12px] leading-snug rounded-lg p-3 mb-3 bg-[#FF7A59]/10 border border-[#FF7A59]/25 text-[#FF7A59]">{error}</div>
              )}

              <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <div className="relative">
                  <input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Nueva contraseña" required className={AUTH_INPUT + ' pr-11'} />
                  <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8A8A8A] hover:text-[#F3F1EA]">
                    {show ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <input type={show ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirmar contraseña" required className={AUTH_INPUT} />
                <button type="submit" disabled={loading} className={AUTH_BTN + ' mt-1'}>
                  {loading ? <span className="w-5 h-5 border-2 border-[#06231d]/30 border-t-[#06231d] rounded-full animate-spin" /> : 'Guardar y entrar'}
                </button>
              </form>

              {!ready && <p className="text-[11px] text-[#6c6c6c] text-center mt-4">Abrí esta página desde el enlace del correo de recuperación.</p>}
              <div className="text-center mt-5">
                <button onClick={() => navigate('/auth')} className="text-[12px] text-[#2ED3B7] font-bold hover:underline">Volver a iniciar sesión</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
