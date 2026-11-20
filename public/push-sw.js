// Wird vom Service Worker geladen: zeigt die Merklisten-Nachricht an.
self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let msg = { title: 'Angebotsküche', body: 'Die Angebote der Woche sind da.' };
      try {
        const sub = await self.registration.pushManager.getSubscription();
        const res = await fetch('/api/push/latest?endpoint=' + encodeURIComponent(sub ? sub.endpoint : ''), { credentials: 'include' });
        if (res.ok && (res.headers.get('content-type') || '').includes('json')) msg = await res.json();
      } catch (e) {
        /* Standardtext */
      }
      await self.registration.showNotification(msg.title, {
        body: msg.body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: msg.tag || 'merkliste',
        data: { url: msg.url || '/?tab=angebote' },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const url = (event.notification.data && event.notification.data.url) || '/';
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (all.length) {
        all[0].postMessage({ type: 'open', url });
        return all[0].focus();
      }
      return self.clients.openWindow(url);
    })(),
  );
});
