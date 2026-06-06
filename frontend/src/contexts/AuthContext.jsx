// Contexto de autenticación - gestiona el estado del usuario en toda la app
import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

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
      const { data, error } = await supabase
        .from('users')
        .select('*')
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
   * Inicia sesión con email y contraseña
   */
  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    })

    if (error) throw error
    return data
  }

  /**
   * Cierra la sesión actual
   */
  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    setUser(null)
    setProfile(null)
  }

  // Escuchar cambios en el estado de autenticación
  useEffect(() => {
    // Obtener sesión inicial
    const initAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const currentUser = session?.user ?? null
        setUser(currentUser)

        if (currentUser) {
          await fetchProfile(currentUser.id)
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
          await fetchProfile(currentUser.id)
        }

        if (event === 'SIGNED_OUT') {
          setProfile(null)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [fetchProfile])

  // Lógica de inactividad (30 minutos)
  useEffect(() => {
    let inactivityTimer

    const resetTimer = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer)
      // 30 minutos = 30 * 60 * 1000 = 1800000 ms
      inactivityTimer = setTimeout(() => {
        if (user) {
          console.log('Sesión expirada por inactividad')
          signOut()
        }
      }, 1800000)
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
