import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(
  new URL('../public/sw.js', import.meta.url),
  'utf8',
);
const origin = 'https://jorbox.test';

function serviceWorker({ fetch, storageUnavailable = false } = {}) {
  const handlers = {};
  const buckets = new Map();
  const key = (request) =>
    new URL(typeof request === 'string' ? request : request.url, origin).href;
  const caches = {
    async open(name) {
      if (storageUnavailable) throw new Error('Storage unavailable');
      if (!buckets.has(name)) buckets.set(name, new Map());
      const data = buckets.get(name);
      return {
        async match(request) {
          return data.get(key(request))?.clone();
        },
        async put(request, response) {
          data.set(key(request), response.clone());
        },
        async delete(request) {
          return data.delete(key(request));
        },
      };
    },
    async keys() {
      return [...buckets.keys()];
    },
    async delete(name) {
      return buckets.delete(name);
    },
  };
  runInNewContext(source, {
    Response,
    URL,
    caches,
    fetch,
    self: {
      location: { origin },
      addEventListener: (type, listener) => (handlers[type] = listener),
      clients: { claim: async () => {} },
      skipWaiting() {},
    },
  });
  return {
    caches,
    async activate() {
      let done;
      handlers.activate({ waitUntil: (promise) => (done = promise) });
      await done;
    },
    async request(path) {
      let response;
      handlers.fetch({
        request: new Request(new URL(path, origin)),
        respondWith: (promise) => (response = promise),
      });
      return response;
    },
    async saved(path) {
      return (await caches.open('jorbox-v3')).match(path);
    },
  };
}
const json = (value, init = {}) =>
  new Response(JSON.stringify(value), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-cache',
      ...init.headers,
    },
  });

test('offline snapshots keep decks playable without saving the previous account or vote', async () => {
  let offline = false;
  const user = { login: 'administrator', isAdmin: true, id: '123' };
  const worker = serviceWorker({
    fetch: async (request) => {
      if (offline) throw new TypeError('Network unavailable');
      return request.url.endsWith('/session')
        ? json({ user, feedbackEnabled: true, githubEnabled: true })
        : json([{ id: 'card', Name: 'Card', myVote: -1, likes: 3 }]);
    },
  });
  const session = await (await worker.request('/api/session')).json();
  assert.deepEqual(
    session.user,
    user,
    'online response keeps current identity',
  );
  const cards = await (await worker.request('/api/games/demo/cards')).json();
  assert.equal(cards[0].myVote, -1, 'online response keeps current feedback');
  offline = true;
  const savedSession = await (await worker.request('/api/session')).json();
  assert.equal(savedSession.user, null);
  assert.equal(savedSession.githubEnabled, false);
  assert.equal(savedSession.offline, true);
  const savedCards = await (
    await worker.request('/api/games/demo/cards')
  ).json();
  assert.equal(savedCards[0].myVote, 0);
  assert.equal(savedCards[0].Name, 'Card');
  assert.equal(savedCards[0].likes, 3);
});

test('unavailable cache storage never blocks successful API or asset responses', async () => {
  const worker = serviceWorker({
    storageUnavailable: true,
    fetch: async () => json({ fresh: true }),
  });
  for (const path of ['/api/games', '/assets/app-hash.js'])
    assert.deepEqual(await (await worker.request(path)).json(), {
      fresh: true,
    });
});

test('successful network responses survive a full cache', async () => {
  const worker = serviceWorker({ fetch: async () => json({ fresh: true }) });
  worker.caches.open = async () => ({
    match: async () => undefined,
    put: async () => {
      throw new Error('Quota exceeded');
    },
  });
  for (const path of ['/api/games', '/assets/app-hash.js'])
    assert.deepEqual(await (await worker.request(path)).json(), {
      fresh: true,
    });
});

test('removed decks are evicted and no-store or unexpected responses are not cached', async () => {
  let response = json([{ id: 'card', myVote: 0 }]);
  const worker = serviceWorker({ fetch: async () => response.clone() });
  const path = '/api/games/demo/cards';
  await worker.request(path);
  assert.ok(await worker.saved(path));
  response = json({ error: 'Removed' }, { status: 404 });
  await worker.request(path);
  assert.equal(await worker.saved(path), undefined);
  response = json([], { headers: { 'Cache-Control': 'no-store' } });
  await worker.request(path);
  assert.equal(await worker.saved(path), undefined);
  response = new Response('<html>Unavailable</html>', {
    headers: { 'Content-Type': 'text/html' },
  });
  await worker.request(path);
  assert.equal(await worker.saved(path), undefined);
});

test('activation removes only old JorBox caches and admin endpoints stay uncached', async () => {
  const worker = serviceWorker({ fetch: async () => json({ private: true }) });
  for (const name of ['jorbox-v2', 'jorbox-v3', 'another-app'])
    await worker.caches.open(name);
  await worker.activate();
  assert.deepEqual(await worker.caches.keys(), ['jorbox-v3', 'another-app']);
  for (const path of [
    '/api/admin/suggestions',
    '/api/games?removed=true',
    '/api/games/demo/cards?removed=true',
  ])
    assert.equal(await worker.request(path), undefined);
});
