const CACHE_NAME = 'notaseru-v4.1';
const ASSETS = [
  '/index.html',
  '/style.css',
  '/script.js',
  '/auth.js',
  '/config.js',
  '/manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // PENTING: pakai fetch manual dengan {cache:'reload'}, BUKAN cache.addAll()
      // biasa. cache.addAll() diam-diam bisa ambil versi lama dari HTTP cache
      // browser kalau file itu masih dianggap "fresh" oleh header cache-control
      // hosting (Netlify/Vercel) — akibatnya versi baru sudah aktif tapi isi
      // filenya tetap yang lama, jadi tombol "Muat ulang" kelihatan seperti
      // tidak melakukan apa-apa. Dengan {cache:'reload'} kita paksa ambil
      // langsung dari network setiap kali ada update.
      return Promise.all(
        ASSETS.map((url) =>
          fetch(url, { cache: 'reload' })
            .then((res) => { if (res.ok) return cache.put(url, res); })
            .catch(() => {})
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  // Jangan intercept request ke Supabase atau CDN eksternal
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  // Jangan cache request ke /api/* (mis. cek ongkir) — hasilnya dinamis
  // tergantung parameter, jadi selalu harus hit network langsung.
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Untuk dokumen HTML (navigasi halaman): coba network dulu supaya shell
  // app selalu sefresh mungkin, baru fallback ke cache kalau offline/gagal.
  if (e.request.mode === 'navigate' || e.request.destination === 'document') {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(e.request).then((c) => c || caches.match('/index.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) => {
      // Jangan pakai cache yang punya redirect
      if (cached && cached.redirected) return fetch(e.request);
      if (cached) return cached;

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
  );
});
