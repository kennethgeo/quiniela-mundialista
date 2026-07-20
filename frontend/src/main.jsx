import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.jsx'

// Auto-actualización del PWA: revisa si hay versión nueva (al abrir, al volver a
// foco, al reconectar y cada 60s) y aplica/recarga sola. Antes el service worker
// servía el bundle viejo aunque se reiniciara la app (típico en iOS).
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() { updateSW(true) },
  onRegisteredSW(_swUrl, r) {
    if (!r) return
    const check = () => { r.update().catch(() => {}) }
    setInterval(check, 60_000)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check() })
    window.addEventListener('online', check)
  },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
