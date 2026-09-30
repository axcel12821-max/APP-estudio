// Service worker de Focusly:
// - permite mostrar notificaciones (necesario en Android) y enfoca la app al tocarlas;
// - guarda una copia de la app para abrirla sin conexiÃ³n. Usa "red primero":
//   siempre intenta la versiÃ³n nueva y solo cae a la copia si no hay internet.
const CACHE = 'focusly-v3';
const CDN = 'https://cdn.jsdelivr.net';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
  await self.clients.claim();
})()));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Solo archivos de la app y la librerÃ­a de Supabase; nunca la API (datos del usuario)
  if (url.origin !== self.location.origin && url.origin !== CDN) return;
  e.respondWith((async () => {
    try {
      // no-cache: siempre pregunta al servidor si el archivo cambió (evita usar un JS viejo tras una actualización)
      const res = await fetch(req, url.origin === self.location.origin ? { cache: 'no-cache' } : undefined);
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    } catch (err) {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      if (req.mode === 'navigate') return caches.match('./index.html');
      throw err;
    }
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (all.length) return all[0].focus();
    return self.clients.openWindow('./');
  })());
});
