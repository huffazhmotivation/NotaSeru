const CACHE_NAME = ‘notaseru-v2.4’;
const ASSETS = [
‘/index.html’,
‘/style.css’,
‘/script.js’,
‘/auth.js’,
‘/config.js’,
‘/manifest.json’
];

self.addEventListener(‘install’, (e) => {
e.waitUntil(
caches.open(CACHE_NAME).then((cache) => {
return cache.addAll(ASSETS).catch(() => {});
})
);
self.skipWaiting();
});

self.addEventListener(‘activate’, (e) => {
e.waitUntil(
caches.keys().then((keys) =>
Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
)
);
self.clients.claim();
});

self.addEventListener(‘fetch’, (e) => {
if (e.request.method !== ‘GET’) return;

// Jangan intercept request ke Supabase atau CDN eksternal
const url = new URL(e.request.url);
if (url.origin !== self.location.origin) return;

e.respondWith(
caches.match(e.request).then((cached) => {
// Jangan pakai cache yang punya redirect
if (cached && cached.redirected) return fetch(e.request);
if (cached) return cached;

```
  return fetch(e.request).then((response) => {
    // Abaikan response redirect atau error
    if (!response || response.status !== 200 || response.redirected) return response;
    const clone = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
    return response;
  }).catch(() => {
    if (e.request.destination === 'document') {
      return caches.match('/index.html');
    }
  });
})
```

);
});
