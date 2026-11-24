// Офлайн-оболочка: сначала сеть (в обход HTTP-кэша), при отсутствии сети — сохранённая копия.
const CACHE = 'planner-v2';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const fresh = e.request.mode === 'navigate' || /\.(html|webmanifest)$|\/$/.test(url.pathname) || url.pathname.endsWith('sw.js');
  e.respondWith(
    fetch(e.request, fresh ? { cache: 'no-store' } : {})
      .then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return res; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./')))
  );
});
