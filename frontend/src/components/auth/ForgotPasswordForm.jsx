/* Recuperar contraseña — Tico Games (rediseño). */
import { useState } from 'react'
import { ArrowLeft, Send } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { AUTH_INPUT, AUTH_BTN } from './TicoBrand'

export default function ForgotPasswordForm({ onBack }) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (err) throw err
      setSent(true)
    } catch (err) {
      setError(err.message || 'No se pudo enviar el correo. Intentá de nuevo.')
    } finally { setLoading(false) }
  }

  return (
    <div>
      <div className="mb-5">
        <div className="font-['Unbounded'] font-bold text-[19px] text-[#F3F1EA] mb-2">Recuperar contraseña</div>
        <div className="font-['Archivo'] text-[12px] text-[#8A8A8A] leading-relaxed">Te enviamos un enlace a tu correo para restablecerla.</div>
      </div>

      {sent ? (
        <div className="text-[12px] leading-snug rounded-lg p-3 bg-[#2ED3B7]/10 border border-[#2ED3B7]/25 text-[#2ED3B7]">
          Si <b>{email}</b> tiene cuenta, te llegó un correo con el enlace. Revisá también el spam.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {error && (
            <div className="text-[12px] leading-snug rounded-lg p-3 bg-[#FF7A59]/10 border border-[#FF7A59]/25 text-[#FF7A59]">{error}</div>
          )}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Correo" required className={AUTH_INPUT} />
          <button type="submit" disabled={loading} className={AUTH_BTN}>
            {loading ? <span className="w-5 h-5 border-2 border-[#06231d]/30 border-t-[#06231d] rounded-full animate-spin" /> : <>Enviar enlace <Send size={15} /></>}
          </button>
        </form>
      )}

      <button onClick={onBack} className="mt-6 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#8A8A8A] hover:text-[#F3F1EA] transition-colors">
        <ArrowLeft size={14} /> Volver a iniciar sesión
      </button>
    </div>
  )
}
