/* Autenticación — copia VERBATIM del diseño "Tico Games - Auth y Bracket.dc.html".
   El marco es de 320px (como en Claude Design) y se escala al ancho del teléfono
   con transform:scale, así queda idéntico al mockup en cualquier pantalla. */
import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { TicoLogo, TicoWordmark, authStyles as S } from '../components/auth/TicoBrand'

const BUILD = 'TICO-UI · 21jul · r3'   // sello de versión (para verificar caché)

// Escala el marco de 320px al ancho del viewport (tope 1.5×).
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

export default function AuthPage() {
  const { user, loading, signOut, signIn, signUp } = useAuth()
  const scale = useScale()
  const [mode, setMode] = useState('login') // 'login' | 'register' | 'forgot'
  const [confirmationMessage, setConfirmationMessage] = useState('')

  useEffect(() => {
    const hash = window.location.hash
    if (hash && hash.includes('type=signup')) {
      setConfirmationMessage('¡Tu correo fue confirmado! Ya podés iniciar sesión.')
      setMode('login')
      if (user) signOut()
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [user, signOut])

  if (!loading && user && !confirmationMessage) return <Navigate to="/" replace />

  return (
    <div style={{ minHeight: '100dvh', width: '100%', background: '#0C0C0C', color: '#F3F1EA', display: 'grid', placeItems: 'center', overflow: 'hidden', fontFamily: "'Archivo',sans-serif", position: 'relative' }}>
      {/* Orbes de glow a pantalla completa (fuera de la caja escalada, para que no se recorten) */}
      <div style={{ position: 'absolute', top: -120, right: -120, width: 380, height: 380, borderRadius: '50%', background: 'radial-gradient(circle,rgba(46,211,183,.16),transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: -140, left: -120, width: 380, height: 380, borderRadius: '50%', background: 'radial-gradient(circle,rgba(255,122,89,.12),transparent 70%)', pointerEvents: 'none' }} />

      <div style={{ width: 320, transform: `scale(${scale})`, transformOrigin: 'center center', position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '32px 26px', position: 'relative' }}>
          {mode !== 'forgot' && (
            <div style={S.header}>
              <TicoLogo />
              <TicoWordmark />
            </div>
          )}

          {mode === 'login' && <LoginBody signIn={signIn} confirmationMessage={confirmationMessage} toRegister={() => setMode('register')} toForgot={() => setMode('forgot')} />}
          {mode === 'register' && <RegisterBody signUp={signUp} toLogin={() => setMode('login')} />}
          {mode === 'forgot' && <ForgotBody toLogin={() => setMode('login')} />}
        </div>
      </div>

      <div style={{ position: 'fixed', bottom: 5, left: 0, right: 0, textAlign: 'center', font: "600 8px 'JetBrains Mono',monospace", letterSpacing: '.12em', color: '#3a3a3a' }}>{BUILD}</div>
    </div>
  )
}

function LoginBody({ signIn, confirmationMessage, toRegister, toForgot }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError(''); setLoading(true)
    try { await signIn(email, password) }
    catch (err) { setError(err.message === 'Invalid login credentials' ? 'Credenciales inválidas. Revisá tu correo y contraseña.' : err.message) }
    finally { setLoading(false) }
  }

  return (
    <form onSubmit={submit} style={S.form}>
      {confirmationMessage && <div style={S.okBox}>{confirmationMessage}</div>}
      {error && <div style={S.errorBox}>{error}</div>}
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Correo o usuario" required style={S.input} />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña" required style={S.input} />
      <button type="button" onClick={toForgot} style={S.forgot}>¿Olvidaste tu contraseña?</button>
      <button type="submit" disabled={loading} style={{ ...S.button, opacity: loading ? 0.6 : 1 }}>{loading ? 'Entrando…' : 'Entrar'}</button>
      <div style={S.sub}>¿Sin cuenta? <button type="button" onClick={toRegister} style={S.link}>Registrate</button></div>
    </form>
  )
}

function RegisterBody({ signUp, toLogin }) {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError(''); setOk(''); setLoading(true)
    try {
      const data = await signUp(email, password, username)
      if (data && !data.session) { setOk('¡Cuenta creada! Revisá tu correo para verificarla.'); setUsername(''); setEmail(''); setPassword('') }
      else setOk('¡Cuenta creada! Entrando…')
    } catch (err) {
      setError(err.message === 'User already registered' ? 'Ese correo ya está registrado.' : err.message)
    } finally { setLoading(false) }
  }

  return (
    <form onSubmit={submit} style={S.form}>
      {ok && <div style={S.okBox}>{ok}</div>}
      {error && <div style={S.errorBox}>{error}</div>}
      <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Nombre / usuario" required style={S.input} />
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Correo" required style={S.input} />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña" required style={S.input} />
      <button type="submit" disabled={loading} style={{ ...S.button, opacity: loading ? 0.6 : 1 }}>{loading ? 'Creando…' : 'Crear cuenta'}</button>
      <div style={S.sub}>¿Ya tenés cuenta? <button type="button" onClick={toLogin} style={S.link}>Entrar</button></div>
    </form>
  )
}

function ForgotBody({ toLogin }) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` })
      if (err) throw err
      setSent(true)
    } catch (err) { setError(err.message || 'No se pudo enviar el correo. Intentá de nuevo.') }
    finally { setLoading(false) }
  }

  return (
    <form onSubmit={submit} style={S.form}>
      <div style={S.title}>Recuperar contraseña</div>
      <div style={S.subtitle}>Ingresá tu correo y te enviamos un link para restablecerla.</div>
      {sent
        ? <div style={S.okBox}>Listo. Revisá tu correo para el enlace de recuperación.</div>
        : <>
            {error && <div style={S.errorBox}>{error}</div>}
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Correo" required style={S.input} />
            <button type="submit" disabled={loading} style={{ ...S.button, opacity: loading ? 0.6 : 1 }}>{loading ? 'Enviando…' : 'Enviar enlace'}</button>
          </>}
      <div style={S.sub}><button type="button" onClick={toLogin} style={S.link}>← Volver a entrar</button></div>
    </form>
  )
}
