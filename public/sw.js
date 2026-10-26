// Offline support. Bump CACHE when the caching rules change.
const CACHE = 'jorbox-v2';
// Every page is the same single-page app shell.
const SHELL = '/';

// Save the app shell and the script and style files it references, so the app
// starts offline even when the first visit loaded them before this worker ran.
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const response = await fetch(SHELL, { cache: 'no-cache' });
      if (!response.ok) return;
      await cache.put(SHELL, response.clone());
      const html = await response.text();
      const assets = [
        ...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g),
      ].map((match) => match[1]);
      await cache.addAll(assets);
    })(),
  );
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
  // Only app pages are the shell. Opening an API address in a tab (for example
  // an administrator report) must never be saved as the home page.
  if (request.mode === 'navigate' && !url.pathname.startsWith('/api/'))
    event.respondWith(networkFirst(request, SHELL, isPage));
  else if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/')
  )
    event.respondWith(cacheFirst(request));
  else if (playerData(url)) event.respondWith(networkFirst(request));
});

const isPage = (response) =>
  response.headers.get('Content-Type')?.includes('text/html');
const storable = (response) =>
  response.ok && !/no-store/i.test(response.headers.get('Cache-Control') || '');

// Fresh content when online; the last saved copy when the network fails.
async function networkFirst(request, key = request, accept = () => true) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (storable(response) && accept(response))
      await cache.put(key, response.clone());
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
  if (storable(response)) await cache.put(request, response.clone());
  return response;
}
