import React from 'react'
import { refreshApplication } from '../../lib/appUpdate'

const CLAVE_RECARGA = 'recargaPorVersionVieja'

function recargoHacePoco () {
  try { return Date.now() - parseInt(sessionStorage.getItem(CLAVE_RECARGA), 10) < 60000 } catch { return false }
}
function anotarRecarga () {
  try { sessionStorage.setItem(CLAVE_RECARGA, String(Date.now())) } catch { /* modo privado */ }
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, isReloading: false }
  }

  static getDerivedStateFromError(_error) {
    return { hasError: true }
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary atrapó un error:', error, errorInfo)
    // Detectar si es un error de chunk de Vite al actualizar la PWA o backend
    if (
      error.name === 'ChunkLoadError' || 
      error.message?.includes('Failed to fetch dynamically imported module') ||
      error.message?.includes('Importing a module script failed')
    ) {
      // Una recarga por versión vieja, no un bucle: si ya se recargó por esto
      // hace menos de un minuto, se muestra el error con su botón.
      if (recargoHacePoco()) return
      this.setState({ isReloading: true })

      // NUNCA desregistrar el service worker (10 oct 2026). Desregistrarlo
      // borra la suscripción push del dispositivo —va atada al registro— y
      // la persona se quedaba sin avisos sin saberlo, justo después de cada
      // despliegue, que es cuando aparece este error. Alcanza con lo que hace
      // la herramienta de recuperación: pedir la versión nueva, vaciar los
      // cachés y recargar. Una actualización del service worker conserva la
      // suscripción.
      anotarRecarga()
      refreshApplication().catch(() => window.location.reload())
    }
  }

  render() {
    if (this.state.isReloading) {
      return (
        <div className="min-h-dvh flex flex-col items-center justify-center bg-[#0a0a0f] text-slate-200">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-sm font-medium text-slate-400">Actualizando versión...</p>
        </div>
      )
    }

    if (this.state.hasError) {
      return (
        <div className="min-h-dvh flex flex-col items-center justify-center bg-[#0a0a0f] text-slate-200 p-6 text-center">
          <h2 className="text-xl font-bold text-white mb-2">¡Ups! Algo salió mal.</h2>
          <p className="text-sm text-slate-400 mb-6 max-w-sm">
            Tuvimos un problema cargando esta pantalla. Si la aplicación se acaba de actualizar, es normal.
          </p>
          <button 
            onClick={() => window.location.reload(true)} 
            className="px-6 py-2.5 bg-accent hover:bg-accent/80 text-slate-900 font-bold rounded-xl transition-all"
          >
            Recargar Aplicación
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default ErrorBoundary
