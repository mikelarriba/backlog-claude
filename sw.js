const CACHE_NAME = 'backlog-claude-v7';
const PRECACHE = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Stale-while-revalidate for JS/CSS (consistent with server Cache-Control: max-age=300)
// Network-first for everything else; skip API requests entirely
self.addEventListener('fetch', event => {
  const { request } = event;

  if (request.method !== 'GET' || request.url.includes('/api/')) return;

  const isStaticAsset = request.url.match(/\.(css|js|png|svg|ico|woff2?)$/);

  if (isStaticAsset) {
    // Stale-while-revalidate: serve from cache immediately, refresh in background
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(request).then(cached => {
          const networkFetch = fetch(request).then(response => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          });
          return cached || networkFetch;
        })
      )
    );
  } else {
    // Network-first for HTML and other resources
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok && (request.url.endsWith('/') || request.url.endsWith('.html'))) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
  }
});
