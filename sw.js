// Service worker for the game (index.html) - offline play + faster repeat
// loads. Unlike admin-sw.js (push-only, no caching - the CRM always needs a
// live connection), the game benefits from caching since most of what it
// serves is static.
//
// index.html itself is network-first with a cache fallback, never
// stale-while-revalidate - nothing else forces a second read after a stale
// hit, so SWR would mean a real bug fix could get stuck being served
// forever to an already-cached visitor. Static assets (icons/badges) are
// cache-first since a wrong badge image is low-risk. Fonts are
// stale-while-revalidate, the standard safe choice for those. Supabase
// traffic is never touched - a cached auth/game-progress response would be
// actively harmful, not just stale.
const CACHE_NAME = 'ilha-do-foco-v2';
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.hostname.endsWith('supabase.co')) return; // never touch dynamic data

  const isDocument = request.mode === 'navigate' || url.pathname === '/';
  if (isDocument) {
    event.respondWith(
      withTimeout(fetch(request), NETWORK_TIMEOUT_MS)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((cached) => cached || fetch(request)))
    );
    return;
  }

  if (url.hostname.includes('fonts.g')) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(request).then((cached) => {
          const fetchPromise = fetch(request).then((res) => { cache.put(request, res.clone()); return res; });
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  if (url.pathname.startsWith('/icons/') || url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((res) => {
        caches.open(CACHE_NAME).then((cache) => cache.put(request, res.clone()));
        return res;
      }))
    );
  }
});
