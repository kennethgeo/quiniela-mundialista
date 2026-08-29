// Contexto de autenticación - gestiona el estado del usuario en toda la app
import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { conLimite, describirFallo, registrarIntento } from '../lib/loginResiliente'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  /**
   * Obtiene el perfil del usuario desde la tabla public.users
   */
  const fetchProfile = useCallback(async (userId) => {
    try {
      // Columnas explícitas, NO select('*'). 'email' dejó de ser legible desde
      // el cliente (RLS filtra filas, no columnas, así que la única forma era
      // quitar el permiso de esa columna) y un '*' se expande a TODAS —
      // incluida esa — y devuelve "permission denied". Con el '*' puesto, esto
      // rompía el arranque de sesión de todo el mundo.
      const { data, error } = await supabase
        .from('users')
        .select('id, display_name, avatar_url, total_points, points_adjustment, is_admin, created_at, updated_at')
        .eq('id', userId)
        .single()

      if (error) throw error
      setProfile(data)
      return data
    } catch (err) {
      console.error('Error al obtener perfil:', err.message)
      setProfile(null)
      return null
    }
  }, [])

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
    setUser(null)
    setProfile(null)
  }, [])

  /**
   * Cierra la sesión actual
   */
  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    setUser(null)
    setProfile(null)
  }, [])

  // Escuchar cambios en el estado de autenticación
  useEffect(() => {
    // Obtener sesión inicial
    const initAuth = async () => {
      try {
        // Envolvemos getSession en un timeout por si el storage o supabase se quedan pegados en PWA
        const sessionPromise = supabase.auth.getSession()
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
        
        const { data: { session }, error } = await Promise.race([sessionPromise, timeoutPromise])
        if (error) throw error

        const currentUser = session?.user ?? null
        setUser(currentUser)

        if (currentUser) {
          // Lanzar fetchProfile sin await para no bloquear la pantalla de carga (soluciona pantalla en negro en PWA)
          fetchProfile(currentUser.id).catch(err => console.error('Error cargando perfil:', err))
        }
      } catch (err) {
        console.error('Error al inicializar auth:', err.message)
      } finally {
        setLoading(false)
      }
    }

    initAuth()

    // Suscribirse a cambios de autenticación
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        const currentUser = session?.user ?? null
        setUser(currentUser)

        if (currentUser && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
          fetchProfile(currentUser.id).catch(err => console.error('Error cargando perfil en evento:', err))
        }

        if (event === 'SIGNED_OUT') {
          setProfile(null)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [fetchProfile])

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
