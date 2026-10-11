/* Todo push MUESTRA un aviso, aunque venga vacío o mal formado (10 oct 2026).
   Safari en iPhone revoca la suscripción de un sitio que recibe pushes sin
   mostrar nada, y Chrome muestra «este sitio se actualizó en segundo plano».
   Antes un payload que no era JSON terminaba sin aviso y sin waitUntil. */
self.addEventListener('push', function(event) {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    let texto = ''
    try { texto = event.data.text() } catch (_) { /* nada que leer */ }
    data = { body: texto }
  }

  const options = {
    body: data.body || 'Tenés novedades en tus quinielas.',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/'
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Tico Games', options)
  )
})

self.addEventListener('notificationclick', function(event) {
  event.notification.close()
  
  const targetUrl = event.notification.data.url
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i]
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus()
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl)
      }
    })
  )
})
