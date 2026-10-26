// URLs for each screen, so the browser Back button, reloads and shared links work:
// /, /play/:game, /cards, /cards/:game, /games, /reports, /suggestions
const VIEWS = ['play', 'cards', 'games', 'reports', 'suggestions'];
// Screens that do not belong to one game.
export const GAMELESS_VIEWS = ['games', 'reports', 'suggestions'];
const RETURN_KEY = 'jorbox:return';

const decode = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
};

export function parseRoute(pathname) {
  const [view = 'play', gameId = ''] = pathname
    .split('/')
    .filter(Boolean)
    .map(decode);
  if (!VIEWS.includes(view)) return { view: 'play', gameId: '' };
  return { view, gameId: ['play', 'cards'].includes(view) ? gameId : '' };
}

export function routePath(view, game) {
  if (GAMELESS_VIEWS.includes(view)) return `/${view}`;
  if (game) return `/${view}/${encodeURIComponent(game.id)}`;
  return view === 'play' ? '/' : '/cards';
}

// Sign-in always returns to the site root; remember where the player was.
export function rememberReturn() {
  try {
    sessionStorage.setItem(RETURN_KEY, location.pathname);
  } catch {
    // Without storage the player simply lands on the home screen.
  }
}

export function initialRoute() {
  let pathname = location.pathname;
  try {
    const stored = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    if (pathname === '/' && stored?.startsWith('/')) {
      pathname = stored;
      history.replaceState(null, '', stored);
    }
  } catch {
    // Ignore unavailable storage.
  }
  return parseRoute(pathname);
}
