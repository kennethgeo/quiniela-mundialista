// Contexto de autenticación - gestiona el estado del usuario en toda la app
import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { crearCargaDePerfil } from '../lib/cargaDePerfil'
import { conLimite, describirFallo, registrarIntento } from '../lib/loginResiliente'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const [cargaPerfil] = useState(() => crearCargaDePerfil({
    leer: async (userId) => {
      const { data, error } = await supabase
        .from('users')
        .select('id, display_name, avatar_url, total_points, points_adjustment, is_admin, created_at, updated_at')
        .eq('id', userId)
        .single()
      if (error) throw error
      return data
    },
    aplicar: setProfile,
    alFallar: () => console.warn('[perfil] No se pudo cargar el perfil de la sesión actual'),
  }))
  const asignarUsuario = useCallback((actual) => {
    if (cargaPerfil.cambiarUsuario(actual?.id)) setProfile(null)
    setUser(actual)
  }, [cargaPerfil])
  const fetchProfile = useCallback((id) => cargaPerfil.cargar(id), [cargaPerfil])

  /**
   * Registra un nuevo usuario con email, contraseña y nombre visible
   */
  const signUp = async (email, password, displayName) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName }
      }
    })

    if (error) throw error
    return data
  }

  /* Entrar con Google.

     No devuelve sesión: manda el navegador a Google y la app se recarga al
     volver. La sesión la recoge `detectSessionInUrl` (que viene encendido por
     defecto — comprobado en el paquete instalado, no en la documentación) y
     `onAuthStateChange` la aplica, igual que cualquier otra.

     NO se toca `flowType`. Viene en 'implicit' y así funciona; pasarlo a
     'pkce' cambiaría también el formato del enlace de recuperar contraseña,
     que la pantalla /reset-password lee como está hoy. Arreglar el login
     rompiendo el restablecimiento no es un arreglo.

     A quien YA tiene cuenta con ese mismo correo no se le crea una segunda:
     Supabase enlaza las identidades con el mismo correo a un solo usuario,
     siempre que el correo esté verificado — y los 26 de esta app lo están. Sin
     eso, entrar con Google dejaría a alguien en una cuenta nueva y vacía, sin
     sus quinielas ni sus puntos. */
  const entrarConGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/` },
    })
    if (error) throw error
  }

  /**
   * Inicia sesión con email y contraseña, con tiempo límite.
   *
   * Sin límite, si la petición no vuelve nunca la promesa tampoco resuelve y el
   * botón se queda en "Entrando…" para siempre. Pasó en producción.
   *
   * Al vencer el plazo NO damos por fallado el intento: la petición pudo haber
   * entrado y habérsenos perdido la respuesta. Se comprueba mirando si quedó
   * sesión; solo si no hay, se devuelve un error recuperable para que la
   * pantalla vuelva a habilitar el botón.
   */
  const LIMITE_LOGIN_MS = 15000
  const LIMITE_SESION_MS = 4000

  const signIn = async (email, password) => {
    const inicio = Date.now()

    try {
      const { data, error } = await conLimite(
        supabase.auth.signInWithPassword({ email, password }),
        LIMITE_LOGIN_MS,
        'login',
      )
      if (error) throw error
      registrarIntento('ok', Date.now() - inicio)
      return data
    } catch (err) {
      if (err?.esTiempoAgotado) {
        const sesion = await sesionActual()
        if (sesion) {
          registrarIntento('ok-tras-vencer-el-plazo', Date.now() - inicio)
          return { session: sesion, user: sesion.user }
        }
        registrarIntento('tiempo-agotado', Date.now() - inicio)
        const fallo = new Error(
          'La conexión está tardando demasiado. Revisá tu internet y probá de nuevo.',
        )
        fallo.recuperable = true
        throw fallo
      }

      registrarIntento(describirFallo(err), Date.now() - inicio)
      throw err
    }
  }

  /**
   * Lee la sesión guardada con tiempo límite. Devuelve null si no hay o si el
   * almacenamiento tampoco responde (pasa en la PWA cuando el navegador le
   * bloquea el storage al sitio instalado).
   */
  const sesionActual = async () => {
    try {
      const { data } = await conLimite(supabase.auth.getSession(), LIMITE_SESION_MS, 'sesión')
      return data?.session ?? null
    } catch {
      return null
    }
  }

  /**
   * Borra la sesión de ESTE dispositivo y nada más.
   *
   * `scope: 'local'` a propósito: el signOut normal es global y cierra la
   * sesión en todos los dispositivos de la persona. Esto es un botón de
   * "destrabame el login", no un cierre de sesión — y además el global necesita
   * red, que es justo lo que puede estar fallando.
   */
  const restablecerSesionLocal = useCallback(async () => {
    try {
      await conLimite(supabase.auth.signOut({ scope: 'local' }), LIMITE_SESION_MS, 'restablecer')
    } catch (err) {
      // Que no vuelva sirve igual: abajo se limpia el estado de todos modos.
      console.info(`[login] restablecer local: ${describirFallo(err)}`)
    }
    asignarUsuario(null)
  }, [asignarUsuario])

  /**
   * Cierra la sesión actual
   */
  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    asignarUsuario(null)
  }, [asignarUsuario])

  // Escuchar cambios en el estado de autenticación
  useEffect(() => {
    let vigente = true
    let huboEvento = false
    // Obtener sesión inicial
    const initAuth = async () => {
      try {
        // Envolvemos getSession en un timeout por si el storage o supabase se quedan pegados en PWA
        const sessionPromise = supabase.auth.getSession()
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
        
        const { data: { session }, error } = await Promise.race([sessionPromise, timeoutPromise])
        if (error) throw error

        if (!vigente || huboEvento) return
        const currentUser = session?.user ?? null
        asignarUsuario(currentUser)

        if (currentUser) {
          // Lanzar fetchProfile sin await para no bloquear la pantalla de carga (soluciona pantalla en negro en PWA)
          fetchProfile(currentUser.id).catch(err => console.error('Error cargando perfil:', err))
        }
      } catch (err) {
        console.error('Error al inicializar auth:', err.message)
      } finally {
        if (vigente) setLoading(false)
      }
    }

    initAuth()

    // Suscribirse a cambios de autenticación
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!vigente) return
        huboEvento = true
        const currentUser = session?.user ?? null
        asignarUsuario(currentUser)

        if (currentUser && (['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event))) {
          fetchProfile(currentUser.id).catch(err => console.error('Error cargando perfil en evento:', err))
        }

        if (event === 'SIGNED_OUT') {
          setProfile(null)
        }
      }
    )

    return () => {
      vigente = false
      cargaPerfil.cambiarUsuario(null)
      subscription.unsubscribe()
    }
  }, [fetchProfile, asignarUsuario, cargaPerfil])

  // Lógica de inactividad (1 día)
  useEffect(() => {
    let inactivityTimer

    const resetTimer = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer)
      // 1 día = 24 * 60 * 60 * 1000 = 86400000 ms
      inactivityTimer = setTimeout(() => {
        if (user) {
          console.log('Sesión expirada por inactividad')
          signOut()
        }
      }, 86400000)
    }

    if (user) {
      // Iniciar el temporizador
      resetTimer()
      
      // Eventos que reinician el temporizador de inactividad
      const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart']
      events.forEach((event) => window.addEventListener(event, resetTimer))

      return () => {
        if (inactivityTimer) clearTimeout(inactivityTimer)
        events.forEach((event) => window.removeEventListener(event, resetTimer))
      }
    }
  }, [user])

  const value = {
    user,
    profile,
    loading,
    signUp,
    entrarConGoogle,
    signIn,
    signOut,
    restablecerSesionLocal,
    fetchProfile
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

/**
 * Hook para acceder al contexto de autenticación.
 * Debe usarse dentro de un AuthProvider.
 */
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth debe usarse dentro de un AuthProvider')
  }
  return context
}
