import React, { createContext, useContext, useEffect, useState } from 'react'

const ThemeContext = createContext()

export function ThemeProvider({ children }) {
  // Inicializamos leyendo el localStorage o usando 'light' por defecto (Prodefy style)
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('qm_theme')
      if (stored) return stored
      // Opcional: leer preferencia del sistema
      // if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark'
    }
    return 'light' // Default a light mode (estilo Prodefy)
  })

  // Efecto para actualizar el DOM cuando cambia el tema
  useEffect(() => {
    const root = window.document.documentElement
    
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }

    localStorage.setItem('qm_theme', theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light')
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
