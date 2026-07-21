/* Login — Tico Games (rediseño). */
import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { AUTH_INPUT, AUTH_BTN } from './TicoBrand'

export default function LoginForm({ onToggle, onForgot, confirmationMessage }) {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      await signIn(email, password)
    } catch (err) {
      setError(err.message === 'Invalid login credentials'
        ? 'Credenciales inválidas. Revisá tu correo y contraseña.' : err.message)
    } finally { setLoading(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {confirmationMessage && (
        <div className="text-[13px] leading-snug rounded-xl p-3.5 bg-[#2ED3B7]/10 border border-[#2ED3B7]/25 text-[#2ED3B7]">{confirmationMessage}</div>
      )}
      {error && (
        <div className="text-[13px] leading-snug rounded-xl p-3.5 bg-[#FF7A59]/10 border border-[#FF7A59]/25 text-[#FF7A59]">{error}</div>
      )}

      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Correo o usuario" required className={AUTH_INPUT} />

      <div className="relative">
        <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Contraseña" required className={AUTH_INPUT + ' pr-12'} />
        <button type="button" onClick={() => setShowPassword(!showPassword)}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-[#8A8A8A] hover:text-[#F3F1EA]">
          {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
        </button>
      </div>

      <button type="button" onClick={onForgot} className="text-right text-[13px] font-semibold text-[#8A8A8A] hover:text-[#F3F1EA] transition-colors -mt-1">
        ¿Olvidaste tu contraseña?
      </button>

      <button type="submit" disabled={loading} className={AUTH_BTN + ' mt-1'}>
        {loading ? <span className="w-5 h-5 border-2 border-[#06231d]/30 border-t-[#06231d] rounded-full animate-spin" /> : 'Entrar'}
      </button>

      <div className="text-center text-[14px] text-[#8A8A8A] mt-2">
        ¿Sin cuenta? <button type="button" onClick={onToggle} className="text-[#2ED3B7] font-bold hover:underline">Registrate</button>
      </div>
    </form>
  )
}
