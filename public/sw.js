// Offline support. Bump CACHE when the caching rules change.
const CACHE = 'jorbox-v1';
// Every page is the same single-page app shell.
const SHELL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

// Player data that is safe to keep on the device: the session summary, the
// game list and decks the player opened. Administrator data is never cached.
const playerData = (url) =>
  !url.search &&
  (/^\/api\/(session|games)$/.test(url.pathname) ||
    /^\/api\/games\/[^/]+\/cards$/.test(url.pathname));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate')
    event.respondWith(networkFirst(request, SHELL));
  else if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/')
  )
    event.respondWith(cacheFirst(request));
  else if (playerData(url)) event.respondWith(networkFirst(request));
});

// Fresh content when online; the last saved copy when the network fails.
async function networkFirst(request, key = request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(key, response.clone());
    return response;
  } catch (error) {
    // Responses vary by cookie, which a service worker cannot see; this device's
    // own saved copy is the right one.
    const saved = await cache.match(key, { ignoreVary: true });
    if (saved) return saved;
    throw error;
  }
}

// Built assets have content hashes in their names, so a saved copy never goes stale.
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}
