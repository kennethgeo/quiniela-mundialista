self.addEventListener('push', function(event) {
  if (event.data) {
    try {
      const data = event.data.json()
      
      const options = {
        body: data.body,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/badge-72x72.png',
        vibrate: [100, 50, 100],
        data: {
          url: data.url || '/'
        }
      }
      
      event.waitUntil(
        self.registration.showNotification(data.title || 'Quiniela Mundialista', options)
      )
    } catch (e) {
      console.error('Error parsing push data', e)
    }
  }
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
