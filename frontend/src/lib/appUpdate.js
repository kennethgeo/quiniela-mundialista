/* Herramienta de recuperación deliberadamente fuera de la navegación principal.
   Borra solo cachés del navegador y fuerza al service worker a buscar una versión;
   no toca la sesión, preferencias ni datos remotos. */
export async function refreshApplication() {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((registration) => registration.update().catch(() => {})))
  }
  if (typeof caches !== 'undefined') {
    const keys = await caches.keys()
    await Promise.all(keys.map((key) => caches.delete(key)))
  }
  window.location.reload()
}
