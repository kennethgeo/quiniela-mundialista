import React from 'react'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, isReloading: false }
  }

  static getDerivedStateFromError(error) {
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
      this.setState({ isReloading: true })
      // Forzar recarga ignorando la caché para traer la nueva versión de index.html
      window.location.reload(true)
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
