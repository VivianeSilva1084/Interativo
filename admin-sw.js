// Service worker for the admin CRM PWA - only handles Web Push. No offline
// caching here; the CRM always needs a live Supabase connection anyway, so
// there's nothing useful to serve from cache.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = { title: 'Ilha do Foco — CRM', body: 'Nova atividade no CRM.', url: 'admin.html' };
  if (event.data) {
    try { payload = { ...payload, ...event.data.json() }; }
    catch { payload.body = event.data.text(); }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      data: { url: payload.url },
    })
  );
});

// Focuses an already-open CRM tab instead of stacking a new one, since this
// is a single-purpose admin app the user is expected to have open at most once.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || 'admin.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes('admin.html'));
      if (existing) return existing.focus();
      return self.clients.openWindow(targetUrl);
    })
  );
});
