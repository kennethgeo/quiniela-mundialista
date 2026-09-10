/* Autenticación. El marco es de 320px y se escala al ancho del teléfono. */
import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { TicoLogo, TicoWordmark, authStyles as S } from '../components/auth/TicoBrand'
import { mensajeDeFallo } from '../lib/loginResiliente'
import { traerProveedores } from '../lib/proveedoresAuth'

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

/* La G de Google en SVG propio: el CSP solo permite recursos de este origen,
   así que traerla de un CDN la bloquearía el navegador sin decir por qué. */
function LogoGoogle() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

export default function AuthPage() {
  const { user, loading, signOut, signIn, signUp, entrarConGoogle, restablecerSesionLocal } = useAuth()
  const scale = useScale()
  const [mode, setMode] = useState('login') // 'login' | 'register' | 'forgot'
  const [confirmationMessage, setConfirmationMessage] = useState('')

  /* Qué proveedores están encendidos DE VERDAD en Supabase. El botón de Google
     solo se dibuja si el proyecto lo tiene activo: encenderlo se hace en el
     panel, no en el repo, y un botón que da «provider is not enabled» es peor
     que no tenerlo. Si esto falla o tarda, la lista queda vacía y la pantalla
     funciona igual — es un extra, nunca un requisito para entrar. */
  const [proveedores, setProveedores] = useState([])
  useEffect(() => {
    let vigente = true
    traerProveedores(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY).then((lista) => {
      if (vigente) setProveedores(lista)
    })
    return () => { vigente = false }
  }, [])

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

          {mode === 'login' && <LoginBody signIn={signIn} entrarConGoogle={proveedores.includes('google') ? entrarConGoogle : null} restablecerSesionLocal={restablecerSesionLocal} confirmationMessage={confirmationMessage} toRegister={() => setMode('register')} toForgot={() => setMode('forgot')} />}
          {mode === 'register' && <RegisterBody signUp={signUp} toLogin={() => setMode('login')} />}
          {mode === 'forgot' && <ForgotBody toLogin={() => setMode('login')} />}
        </div>
      </div>
    </div>
  )
}

function LoginBody({ signIn, entrarConGoogle, restablecerSesionLocal, confirmationMessage, toRegister, toForgot }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [atascado, setAtascado] = useState(false)
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError(''); setAtascado(false); setLoading(true)
    try { await signIn(email, password) }
    catch (err) {
      setError(mensajeDeFallo(err))
      // Solo cuando venció el plazo ofrecemos limpiar: si las credenciales
      // están mal, borrar la sesión local no arregla nada y confunde.
      if (err.recuperable) setAtascado(true)
    }
    finally { setLoading(false) }
  }

  const limpiar = async () => {
    await restablecerSesionLocal()
    setError(''); setAtascado(false)
  }

  return (
    <form onSubmit={submit} style={S.form}>
      {confirmationMessage && <div role="status" style={S.okBox}>{confirmationMessage}</div>}
      {error && <div role="alert" style={S.errorBox}>{error}</div>}
      <label htmlFor="login-email" style={S.srOnly}>Correo o usuario</label>
      <input id="login-email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Correo o usuario" autoComplete="username" required style={S.input} />
      <label htmlFor="login-password" style={S.srOnly}>Contraseña</label>
      <input id="login-password" name="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña" autoComplete="current-password" required style={S.input} />
      <button type="button" onClick={toForgot} style={S.forgot}>¿Olvidaste tu contraseña?</button>
      <button type="submit" disabled={loading} style={{ ...S.button, opacity: loading ? 0.6 : 1 }}>{loading ? 'Entrando…' : 'Entrar'}</button>
      {entrarConGoogle && (
        <>
          <div style={S.separador}><span style={S.separadorTexto}>o</span></div>
          <button type="button" disabled={loading} style={{ ...S.botonGoogle, opacity: loading ? 0.6 : 1 }}
            onClick={async () => {
              setError('')
              /* Esto MANDA el navegador a Google; si vuelve, es porque no
                 salió. Por eso no hay `finally` que apague el cargando: la
                 página ya no existe cuando sale bien. */
              try { await entrarConGoogle() } catch (err) { setError(mensajeDeFallo(err)) }
            }}>
            <LogoGoogle /> Entrar con Google
          </button>
          {/* El enlace con una cuenta que ya existe es POR CORREO, no por
              persona: Supabase junta las identidades que comparten correo.
              Quien entre con un Google de otra dirección cae en una cuenta
              nueva y vacía —sin sus quinielas ni sus puntos— y va a creer que
              perdió todo. Medido: 3 de los 26 se registraron con hotmail. */}
          <div style={S.sub}>Usá el mismo correo con el que te registraste.</div>
        </>
      )}
      {atascado && (
        <div style={S.sub}>¿Sigue sin entrar? <button type="button" onClick={limpiar} style={S.link}>Restablecer sesión local</button></div>
      )}
      <div style={S.sub}>¿Sin cuenta? <button type="button" onClick={toRegister} style={S.link}>Registrate</button></div>
      {/* Enlazadas desde acá y no solo por URL: Google las revisa desde la
          pantalla de consentimiento, y quien está por entrar con Google
          debería poder leer qué se guarda de él ANTES de decidir. */}
      <div style={{ ...S.sub, marginTop: 12, fontSize: 11 }}>
        <a href="/privacidad" style={{ color: '#8A8A8A' }}>Privacidad</a>
        {' · '}
        <a href="/terminos" style={{ color: '#8A8A8A' }}>Condiciones</a>
      </div>
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
      {ok && <div role="status" style={S.okBox}>{ok}</div>}
      {error && <div role="alert" style={S.errorBox}>{error}</div>}
      <label htmlFor="register-username" style={S.srOnly}>Nombre o usuario</label>
      <input id="register-username" name="username" type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Nombre / usuario" autoComplete="username" required style={S.input} />
      <label htmlFor="register-email" style={S.srOnly}>Correo</label>
      <input id="register-email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Correo" autoComplete="email" required style={S.input} />
      <label htmlFor="register-password" style={S.srOnly}>Contraseña</label>
      <input id="register-password" name="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña" autoComplete="new-password" required style={S.input} />
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
        ? <div role="status" style={S.okBox}>Listo. Revisá tu correo para el enlace de recuperación.</div>
        : <>
            {error && <div role="alert" style={S.errorBox}>{error}</div>}
            <label htmlFor="forgot-email" style={S.srOnly}>Correo</label>
            <input id="forgot-email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Correo" autoComplete="email" required style={S.input} />
            <button type="submit" disabled={loading} style={{ ...S.button, opacity: loading ? 0.6 : 1 }}>{loading ? 'Enviando…' : 'Enviar enlace'}</button>
          </>}
      <div style={S.sub}><button type="button" onClick={toLogin} style={S.link}>← Volver a entrar</button></div>
    </form>
  )
}
