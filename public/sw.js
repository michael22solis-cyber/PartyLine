// Service worker: shows push notifications and opens the right thread when tapped.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() }; }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Blackwood Line', {
      body: data.body || 'New message',
      icon: '/assets/icon-180.png',
      badge: '/assets/icon-180.png',
      tag: data.url || 'blackwood',
      renotify: true,
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.includes(url.split('#')[0])) { w.navigate(url); return w.focus(); }
      }
      return self.clients.openWindow(url);
    }),
  );
});
