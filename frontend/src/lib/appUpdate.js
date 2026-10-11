/* Herramienta de recuperación deliberadamente fuera de la navegación principal.
   Borra solo cachés del navegador y fuerza al service worker a buscar una versión;
   no toca la sesión, preferencias ni datos remotos. */
/* `conservarPrecache` (11 oct 2026): la recarga AUTOMÁTICA del ErrorBoundary
   no borra el precache de Workbox. Si el chunk falló por la red y no hay una
   versión nueva detrás, vaciarlo dejaba la PWA instalada sin su app shell
   hasta el próximo despliegue (no abría sin conexión). Cuando sí hay versión
   nueva, Workbox limpia el precache viejo solo al activarla. La herramienta
   manual del Perfil sigue borrando todo. */
export async function refreshApplication({ conservarPrecache = false } = {}) {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((registration) => registration.update().catch(() => {})))
  }
  if (typeof caches !== 'undefined') {
    const keys = await caches.keys()
    const borrar = conservarPrecache ? keys.filter((key) => !key.startsWith('workbox-precache')) : keys
    await Promise.all(borrar.map((key) => caches.delete(key)))
  }
  window.location.reload()
}
