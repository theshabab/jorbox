export async function api(path, data) {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...(data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  });
  if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error('Backend unavailable. Start the Cloudflare Worker to use this app.');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}

export const DataManager = {
  fetchGames: (removed = false) => api(`/games${removed ? '?removed=true' : ''}`),
  manageGame: (action, game) => api('/games/manage', { action, ...game }),
  copyCards: (id, data) => api(`/games/${encodeURIComponent(id)}/cards/copy`, data),
  fetchCategories: id => api(`/games/${encodeURIComponent(id)}/categories`),
  renameCategory: (id, data) => api(`/games/${encodeURIComponent(id)}/categories`, data),
  fetchActivity: (game = '', before = null) => api(`/admin/activity?${new URLSearchParams({ ...(game ? { game } : {}), ...(before ? { before } : {}) })}`),
  fetchFeedbackOverview: (game = '') => api(`/admin/feedback?${new URLSearchParams(game ? { game } : {})}`),
  fetchSession: () => api('/session'),
  fetchGameData: (id, removed = false) => api(`/games/${encodeURIComponent(id)}/cards${removed ? '?removed=true' : ''}`),
  vote: (id, value) => api(`/cards/${encodeURIComponent(id)}/vote`, { value }),
  bulk: (id, action, cards, value) => api(`/games/${encodeURIComponent(id)}/cards/bulk`, { action, cards, ...(value === undefined ? {} : { value }) }),
  logout: () => api('/auth/logout', {}),
};
