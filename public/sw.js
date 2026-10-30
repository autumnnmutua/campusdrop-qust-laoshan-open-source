/*
 * CampusDrop service worker: offline app shell, asset caching and web push.
 * - Page navigations: network first, falling back to the last good copy of the app shell when offline.
 * - /assets/* (content-hashed): cache first. Images and icons: stale-while-revalidate.
 * - /api/* is never cached or touched.
 * - push: shows the notification the Worker sent; clicking it opens (or focuses) the site on that page.
 */
// The placeholder below is replaced at build time (scripts/sw-version.mjs) with a hash of this release's assets.
const VERSION = 'campusdrop-__SW_BUILD__';
const SHELL = `${VERSION}-shell`, ASSETS = `${VERSION}-assets`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('campusdrop-') && key !== SHELL && key !== ASSETS) await caches.delete(key);
  await self.clients.claim();
})()));

self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok && (response.headers.get('content-type') ?? '').includes('text/html')) (await caches.open(SHELL)).put('/', response.clone());
        return response;
      } catch {
        return (await caches.match('/', { cacheName: SHELL })) ?? Response.error();
      }
    })());
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const cached = await caches.match(request, { cacheName: ASSETS });
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) (await caches.open(ASSETS)).put(request, response.clone());
      return response;
    })());
    return;
  }
  if (url.pathname.startsWith('/images/') || /^\/(icon-\d+\.png|favicon\.(svg|ico)|apple-touch-icon\.png)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSETS), cached = await cache.match(request);
      const network = fetch(request).then(response => { if (response.ok) cache.put(request, response.clone()); return response; });
      if (cached) { event.waitUntil(network.catch(() => {})); return cached; }
      return network;
    })());
  }
});

self.addEventListener('push', event => {
  let data = { title: 'CampusDrop 校园快递', body: '你有一条新的配送消息', url: '/messages', tag: 'campusdrop' };
  try { data = { ...data, ...event.data.json() }; } catch { /* keep the default text */ }
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, tag: data.tag, renotify: true, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: data.url },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = typeof event.notification.data?.url === 'string' && /^\/(?![/\\])/.test(event.notification.data.url) ? event.notification.data.url : '/';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find(w => new URL(w.url).origin === self.location.origin);
    if (open) { await open.focus(); open.postMessage({ type: 'campusdrop:navigate', url: target }); return; }
    // The app may use hash routing (static hosting), so let it route the deep link itself.
    await self.clients.openWindow(`/?go=${encodeURIComponent(target)}`);
  })());
});
