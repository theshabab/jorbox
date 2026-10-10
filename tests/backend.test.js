import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import worker from '../worker/index.js';

let mf, db;
const origin = 'http://localhost:8787';
const adminCookie = 'jb_session=admin-test-token';
const userCookie = 'jb_session=user-test-token';
const hash = async value => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('base64url');
const env = { ADMIN_GITHUB_IDS: '48080916', COOKIE_SECRET: 'a'.repeat(64), APP_ORIGIN: origin, GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'test-secret' };
async function request(path, { data, cookie, requestOrigin = origin, method, extraEnv = {} } = {}) {
  return worker.fetch(new Request(`${origin}/api${path}`, {
    method: method || (data === undefined ? 'GET' : 'POST'),
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data === undefined ? {} : { Origin: requestOrigin, 'Content-Type': 'application/json' }) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  }), { ...env, DB: db, ...extraEnv });
}
const bulk = (action, cards, options = {}) => request('/games/game1/cards/bulk', { data: { action, cards }, cookie: adminCookie, ...options });
before(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'test', modules: true, script: 'export default { fetch() { return new Response("ok") } }', d1Databases: ['DB'] }] }));
  db = await mf.getD1Database('DB');
  await db.exec(readFileSync('worker/migrations/0001_initial.sql', 'utf8').replace(/--[^\n]*/g, '').replaceAll('\n', ' '));
  await db.exec(readFileSync('worker/migrations/0002_game_management.sql', 'utf8').replace(/--[^\n]*/g, '').replaceAll('\n', ' '));
  await db.batch([
    db.prepare('INSERT INTO games (id,name,has_categories) VALUES (?,?,?)').bind('game1', 'Main', 1),
    db.prepare('INSERT INTO games (id,name,has_categories) VALUES (?,?,?)').bind('game2', 'Other', 0),
    db.prepare('INSERT INTO cards (id,game_id,name,description,category) VALUES (?,?,?,?,?)').bind('original', 'game1', 'Original', '', 'Cities'),
    db.prepare('INSERT INTO cards (id,game_id,name,description,category) VALUES (?,?,?,?,?)').bind('other', 'game2', '', 'Description only', ''),
    db.prepare('INSERT INTO sessions (token_hash,github_id,login,expires_at) VALUES (?,?,?,?)').bind(await hash('admin-test-token'), '48080916', 'thehaseebshah', 9999999999),
    db.prepare('INSERT INTO sessions (token_hash,github_id,login,expires_at) VALUES (?,?,?,?)').bind(await hash('user-test-token'), '1', 'ordinary-user', 9999999999),
  ]);
});
after(async () => { await mf?.dispose(); });

test('public decks preserve partial shapes and issue a persistent visitor cookie', async () => {
  const response = await request('/games/game2/cards');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.match(response.headers.get('Set-Cookie'), /HttpOnly; SameSite=Lax/);
  const [card] = await response.json();
  assert.equal(card.Name, ''); assert.equal(card.Description, 'Description only');
});

test('admin access fails closed for anonymous, ordinary, expired, and unconfigured accounts', async () => {
  const data = { action: 'import', cards: [{ Name: 'New', Category: 'Cities' }] };
  assert.equal((await request('/games/game1/cards/bulk', { data })).status, 401);
  assert.equal((await request('/games/game1/cards/bulk', { data, cookie: userCookie })).status, 403);
  assert.equal((await request('/games/game1/cards/bulk', { data, cookie: 'jb_session=invalid' })).status, 401);
  assert.equal((await request('/games/game1/cards/bulk', { data, cookie: adminCookie, extraEnv: { ADMIN_GITHUB_IDS: '' } })).status, 403);
  assert.equal((await request('/games/game1/cards?removed=true')).status, 403);
});

test('cross-origin writes and malformed bulk operations are rejected', async () => {
  assert.equal((await bulk('remove', [{ id: 'original', version: 1 }], { requestOrigin: 'https://attacker.test' })).status, 403);
  assert.equal((await bulk('import', [{ Name: '' }])).status, 400);
  assert.equal((await bulk('import', Array.from({ length: 101 }, () => ({ Name: 'Too many', Category: 'Cities' })))).status, 400);
  assert.equal((await bulk('remove', [{ id: 'original', version: 1 }, { id: 'original', version: 1 }])).status, 400);
});

test('feedback upserts one vote, changes sides, clears, and requires auth when configured', async () => {
  const identity = await request('/session');
  const cookie = identity.headers.get('Set-Cookie').split(';')[0];
  const vote = value => request('/cards/original/vote', { data: { value }, cookie });
  assert.deepEqual(await (await vote(1)).json(), { likes: 1, dislikes: 0, myVote: 1 });
  assert.deepEqual(await (await vote(1)).json(), { likes: 1, dislikes: 0, myVote: 1 });
  assert.deepEqual(await (await vote(-1)).json(), { likes: 0, dislikes: 1, myVote: -1 });
  const [card] = await (await request('/games/game1/cards', { cookie })).json();
  assert.equal(card.myVote, -1);
  assert.deepEqual(await (await vote(0)).json(), { likes: 0, dislikes: 0, myVote: 0 });
  assert.equal((await request('/cards/original/vote', { data: { value: 1 }, extraEnv: { FEEDBACK_REQUIRE_LOGIN: 'true' } })).status, 401);
  assert.equal((await request('/cards/original/vote', { data: { value: 2 } })).status, 400);
});

test('imports, bulk edits, stale conflicts, and game boundaries are atomic and audited', async () => {
  const added = await bulk('import', [{ Name: 'First', Category: 'Cities' }, { Description: 'Second', Category: 'Questions' }]);
  assert.equal(added.status, 201);
  const { ids } = await added.json();
  const rows = ids.map(id => ({ id, version: 1, Name: 'Edited', Description: '', Category: 'New category' }));
  assert.equal((await bulk('edit', rows)).status, 200);
  const auditCount = (await db.prepare('SELECT COUNT(*) AS count FROM audit_log').first()).count;
  assert.equal((await bulk('edit', [{ ...rows[0], version: 2, Name: 'Must roll back' }, rows[1]])).status, 409);
  assert.equal((await db.prepare('SELECT name FROM cards WHERE id=?').bind(ids[0]).first()).name, 'Edited');
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM audit_log').first()).count, auditCount);
  assert.equal((await bulk('remove', [{ id: ids[0], version: 2 }, { id: 'other', version: 1 }])).status, 409);
  assert.equal((await db.prepare('SELECT deleted_at FROM cards WHERE id=?').bind(ids[0]).first()).deleted_at, null);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM write_guards').first()).count, 0);
});

test('soft removal hides cards, rejects votes, and restores cards with feedback', async () => {
  await request('/cards/original/vote', { data: { value: 1 }, cookie: userCookie });
  assert.equal((await bulk('remove', [{ id: 'original', version: 1 }])).status, 200);
  assert.ok(!(await (await request('/games/game1/cards')).json()).some(card => card.id === 'original'));
  assert.equal((await request('/cards/original/vote', { data: { value: -1 }, cookie: userCookie })).status, 404);
  const removed = await (await request('/games/game1/cards?removed=true', { cookie: adminCookie })).json();
  assert.equal(removed[0].version, 2);
  assert.equal((await bulk('restore', [{ id: 'original', version: 2 }])).status, 200);
  assert.equal((await db.prepare('SELECT value FROM votes WHERE card_id=?').bind('original').first()).value, 1);
});

test('GitHub OAuth uses PKCE, validates state, consumes it once, and pins admin identity', async () => {
  const start = await request('/auth/github');
  assert.equal(start.status, 302);
  const target = new URL(start.headers.get('Location'));
  assert.equal(target.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(target.searchParams.get('scope'), '');
  const state = target.searchParams.get('state');
  assert.equal((await request(`/auth/github/callback?state=${state}&code=test`)).status, 400);
  const originalFetch = globalThis.fetch;
  let exchange;
  globalThis.fetch = async (url, options) => {
    if (url === 'https://github.com/login/oauth/access_token') { exchange = JSON.parse(options.body); return Response.json({ access_token: 'github-test-token' }); }
    if (url === 'https://api.github.com/user') return Response.json({ id: 48080916, login: 'renamed-account' });
    throw new Error('Unexpected network request');
  };
  try {
    const response = await request(`/auth/github/callback?state=${state}&code=test`, { cookie: `jb_oauth=${state}` });
    assert.equal(response.status, 302);
    assert.equal(await hash(exchange.code_verifier), target.searchParams.get('code_challenge'));
    const newCookie = response.headers.getSetCookie().find(value => value.startsWith('jb_session=')).split(';')[0];
    const result = await (await request('/session', { cookie: newCookie })).json();
    assert.equal(result.user.isAdmin, true);
    assert.equal(result.user.login, 'renamed-account');
    assert.equal((await request(`/auth/github/callback?state=${state}&code=test`, { cookie: `jb_oauth=${state}` })).status, 400);
    assert.equal((await request('/auth/logout', { data: {}, cookie: newCookie })).status, 200);
    assert.equal((await (await request('/session', { cookie: newCookie })).json()).user, null);
  } finally { globalThis.fetch = originalFetch; }
});

test('per-IP feedback throttling works even when cookies are reset', async () => {
  await db.prepare("DELETE FROM rate_limits WHERE key LIKE 'vote:%'").run();
  for (let i = 0; i < 60; i++) assert.equal((await request('/cards/original/vote', { data: { value: 0 } })).status, 200);
  assert.equal((await request('/cards/original/vote', { data: { value: 0 } })).status, 429);
});

const gameWrite = (action, game, options = {}) => request('/games/manage', { data: { action, ...game }, cookie: adminCookie, ...options });
async function createGame(fields = {}) {
  const response = await gameWrite('create', { name: 'Test deck', hasCategories: false, cardFormat: 'flexible', ...fields });
  assert.equal(response.status, 201);
  const { id } = await response.json();
  return (await (await request('/games')).json()).find(game => game.id === id);
}
const gameBulk = (game, action, cards, value) => request(`/games/${game.id}/cards/bulk`, { cookie: adminCookie, data: { action, cards, ...(value === undefined ? {} : { value }) } });
const gameCards = async game => (await request(`/games/${game.id}/cards`, { cookie: adminCookie })).json();

test('game management requires admin, same-origin requests, valid fields, and a fresh game version', async () => {
  await db.prepare("DELETE FROM rate_limits WHERE key LIKE 'admin:%'").run();
  const fields = { name: 'Deck', hasCategories: false, cardFormat: 'name' };
  assert.equal((await gameWrite('create', fields, { cookie: undefined })).status, 401);
  assert.equal((await gameWrite('create', fields, { cookie: userCookie })).status, 403);
  assert.equal((await gameWrite('create', fields, { requestOrigin: 'https://attacker.test' })).status, 403);
  for (const invalid of [{ name: '' }, { name: 'x'.repeat(201) }, { cardFormat: 'arbitrary' }, { hasCategories: 'true' }]) {
    assert.equal((await gameWrite('create', { ...fields, ...invalid })).status, 400);
  }
  const game = await createGame(fields);
  assert.equal((await gameWrite('edit', { ...game, name: 'Renamed' })).status, 200);
  assert.equal((await gameWrite('remove', game)).status, 409);
  assert.equal((await db.prepare('SELECT name FROM games WHERE id=?').bind(game.id).first()).name, 'Renamed');
  assert.equal((await request('/games?removed=true')).status, 403);
});

test('game removal hides cards and blocks every vote while restoration preserves data and card trash', async () => {
  await db.prepare("DELETE FROM rate_limits WHERE key LIKE 'admin:%' OR key LIKE 'vote:%'").run();
  const game = await createGame();
  const added = await gameBulk(game, 'import', [{ Name: 'Keep' }, { Name: 'Trash' }]);
  const { ids } = await added.json();
  await request(`/cards/${ids[0]}/vote`, { data: { value: 1 }, cookie: userCookie });
  await gameBulk(game, 'remove', [{ id: ids[1], version: 1 }]);
  assert.equal((await gameWrite('remove', game)).status, 200);
  assert.ok(!(await (await request('/games')).json()).some(row => row.id === game.id));
  assert.equal((await request(`/games/${game.id}/cards`)).status, 404);
  assert.equal((await gameBulk(game, 'import', [{ Name: 'Hidden' }])).status, 404);
  for (const value of [1, -1, 0]) assert.equal((await request(`/cards/${ids[0]}/vote`, { data: { value }, cookie: userCookie })).status, 404);
  assert.equal((await db.prepare('SELECT value FROM votes WHERE card_id=?').bind(ids[0]).first()).value, 1);
  const removed = (await (await request('/games?removed=true', { cookie: adminCookie })).json()).find(row => row.id === game.id);
  assert.equal(removed.cardCount, 1);
  assert.equal((await gameWrite('restore', removed)).status, 200);
  const cards = await gameCards(game);
  assert.equal(cards.length, 1); assert.equal(cards[0].likes, 1);
  const trash = await (await request(`/games/${game.id}/cards?removed=true`, { cookie: adminCookie })).json();
  assert.equal(trash.length, 1); assert.equal(trash[0].id, ids[1]);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE game_id=? AND action LIKE 'game:%'").bind(game.id).first()).count, 3);
});

test('all formats are enforced on import and edit; incompatible changes include removed cards and roll back', async () => {
  await db.prepare("DELETE FROM rate_limits WHERE key LIKE 'admin:%'").run();
  for (const [cardFormat, valid, invalid] of [
    ['name', { Name: 'Name' }, { Name: 'Name', Description: 'Unexpected' }],
    ['description', { Description: 'Text' }, { Name: 'Unexpected', Description: 'Text' }],
    ['name-description', { Name: 'Name', Description: 'Text' }, { Name: 'Missing description' }],
  ]) {
    const game = await createGame({ cardFormat });
    assert.equal((await gameBulk(game, 'import', [invalid])).status, 400);
    const { ids } = await (await gameBulk(game, 'import', [valid])).json();
    assert.equal((await gameBulk(game, 'edit', [{ ...invalid, id: ids[0], version: 1 }])).status, 400);
  }
  const game = await createGame();
  const { ids } = await (await gameBulk(game, 'import', [{ Name: 'Name' }, { Description: 'Text' }])).json();
  await gameBulk(game, 'remove', [{ id: ids[1], version: 1 }]);
  const auditCount = (await db.prepare('SELECT COUNT(*) AS count FROM audit_log').first()).count;
  assert.equal((await gameWrite('edit', { ...game, cardFormat: 'name', name: 'Must roll back' })).status, 409);
  assert.equal((await db.prepare('SELECT name FROM games WHERE id=?').bind(game.id).first()).name, game.name);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM audit_log').first()).count, auditCount);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM write_guards').first()).count, 0);
});

test('enabling categories assigns a reviewed default atomically and advances card versions', async () => {
  await db.prepare("DELETE FROM rate_limits WHERE key LIKE 'admin:%'").run();
  const game = await createGame();
  const { ids } = await (await gameBulk(game, 'import', [{ Name: 'Active' }, { Name: 'Trash' }])).json();
  await gameBulk(game, 'remove', [{ id: ids[1], version: 1 }]);
  assert.equal((await gameWrite('edit', { ...game, hasCategories: true })).status, 409);
  assert.equal((await gameWrite('edit', { ...game, hasCategories: true, defaultCategory: 'General' })).status, 200);
  const { results } = await db.prepare('SELECT category,version FROM cards WHERE game_id=? ORDER BY version').bind(game.id).all();
  assert.deepEqual(results, [{ category: 'General', version: 2 }, { category: 'General', version: 3 }]);
  assert.equal((await gameBulk(game, 'edit', [{ id: ids[0], version: 1, Name: 'Stale', Category: 'General' }])).status, 409);
  assert.equal((await gameWrite('edit', { ...game, version: 2, hasCategories: false })).status, 409);
  assert.equal((await gameWrite('edit', { ...game, version: 2, hasCategories: false, clearCategories: true })).status, 200);
  const cleared = (await db.prepare('SELECT category,version FROM cards WHERE game_id=? ORDER BY version').bind(game.id).all()).results;
  assert.deepEqual(cleared, [{ category: '', version: 3 }, { category: '', version: 4 }]);
  const audit = await db.prepare("SELECT details FROM audit_log WHERE game_id=? AND action='game:edit' ORDER BY rowid DESC LIMIT 1").bind(game.id).first();
  assert.equal(JSON.parse(audit.details).clearCategories, true);
});

test('bulk feedback changes only the admin vote, supports mixed CSV values, and rejects a whole stale batch', async () => {
  await db.prepare("DELETE FROM rate_limits WHERE key LIKE 'admin:%' OR key LIKE 'vote:%'").run();
  const game = await createGame();
  const { ids } = await (await gameBulk(game, 'import', [{ Name: 'One' }, { Name: 'Two' }])).json();
  const rows = ids.map(id => ({ id, version: 1 }));
  await request(`/cards/${ids[0]}/vote`, { data: { value: 1 }, cookie: userCookie });
  assert.equal((await gameBulk(game, 'feedback', rows, -1)).status, 200);
  let cards = await gameCards(game);
  assert.equal(cards[0].likes, 1); assert.equal(cards[0].dislikes, 1); assert.equal(cards[0].myVote, -1);
  assert.equal((await gameBulk(game, 'feedback', rows.map((row, index) => ({ ...row, value: index === 0 ? 0 : 1 })))).status, 200);
  cards = await gameCards(game);
  assert.equal(cards[0].likes, 1); assert.equal(cards[0].dislikes, 0); assert.equal(cards[1].myVote, 1);
  assert.equal((await gameBulk(game, 'feedback', rows, 2)).status, 400);
  assert.equal((await gameBulk(game, 'feedback', rows.map(row => ({ ...row, value: '1' })))).status, 400);
  assert.equal((await request(`/games/${game.id}/cards/bulk`, { cookie: userCookie, data: { action: 'feedback', cards: rows, value: 1 } })).status, 403);
  const auditCount = (await db.prepare('SELECT COUNT(*) AS count FROM audit_log').first()).count;
  assert.equal((await gameBulk(game, 'feedback', [rows[0], { ...rows[1], version: 99 }], -1)).status, 409);
  assert.equal((await gameCards(game))[0].myVote, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM audit_log').first()).count, auditCount);
  assert.equal((await gameBulk(game, 'feedback', [rows[0], { id: 'other', version: 1 }], -1)).status, 409);
  await gameBulk(game, 'remove', [rows[0]]);
  assert.equal((await gameBulk(game, 'feedback', [{ ...rows[0], version: 2 }], 1)).status, 409);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM write_guards').first()).count, 0);
});

test('a concurrent game change aborts card imports without partial writes', async () => {
  await db.prepare("DELETE FROM rate_limits WHERE key LIKE 'admin:%'").run();
  const game = await createGame();
  let raced = false;
  const racingDB = {
    prepare: sql => db.prepare(sql),
    batch: async statements => {
      if (!raced) {
        raced = true;
        await db.prepare('UPDATE games SET deleted_at=unixepoch(),version=version+1 WHERE id=?').bind(game.id).run();
      }
      return db.batch(statements);
    },
  };
  const response = await request(`/games/${game.id}/cards/bulk`, { cookie: adminCookie, data: { action: 'import', cards: [{ Name: 'Race' }] }, extraEnv: { DB: racingDB } });
  assert.equal(response.status, 409);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM cards WHERE game_id=?').bind(game.id).first()).count, 0);
});
