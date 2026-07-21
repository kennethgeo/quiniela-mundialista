/* Registro — Tico Games (rediseño). */
import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { AUTH_INPUT, AUTH_BTN } from './TicoBrand'

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
    setError(''); setSuccessMsg(''); setLoading(true)
    try {
      const data = await signUp(email, password, username)
      if (data && !data.session) {
        setSuccessMsg('¡Cuenta creada! Revisá tu correo para verificarla.')
        setUsername(''); setEmail(''); setPassword('')
      } else {
        setSuccessMsg('¡Cuenta creada! Entrando…')
      }
    } catch (err) {
      setError(err.message === 'User already registered' ? 'Ese correo ya está registrado.' : err.message)
    } finally { setLoading(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="text-center mb-1">
        <div className="font-['Unbounded'] font-bold text-[17px] text-[#F3F1EA]">Creá tu cuenta</div>
      </div>

      {successMsg && (
        <div className="text-[12px] leading-snug rounded-lg p-3 bg-[#2ED3B7]/10 border border-[#2ED3B7]/25 text-[#2ED3B7]">{successMsg}</div>
      )}
      {error && (
        <div className="text-[12px] leading-snug rounded-lg p-3 bg-[#FF7A59]/10 border border-[#FF7A59]/25 text-[#FF7A59]">{error}</div>
      )}

      <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Nombre / usuario" required className={AUTH_INPUT} />
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Correo" required className={AUTH_INPUT} />

      <div className="relative">
        <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Contraseña" required className={AUTH_INPUT + ' pr-11'} />
        <button type="button" onClick={() => setShowPassword(!showPassword)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8A8A8A] hover:text-[#F3F1EA]">
          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>

      <button type="submit" disabled={loading} className={AUTH_BTN + ' mt-1'}>
        {loading ? <span className="w-5 h-5 border-2 border-[#06231d]/30 border-t-[#06231d] rounded-full animate-spin" /> : 'Crear cuenta'}
      </button>

      <div className="text-center text-[12px] text-[#8A8A8A] mt-1.5">
        ¿Ya tenés cuenta? <button type="button" onClick={onToggle} className="text-[#2ED3B7] font-bold hover:underline">Iniciá sesión</button>
      </div>
    </form>
  )
}
