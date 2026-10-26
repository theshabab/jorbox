// Offline support. Bump CACHE when the caching rules change.
const CACHE_PREFIX = 'jorbox-';
const CACHE = `${CACHE_PREFIX}v3`;
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
        if (key.startsWith(CACHE_PREFIX) && key !== CACHE)
          await caches.delete(key);
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
  else if (playerData(url))
    event.respondWith(networkFirst(request, request, isJson, offlineSnapshot));
});

const isPage = (response) =>
  response.headers.get('Content-Type')?.includes('text/html');
const isJson = (response) =>
  response.headers.get('Content-Type')?.includes('application/json');
const storable = (response) =>
  response.ok && !/no-store/i.test(response.headers.get('Cache-Control') || '');

// Keep only public player data on disk. An offline session never restores a
// previous person's account or administrator UI on a shared device.
async function offlineSnapshot(response, request) {
  const data = await response.json();
  const path = new URL(request.url).pathname;
  if (path === '/api/session') {
    data.user = null;
    data.githubEnabled = false;
    data.offline = true;
  } else if (path.endsWith('/cards')) {
    for (const card of data) card.myVote = 0;
  }
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-cache',
    },
  });
}

async function savedResponse(key) {
  try {
    const cache = await caches.open(CACHE);
    return await cache.match(key, { ignoreVary: true });
  } catch {
    // Browsers can disable storage or evict it. Online play still works.
    return undefined;
  }
}

// Fresh content when online; the last saved copy when the network fails.
// Cache failures must never turn a successful server response into a failure.
async function networkFirst(
  request,
  key = request,
  accept = () => true,
  snapshot = (response) => response,
) {
  let response;
  try {
    response = await fetch(request);
  } catch (error) {
    const saved = await savedResponse(key);
    if (saved) return saved;
    throw error;
  }
  try {
    const cache = await caches.open(CACHE);
    if (storable(response) && accept(response))
      await cache.put(key, await snapshot(response.clone(), request));
    // A deck removed on the server must not reappear on the next offline visit.
    else if ([404, 410].includes(response.status)) await cache.delete(key);
  } catch {
    // Offline support is optional when storage is unavailable or full.
  }
  return response;
}

// Built assets have content hashes in their names, so a saved copy never goes stale.
async function cacheFirst(request) {
  const saved = await savedResponse(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (storable(response)) {
    try {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    } catch {
      // Deliver the downloaded asset even when the cache is full.
    }
  }
  return response;
}
