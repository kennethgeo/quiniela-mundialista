/* Restablecer contraseña — copia VERBATIM del RESET de "Tico Games - Auth y Bracket.dc.html". */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { authStyles as S } from '../components/auth/TicoBrand'

function useScale() {
  const [scale, setScale] = useState(1.2)
  useEffect(() => {
    const calc = () => setScale(Math.min(window.innerWidth / 320, 1.5))
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [])
  return scale
}

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const scale = useScale()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data }) => { if (mounted && data?.session) { /* ready */ } })
    const { data: sub } = supabase.auth.onAuthStateChange(() => {})
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
    <div style={{ minHeight: '100dvh', width: '100%', background: '#0C0C0C', color: '#F3F1EA', display: 'grid', placeItems: 'center', overflow: 'hidden', fontFamily: "'Archivo',sans-serif" }}>
      <div style={{ width: 320, transform: `scale(${scale})`, transformOrigin: 'center center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '32px 26px' }}>
          <div style={S.title}>Nueva contraseña</div>
          <div style={S.subtitle}>Te llegó un link a tu correo. Definí tu nueva clave para volver a entrar.</div>

          {done ? (
            <div style={S.okBox}>¡Contraseña actualizada! Entrando…</div>
          ) : (
            <form onSubmit={handleSubmit} style={S.form}>
              {error && <div style={S.errorBox}>{error}</div>}
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Nueva contraseña" required style={S.input} />
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirmar contraseña" required style={S.input} />
              <button type="submit" disabled={loading} style={{ ...S.button, opacity: loading ? 0.6 : 1 }}>{loading ? 'Guardando…' : 'Guardar y entrar'}</button>
              <div style={S.sub}><button type="button" onClick={() => navigate('/auth')} style={S.link}>← Volver a iniciar sesión</button></div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
