// Registers the service worker and makes the current visit available offline.
// Requests made before the worker controls the page (always the case on a
// first visit) bypass it, so once it takes control, fetch the data the app
// needs to start again: this time the worker saves it.
const SESSION = '/api/session';
const GAMES = '/api/games';

function warmCache() {
  const urls = [SESSION, GAMES];
  const deck = location.pathname.match(/^\/(?:play|cards)\/([^/]+)/);
  if (deck) urls.push(`/api/games/${deck[1]}/cards`);
  return Promise.all(
    urls.map((url) =>
      fetch(url, { credentials: 'same-origin' }).catch(() => null),
    ),
  );
}

export function registerOfflineSupport() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    // Listen before registering so a quick activation is never missed.
    if (!navigator.serviceWorker.controller)
      navigator.serviceWorker.addEventListener('controllerchange', warmCache, {
        once: true,
      });
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
