// Remembers each game's shuffled order and the player's place in it for the
// browser tab, so a refresh or retry does not reshuffle and lose the position.
// Storage can be unavailable (private mode, blocked site data); play still works.
const key = (gameId) => `jorbox:deck:${gameId}`;

function read(gameId) {
  try {
    return JSON.parse(sessionStorage.getItem(key(gameId))) || null;
  } catch {
    return null;
  }
}

function write(gameId, value) {
  try {
    sessionStorage.setItem(key(gameId), JSON.stringify(value));
  } catch {
    // Ignore: the order simply will not survive a reload.
  }
}

export function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Keeps the stored order for cards that still exist and shuffles new cards in at the end.
export function deckOrder(gameId, cards, reshuffle = false) {
  const stored = reshuffle ? null : read(gameId);
  const ids = new Set(cards.map((card) => card.id));
  const kept = (stored?.order || []).filter((id) => ids.has(id));
  const known = new Set(kept);
  const order = [
    ...kept,
    ...shuffle(
      cards.filter((card) => !known.has(card.id)).map((card) => card.id),
    ),
  ];
  write(gameId, { order, positions: stored?.positions || {} });
  return order;
}

export function loadPosition(gameId, filter) {
  return read(gameId)?.positions?.[filter] || null;
}

export function savePosition(gameId, filter, cardId) {
  const stored = read(gameId);
  if (!stored) return;
  write(gameId, {
    ...stored,
    positions: { ...stored.positions, [filter]: cardId },
  });
}

// The last game played on this device, offered as "Continue" on the home screen.
const LAST_KEY = 'jorbox:last-game';
export function rememberLastGame(gameId) {
  try {
    localStorage.setItem(LAST_KEY, gameId);
  } catch {
    // Not remembered; the home screen just shows every game.
  }
}
export function lastGameId() {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}
