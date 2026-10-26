import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import worker from '../worker/index.js';

let mf, db;
const origin = 'http://localhost:8787';
const adminCookie = 'jb_session=admin-test-token';
const userCookie = 'jb_session=user-test-token';
const hash = async (value) =>
  Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  ).toString('base64url');
const env = {
  ADMIN_GITHUB_IDS: '48080916',
  COOKIE_SECRET: 'a'.repeat(64),
  APP_ORIGIN: origin,
  GITHUB_CLIENT_ID: 'test-client',
  GITHUB_CLIENT_SECRET: 'test-secret',
};
async function request(
  path,
  { data, cookie, requestOrigin = origin, method, extraEnv = {} } = {},
) {
  return worker.fetch(
    new Request(`${origin}/api${path}`, {
      method: method || (data === undefined ? 'GET' : 'POST'),
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(data === undefined
          ? {}
          : { Origin: requestOrigin, 'Content-Type': 'application/json' }),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    }),
    { ...env, DB: db, ...extraEnv },
  );
}
const bulk = (action, cards, options = {}) =>
  request('/games/game1/cards/bulk', {
    data: { action, cards },
    cookie: adminCookie,
    ...options,
  });
before(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'test',
          modules: true,
          script: 'export default { fetch() { return new Response("ok") } }',
          d1Databases: ['DB'],
        },
      ],
    }),
  );
  db = await mf.getD1Database('DB');
  for (const file of readdirSync('worker/migrations').sort())
    await db.exec(
      readFileSync(`worker/migrations/${file}`, 'utf8')
        .replace(/--[^\n]*/g, '')
        .replaceAll('\n', ' '),
    );
  await db.batch([
    db
      .prepare('INSERT INTO games (id,name,has_categories) VALUES (?,?,?)')
      .bind('game1', 'Main', 1),
    db
      .prepare('INSERT INTO games (id,name,has_categories) VALUES (?,?,?)')
      .bind('game2', 'Other', 0),
    db
      .prepare(
        'INSERT INTO cards (id,game_id,name,description,category) VALUES (?,?,?,?,?)',
      )
      .bind('original', 'game1', 'Original', '', 'Cities'),
    db
      .prepare(
        'INSERT INTO cards (id,game_id,name,description,category) VALUES (?,?,?,?,?)',
      )
      .bind('other', 'game2', '', 'Description only', ''),
    db
      .prepare(
        'INSERT INTO sessions (token_hash,github_id,login,expires_at) VALUES (?,?,?,?)',
      )
      .bind(
        await hash('admin-test-token'),
        '48080916',
        'thehaseebshah',
        9999999999,
      ),
    db
      .prepare(
        'INSERT INTO sessions (token_hash,github_id,login,expires_at) VALUES (?,?,?,?)',
      )
      .bind(await hash('user-test-token'), '1', 'ordinary-user', 9999999999),
  ]);
});
after(async () => {
  await mf?.dispose();
});

test('public decks preserve partial shapes; only the session call issues a visitor cookie', async () => {
  const response = await request('/games/game2/cards');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-cache');
  // Card reads never mint identities, so cookie-blocking browsers cannot use up a network's budget.
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.match(
    (await request('/session')).headers.get('Set-Cookie'),
    /HttpOnly; SameSite=Lax/,
  );
  const [card] = await response.json();
  assert.equal(card.Name, '');
  assert.equal(card.Description, 'Description only');
});

test('admin access fails closed for anonymous, ordinary, expired, and unconfigured accounts', async () => {
  const data = {
    action: 'import',
    cards: [{ Name: 'New', Category: 'Cities' }],
  };
  assert.equal(
    (await request('/games/game1/cards/bulk', { data })).status,
    401,
  );
  assert.equal(
    (await request('/games/game1/cards/bulk', { data, cookie: userCookie }))
      .status,
    403,
  );
  assert.equal(
    (
      await request('/games/game1/cards/bulk', {
        data,
        cookie: 'jb_session=invalid',
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request('/games/game1/cards/bulk', {
        data,
        cookie: adminCookie,
        extraEnv: { ADMIN_GITHUB_IDS: '' },
      })
    ).status,
    403,
  );
  assert.equal((await request('/games/game1/cards?removed=true')).status, 403);
});

test('cross-origin writes and malformed bulk operations are rejected', async () => {
  assert.equal(
    (
      await bulk('remove', [{ id: 'original', version: 1 }], {
        requestOrigin: 'https://attacker.test',
      })
    ).status,
    403,
  );
  assert.equal((await bulk('import', [{ Name: '' }])).status, 400);
  assert.equal(
    (
      await bulk(
        'import',
        Array.from({ length: 101 }, () => ({
          Name: 'Too many',
          Category: 'Cities',
        })),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await bulk('remove', [
        { id: 'original', version: 1 },
        { id: 'original', version: 1 },
      ])
    ).status,
    400,
  );
});

test('feedback upserts one vote, changes sides, clears, and requires auth when configured', async () => {
  const identity = await request('/session');
  const cookie = identity.headers.get('Set-Cookie').split(';')[0];
  const vote = (value) =>
    request('/cards/original/vote', { data: { value }, cookie });
  assert.deepEqual(await (await vote(1)).json(), {
    likes: 1,
    dislikes: 0,
    myVote: 1,
  });
  assert.deepEqual(await (await vote(1)).json(), {
    likes: 1,
    dislikes: 0,
    myVote: 1,
  });
  assert.deepEqual(await (await vote(-1)).json(), {
    likes: 0,
    dislikes: 1,
    myVote: -1,
  });
  const [card] = await (await request('/games/game1/cards', { cookie })).json();
  assert.equal(card.myVote, -1);
  assert.deepEqual(await (await vote(0)).json(), {
    likes: 0,
    dislikes: 0,
    myVote: 0,
  });
  assert.equal(
    (
      await request('/cards/original/vote', {
        data: { value: 1 },
        extraEnv: { FEEDBACK_REQUIRE_LOGIN: 'true' },
      })
    ).status,
    401,
  );
  assert.equal(
    (await request('/cards/original/vote', { data: { value: 2 } })).status,
    400,
  );
});

test('imports, bulk edits, stale conflicts, and game boundaries are atomic and audited', async () => {
  const added = await bulk('import', [
    { Name: 'First', Category: 'Cities' },
    { Description: 'Second', Category: 'Questions' },
  ]);
  assert.equal(added.status, 201);
  const { ids } = await added.json();
  const rows = ids.map((id) => ({
    id,
    version: 1,
    Name: 'Edited',
    Description: '',
    Category: 'New category',
  }));
  assert.equal((await bulk('edit', rows)).status, 200);
  const auditCount = (
    await db.prepare('SELECT COUNT(*) AS count FROM audit_log').first()
  ).count;
  assert.equal(
    (
      await bulk('edit', [
        { ...rows[0], version: 2, Name: 'Must roll back' },
        rows[1],
      ])
    ).status,
    409,
  );
  assert.equal(
    (await db.prepare('SELECT name FROM cards WHERE id=?').bind(ids[0]).first())
      .name,
    'Edited',
  );
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS count FROM audit_log').first()).count,
    auditCount,
  );
  assert.equal(
    (
      await bulk('remove', [
        { id: ids[0], version: 2 },
        { id: 'other', version: 1 },
      ])
    ).status,
    409,
  );
  assert.equal(
    (
      await db
        .prepare('SELECT deleted_at FROM cards WHERE id=?')
        .bind(ids[0])
        .first()
    ).deleted_at,
    null,
  );
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS count FROM write_guards').first())
      .count,
    0,
  );
});

test('soft removal hides cards, rejects votes, and restores cards with feedback', async () => {
  await request('/cards/original/vote', {
    data: { value: 1 },
    cookie: userCookie,
  });
  assert.equal(
    (await bulk('remove', [{ id: 'original', version: 1 }])).status,
    200,
  );
  assert.ok(
    !(await (await request('/games/game1/cards')).json()).some(
      (card) => card.id === 'original',
    ),
  );
  assert.equal(
    (
      await request('/cards/original/vote', {
        data: { value: -1 },
        cookie: userCookie,
      })
    ).status,
    404,
  );
  const removed = await (
    await request('/games/game1/cards?removed=true', { cookie: adminCookie })
  ).json();
  assert.equal(removed[0].version, 2);
  assert.equal(
    (await bulk('restore', [{ id: 'original', version: 2 }])).status,
    200,
  );
  assert.equal(
    (
      await db
        .prepare('SELECT value FROM votes WHERE card_id=?')
        .bind('original')
        .first()
    ).value,
    1,
  );
});

test('GitHub OAuth uses PKCE, validates state, consumes it once, and pins admin identity', async () => {
  const start = await request('/auth/github');
  assert.equal(start.status, 302);
  const target = new URL(start.headers.get('Location'));
  assert.equal(target.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(target.searchParams.get('scope'), '');
  const state = target.searchParams.get('state');
  assert.equal(
    (await request(`/auth/github/callback?state=${state}&code=test`)).status,
    400,
  );
  const originalFetch = globalThis.fetch;
  let exchange;
  globalThis.fetch = async (url, options) => {
    if (url === 'https://github.com/login/oauth/access_token') {
      exchange = JSON.parse(options.body);
      return Response.json({ access_token: 'github-test-token' });
    }
    if (url === 'https://api.github.com/user')
      return Response.json({ id: 48080916, login: 'renamed-account' });
    throw new Error('Unexpected network request');
  };
  try {
    const response = await request(
      `/auth/github/callback?state=${state}&code=test`,
      { cookie: `jb_oauth=${state}` },
    );
    assert.equal(response.status, 302);
    assert.equal(
      await hash(exchange.code_verifier),
      target.searchParams.get('code_challenge'),
    );
    const newCookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith('jb_session='))
      .split(';')[0];
    const result = await (
      await request('/session', { cookie: newCookie })
    ).json();
    assert.equal(result.user.isAdmin, true);
    assert.equal(result.user.login, 'renamed-account');
    assert.equal(
      (
        await request(`/auth/github/callback?state=${state}&code=test`, {
          cookie: `jb_oauth=${state}`,
        })
      ).status,
      400,
    );
    assert.equal(
      (await request('/auth/logout', { data: {}, cookie: newCookie })).status,
      200,
    );
    assert.equal(
      (await (await request('/session', { cookie: newCookie })).json()).user,
      null,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('per-IP feedback throttling works even when cookies are reset and renews next minute', async (t) => {
  // Keep the requests in one bucket even if CI runs across a minute boundary.
  let clock = Math.floor(Date.now() / 60000) * 60000;
  t.mock.method(Date, 'now', () => clock);
  await db
    .prepare(
      "DELETE FROM rate_limits WHERE key LIKE 'vote:%' OR key LIKE 'visitor:%'",
    )
    .run();
  const freshVisitor = async () =>
    (await request('/session')).headers.get('Set-Cookie').split(';')[0];
  for (let i = 0; i < 60; i++) {
    // Clearing cookies between votes gives a new identity, but not a new budget.
    const cookie = i % 3 === 0 ? await freshVisitor() : undefined;
    if (cookie)
      assert.equal(
        (await request('/cards/original/vote', { data: { value: 0 }, cookie }))
          .status,
        200,
      );
    else
      assert.equal(
        (
          await request('/cards/original/vote', {
            data: { value: 0 },
            cookie: userCookie,
          })
        ).status,
        200,
      );
  }
  assert.equal(
    (
      await request('/cards/original/vote', {
        data: { value: 0 },
        cookie: userCookie,
      })
    ).status,
    429,
  );
  clock += 60000;
  assert.equal(
    (
      await request('/cards/original/vote', {
        data: { value: 0 },
        cookie: userCookie,
      })
    ).status,
    200,
  );
});

const gameWrite = (action, game, options = {}) =>
  request('/games/manage', {
    data: { action, ...game },
    cookie: adminCookie,
    ...options,
  });
async function createGame(fields = {}) {
  const response = await gameWrite('create', {
    name: 'Test deck',
    hasCategories: false,
    cardFormat: 'flexible',
    ...fields,
  });
  assert.equal(response.status, 201);
  const { id } = await response.json();
  return (await (await request('/games')).json()).find(
    (game) => game.id === id,
  );
}
const gameBulk = (game, action, cards, value) =>
  request(`/games/${game.id}/cards/bulk`, {
    cookie: adminCookie,
    data: { action, cards, ...(value === undefined ? {} : { value }) },
  });
const gameCards = async (game) =>
  (await request(`/games/${game.id}/cards`, { cookie: adminCookie })).json();

test('game management requires admin, same-origin requests, valid fields, and a fresh game version', async () => {
  await db.prepare("DELETE FROM rate_limits WHERE key LIKE 'admin:%'").run();
  const fields = { name: 'Deck', hasCategories: false, cardFormat: 'name' };
  assert.equal(
    (await gameWrite('create', fields, { cookie: undefined })).status,
    401,
  );
  assert.equal(
    (await gameWrite('create', fields, { cookie: userCookie })).status,
    403,
  );
  assert.equal(
    (
      await gameWrite('create', fields, {
        requestOrigin: 'https://attacker.test',
      })
    ).status,
    403,
  );
  for (const invalid of [
    { name: '' },
    { name: 'x'.repeat(201) },
    { cardFormat: 'arbitrary' },
    { hasCategories: 'true' },
  ]) {
    assert.equal(
      (await gameWrite('create', { ...fields, ...invalid })).status,
      400,
    );
  }
  const game = await createGame(fields);
  assert.equal(
    (await gameWrite('edit', { ...game, name: 'Renamed' })).status,
    200,
  );
  assert.equal((await gameWrite('remove', game)).status, 409);
  assert.equal(
    (
      await db
        .prepare('SELECT name FROM games WHERE id=?')
        .bind(game.id)
        .first()
    ).name,
    'Renamed',
  );
  assert.equal((await request('/games?removed=true')).status, 403);
});

test('game removal hides cards and blocks every vote while restoration preserves data and card trash', async () => {
  await db
    .prepare(
      "DELETE FROM rate_limits WHERE key LIKE 'admin:%' OR key LIKE 'vote:%'",
    )
    .run();
  const game = await createGame();
  const added = await gameBulk(game, 'import', [
    { Name: 'Keep' },
    { Name: 'Trash' },
  ]);
  const { ids } = await added.json();
  await request(`/cards/${ids[0]}/vote`, {
    data: { value: 1 },
    cookie: userCookie,
  });
  await gameBulk(game, 'remove', [{ id: ids[1], version: 1 }]);
  assert.equal((await gameWrite('remove', game)).status, 200);
  assert.ok(
    !(await (await request('/games')).json()).some((row) => row.id === game.id),
  );
  assert.equal((await request(`/games/${game.id}/cards`)).status, 404);
  assert.equal(
    (await gameBulk(game, 'import', [{ Name: 'Hidden' }])).status,
    404,
  );
  for (const value of [1, -1, 0])
    assert.equal(
      (
        await request(`/cards/${ids[0]}/vote`, {
          data: { value },
          cookie: userCookie,
        })
      ).status,
      404,
    );
  assert.equal(
    (
      await db
        .prepare('SELECT value FROM votes WHERE card_id=?')
        .bind(ids[0])
        .first()
    ).value,
    1,
  );
  const removed = (
    await (await request('/games?removed=true', { cookie: adminCookie })).json()
  ).find((row) => row.id === game.id);
  assert.equal(removed.cardCount, 1);
  assert.equal((await gameWrite('restore', removed)).status, 200);
  const cards = await gameCards(game);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].likes, 1);
  const trash = await (
    await request(`/games/${game.id}/cards?removed=true`, {
      cookie: adminCookie,
    })
  ).json();
  assert.equal(trash.length, 1);
  assert.equal(trash[0].id, ids[1]);
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS count FROM audit_log WHERE game_id=? AND action LIKE 'game:%'",
        )
        .bind(game.id)
        .first()
    ).count,
    3,
  );
});

test('all formats are enforced on import and edit; incompatible changes include removed cards and roll back', async () => {
  await db.prepare("DELETE FROM rate_limits WHERE key LIKE 'admin:%'").run();
  for (const [cardFormat, valid, invalid] of [
    ['name', { Name: 'Name' }, { Name: 'Name', Description: 'Unexpected' }],
    [
      'description',
      { Description: 'Text' },
      { Name: 'Unexpected', Description: 'Text' },
    ],
    [
      'name-description',
      { Name: 'Name', Description: 'Text' },
      { Name: 'Missing description' },
    ],
  ]) {
    const game = await createGame({ cardFormat });
    assert.equal((await gameBulk(game, 'import', [invalid])).status, 400);
    const { ids } = await (await gameBulk(game, 'import', [valid])).json();
    assert.equal(
      (await gameBulk(game, 'edit', [{ ...invalid, id: ids[0], version: 1 }]))
        .status,
      400,
    );
  }
  const game = await createGame();
  const { ids } = await (
    await gameBulk(game, 'import', [{ Name: 'Name' }, { Description: 'Text' }])
  ).json();
  await gameBulk(game, 'remove', [{ id: ids[1], version: 1 }]);
  const auditCount = (
    await db.prepare('SELECT COUNT(*) AS count FROM audit_log').first()
  ).count;
  assert.equal(
    (
      await gameWrite('edit', {
        ...game,
        cardFormat: 'name',
        name: 'Must roll back',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await db
        .prepare('SELECT name FROM games WHERE id=?')
        .bind(game.id)
        .first()
    ).name,
    game.name,
  );
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS count FROM audit_log').first()).count,
    auditCount,
  );
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS count FROM write_guards').first())
      .count,
    0,
  );
});

test('enabling categories assigns a reviewed default atomically and advances card versions', async () => {
  await db.prepare("DELETE FROM rate_limits WHERE key LIKE 'admin:%'").run();
  const game = await createGame();
  const { ids } = await (
    await gameBulk(game, 'import', [{ Name: 'Active' }, { Name: 'Trash' }])
  ).json();
  await gameBulk(game, 'remove', [{ id: ids[1], version: 1 }]);
  assert.equal(
    (await gameWrite('edit', { ...game, hasCategories: true })).status,
    409,
  );
  assert.equal(
    (
      await gameWrite('edit', {
        ...game,
        hasCategories: true,
        defaultCategory: 'General',
      })
    ).status,
    200,
  );
  const { results } = await db
    .prepare(
      'SELECT category,version FROM cards WHERE game_id=? ORDER BY version',
    )
    .bind(game.id)
    .all();
  assert.deepEqual(results, [
    { category: 'General', version: 2 },
    { category: 'General', version: 3 },
  ]);
  assert.equal(
    (
      await gameBulk(game, 'edit', [
        { id: ids[0], version: 1, Name: 'Stale', Category: 'General' },
      ])
    ).status,
    409,
  );
  assert.equal(
    (await gameWrite('edit', { ...game, version: 2, hasCategories: false }))
      .status,
    409,
  );
  assert.equal(
    (
      await gameWrite('edit', {
        ...game,
        version: 2,
        hasCategories: false,
        clearCategories: true,
      })
    ).status,
    200,
  );
  const cleared = (
    await db
      .prepare(
        'SELECT category,version FROM cards WHERE game_id=? ORDER BY version',
      )
      .bind(game.id)
      .all()
  ).results;
  assert.deepEqual(cleared, [
    { category: '', version: 3 },
    { category: '', version: 4 },
  ]);
  const audit = await db
    .prepare(
      "SELECT details FROM audit_log WHERE game_id=? AND action='game:edit' ORDER BY rowid DESC LIMIT 1",
    )
    .bind(game.id)
    .first();
  assert.equal(JSON.parse(audit.details).clearCategories, true);
});

test('bulk feedback changes only the admin vote, supports mixed CSV values, and rejects a whole stale batch', async () => {
  await db
    .prepare(
      "DELETE FROM rate_limits WHERE key LIKE 'admin:%' OR key LIKE 'vote:%'",
    )
    .run();
  const game = await createGame();
  const { ids } = await (
    await gameBulk(game, 'import', [{ Name: 'One' }, { Name: 'Two' }])
  ).json();
  const rows = ids.map((id) => ({ id, version: 1 }));
  await request(`/cards/${ids[0]}/vote`, {
    data: { value: 1 },
    cookie: userCookie,
  });
  assert.equal((await gameBulk(game, 'feedback', rows, -1)).status, 200);
  let cards = await gameCards(game);
  assert.equal(cards[0].likes, 1);
  assert.equal(cards[0].dislikes, 1);
  assert.equal(cards[0].myVote, -1);
  assert.equal(
    (
      await gameBulk(
        game,
        'feedback',
        rows.map((row, index) => ({ ...row, value: index === 0 ? 0 : 1 })),
      )
    ).status,
    200,
  );
  cards = await gameCards(game);
  assert.equal(cards[0].likes, 1);
  assert.equal(cards[0].dislikes, 0);
  assert.equal(cards[1].myVote, 1);
  assert.equal((await gameBulk(game, 'feedback', rows, 2)).status, 400);
  assert.equal(
    (
      await gameBulk(
        game,
        'feedback',
        rows.map((row) => ({ ...row, value: '1' })),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(`/games/${game.id}/cards/bulk`, {
        cookie: userCookie,
        data: { action: 'feedback', cards: rows, value: 1 },
      })
    ).status,
    403,
  );
  const auditCount = (
    await db.prepare('SELECT COUNT(*) AS count FROM audit_log').first()
  ).count;
  assert.equal(
    (
      await gameBulk(
        game,
        'feedback',
        [rows[0], { ...rows[1], version: 99 }],
        -1,
      )
    ).status,
    409,
  );
  assert.equal((await gameCards(game))[0].myVote, 0);
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS count FROM audit_log').first()).count,
    auditCount,
  );
  assert.equal(
    (
      await gameBulk(
        game,
        'feedback',
        [rows[0], { id: 'other', version: 1 }],
        -1,
      )
    ).status,
    409,
  );
  await gameBulk(game, 'remove', [rows[0]]);
  assert.equal(
    (await gameBulk(game, 'feedback', [{ ...rows[0], version: 2 }], 1)).status,
    409,
  );
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS count FROM write_guards').first())
      .count,
    0,
  );
});

test('a concurrent game change aborts card imports without partial writes', async () => {
  await db.prepare("DELETE FROM rate_limits WHERE key LIKE 'admin:%'").run();
  const game = await createGame();
  let raced = false;
  const racingDB = {
    prepare: (sql) => db.prepare(sql),
    batch: async (statements) => {
      if (!raced) {
        raced = true;
        await db
          .prepare(
            'UPDATE games SET deleted_at=unixepoch(),version=version+1 WHERE id=?',
          )
          .bind(game.id)
          .run();
      }
      return db.batch(statements);
    },
  };
  const response = await request(`/games/${game.id}/cards/bulk`, {
    cookie: adminCookie,
    data: { action: 'import', cards: [{ Name: 'Race' }] },
    extraEnv: { DB: racingDB },
  });
  assert.equal(response.status, 409);
  assert.equal(
    (
      await db
        .prepare('SELECT COUNT(*) AS count FROM cards WHERE game_id=?')
        .bind(game.id)
        .first()
    ).count,
    0,
  );
});

test('new administrator reports, category tools, and copying reject non-admin and cross-origin access', async () => {
  await db.prepare("DELETE FROM rate_limits WHERE key LIKE 'admin:%'").run();
  for (const path of [
    '/admin/activity',
    '/admin/feedback',
    '/games/game1/categories',
  ]) {
    assert.equal((await request(path)).status, 401);
    assert.equal((await request(path, { cookie: userCookie })).status, 403);
  }
  for (const path of ['/games/game1/cards/copy', '/games/game1/categories']) {
    assert.equal((await request(path, { data: {} })).status, 401);
    assert.equal(
      (await request(path, { cookie: userCookie, data: {} })).status,
      403,
    );
    assert.equal(
      (
        await request(path, {
          cookie: adminCookie,
          data: {},
          requestOrigin: 'https://attacker.test',
        })
      ).status,
      403,
    );
  }
});

const copy = (source, target, cards, extra = {}) =>
  request(`/games/${source.id}/cards/copy`, {
    cookie: adminCookie,
    data: {
      sourceVersion: source.version,
      targetId: target.id,
      targetVersion: target.version,
      cards,
      ...extra,
    },
  });

test('copying cards gives new identities, preserves source votes, maps categories, and enforces formats and boundaries', async () => {
  await db
    .prepare(
      "DELETE FROM rate_limits WHERE key LIKE 'admin:%' OR key LIKE 'vote:%'",
    )
    .run();
  const source = await createGame();
  const target = await createGame({ hasCategories: true });
  const { ids } = await (
    await gameBulk(source, 'import', [
      { Name: 'Source', Description: 'Prompt' },
    ])
  ).json();
  const rows = [{ id: ids[0], version: 1 }];
  await request(`/cards/${ids[0]}/vote`, {
    cookie: userCookie,
    data: { value: 1 },
  });
  assert.equal((await copy(source, target, rows)).status, 400);
  const response = await copy(source, target, rows, { category: 'Imported' });
  assert.equal(response.status, 201);
  const copied = await response.json();
  assert.notEqual(copied.ids[0], ids[0]);
  const [card] = await gameCards(target);
  assert.equal(card.Category, 'Imported');
  assert.equal(card.Name, 'Source');
  assert.equal(card.Description, 'Prompt');
  assert.equal(card.version, 1);
  assert.equal(card.likes, 0);
  assert.equal(card.dislikes, 0);
  assert.equal((await gameCards(source))[0].likes, 1);
  assert.equal(
    (
      await copy(source, target, [{ id: 'other', version: 1 }], {
        category: 'Imported',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await copy(source, target, [{ ...rows[0], version: 99 }], {
        category: 'Imported',
      })
    ).status,
    409,
  );
  assert.equal(
    (await copy(source, target, [rows[0], rows[0]], { category: 'Imported' }))
      .status,
    400,
  );
  const narrow = await createGame({ cardFormat: 'name' });
  assert.equal((await copy(source, narrow, rows)).status, 400);
  assert.equal((await gameCards(narrow)).length, 0);
  const uncategorized = await createGame();
  assert.equal(
    (await copy(target, uncategorized, [{ id: card.id, version: 1 }])).status,
    201,
  );
  assert.equal((await gameCards(uncategorized))[0].Category, '');
  assert.equal(
    (
      await copy(source, target, Array(101).fill(rows[0]), {
        category: 'Imported',
      })
    ).status,
    400,
  );
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS count FROM write_guards').first())
      .count,
    0,
  );
});

test('a concurrent destination format change rolls back all copied cards and audit records', async () => {
  await db.prepare("DELETE FROM rate_limits WHERE key LIKE 'admin:%'").run();
  const source = await createGame();
  const target = await createGame();
  const { ids } = await (
    await gameBulk(source, 'import', [{ Name: 'Copy race' }])
  ).json();
  let raced = false;
  const racingDB = {
    prepare: (sql) => db.prepare(sql),
    batch: async (statements) => {
      if (!raced) {
        raced = true;
        await db
          .prepare(
            "UPDATE games SET card_format='description',version=version+1 WHERE id=?",
          )
          .bind(target.id)
          .run();
      }
      return db.batch(statements);
    },
  };
  const response = await request(`/games/${source.id}/cards/copy`, {
    cookie: adminCookie,
    data: {
      sourceVersion: 1,
      targetId: target.id,
      targetVersion: 1,
      cards: [{ id: ids[0], version: 1 }],
    },
    extraEnv: { DB: racingDB },
  });
  assert.equal(response.status, 409);
  assert.equal((await gameCards(target)).length, 0);
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS count FROM audit_log WHERE game_id=? AND action='copy'",
        )
        .bind(target.id)
        .first()
    ).count,
    0,
  );
});

const categoryData = async (game) =>
  (
    await request(`/games/${game.id}/categories`, { cookie: adminCookie })
  ).json();
const rename = (game, review, from, to, expectedCount) =>
  request(`/games/${game.id}/categories`, {
    cookie: adminCookie,
    data: {
      from,
      to,
      expectedCount,
      revision: review.revision,
      gameVersion: review.gameVersion,
    },
  });

test('category rename/merge is atomic across active and removed cards, including decks larger than a selection batch', async () => {
  await db
    .prepare(
      "DELETE FROM rate_limits WHERE key LIKE 'admin:%' OR key LIKE 'vote:%'",
    )
    .run();
  const game = await createGame({ hasCategories: true });
  const { ids } = await (
    await gameBulk(
      game,
      'import',
      Array.from({ length: 100 }, (_, index) => ({
        Name: `Card ${index}`,
        Category: 'Old',
      })),
    )
  ).json();
  await gameBulk(game, 'import', [
    { Name: 'Extra', Category: 'Old' },
    { Name: 'Existing target', Category: 'New' },
  ]);
  await request(`/cards/${ids[0]}/vote`, {
    cookie: userCookie,
    data: { value: 1 },
  });
  await gameBulk(game, 'remove', [{ id: ids[1], version: 1 }]);
  const review = await categoryData(game);
  assert.deepEqual(
    review.categories.find((category) => category.name === 'Old'),
    { name: 'Old', active: 100, removed: 1, total: 101 },
  );
  assert.equal((await rename(game, review, 'Old', 'New', 101)).status, 200);
  assert.ok((await gameCards(game)).every((card) => card.Category === 'New'));
  const trash = await (
    await request(`/games/${game.id}/cards?removed=true`, {
      cookie: adminCookie,
    })
  ).json();
  assert.equal(trash[0].Category, 'New');
  assert.equal(trash[0].version, 3);
  assert.equal(
    (await gameCards(game)).find((card) => card.id === ids[0]).likes,
    1,
  );
  assert.equal((await rename(game, review, 'Old', 'Again', 101)).status, 409);
  const fresh = await categoryData(game);
  assert.equal((await rename(game, fresh, 'New', '', 102)).status, 400);
  assert.equal((await rename(game, fresh, 'New', 'New', 102)).status, 400);
  assert.equal((await rename(game, fresh, 'New', 'Again', 101)).status, 409);
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS count FROM write_guards').first())
      .count,
    0,
  );
});

test('a category review becomes stale after any card write and cannot rename an unreviewed import', async () => {
  await db.prepare("DELETE FROM rate_limits WHERE key LIKE 'admin:%'").run();
  const game = await createGame({ hasCategories: true });
  await gameBulk(game, 'import', [{ Name: 'First', Category: 'Old' }]);
  const review = await categoryData(game);
  await gameBulk(game, 'import', [{ Name: 'Newer', Category: 'Other' }]);
  assert.equal((await rename(game, review, 'Old', 'New', 1)).status, 409);
  assert.equal((await gameCards(game))[0].Category, 'Old');
});

test('feedback overview uses actual vote counts, reports unrated cards, and excludes card/game trash', async () => {
  await db
    .prepare(
      "DELETE FROM rate_limits WHERE key LIKE 'admin:%' OR key LIKE 'vote:%'",
    )
    .run();
  const game = await createGame();
  const { ids } = await (
    await gameBulk(game, 'import', [
      { Name: 'Popular' },
      { Name: 'Needs attention' },
      { Name: 'Unrated' },
      { Name: 'Removed' },
    ])
  ).json();
  for (const [id, value] of [
    [ids[0], 1],
    [ids[1], -1],
    [ids[3], 1],
  ])
    await request(`/cards/${id}/vote`, { cookie: userCookie, data: { value } });
  await gameBulk(game, 'feedback', [{ id: ids[0], version: 1 }], 1);
  await gameBulk(game, 'remove', [{ id: ids[3], version: 1 }]);
  let report = await (
    await request(`/admin/feedback?game=${game.id}`, { cookie: adminCookie })
  ).json();
  assert.deepEqual(report.summary, {
    cards: 3,
    ratedCards: 2,
    likes: 2,
    dislikes: 1,
    unratedCards: 1,
  });
  assert.equal(report.liked[0].id, ids[0]);
  assert.equal(report.disliked[0].id, ids[1]);
  assert.ok(report.liked.every((card) => !('actor' in card)));
  await gameWrite('remove', game);
  report = await (
    await request(`/admin/feedback?game=${game.id}`, { cookie: adminCookie })
  ).json();
  assert.deepEqual(report.summary, {
    cards: 0,
    ratedCards: 0,
    likes: 0,
    dislikes: 0,
    unratedCards: 0,
  });
});

test('activity history paginates without overlap, includes removed games, and hides saved card payloads', async () => {
  await db.prepare("DELETE FROM rate_limits WHERE key LIKE 'admin:%'").run();
  const game = await createGame();
  await db.batch(
    Array.from({ length: 55 }, (_, index) =>
      db
        .prepare(
          'INSERT INTO audit_log (id,github_id,game_id,action,details) VALUES (?,?,?,?,?)',
        )
        .bind(
          crypto.randomUUID(),
          '48080916',
          game.id,
          'edit',
          JSON.stringify([
            { id: `audit-${index}`, Name: 'Private saved content' },
          ]),
        ),
    ),
  );
  const first = await (
    await request(`/admin/activity?game=${game.id}`, { cookie: adminCookie })
  ).json();
  assert.equal(first.entries.length, 50);
  assert.ok(first.nextCursor);
  const second = await (
    await request(
      `/admin/activity?game=${game.id}&before=${first.nextCursor}`,
      { cookie: adminCookie },
    )
  ).json();
  assert.equal(second.entries.length, 6);
  assert.equal(second.nextCursor, null);
  assert.equal(
    new Set([...first.entries, ...second.entries].map((entry) => entry.id))
      .size,
    56,
  );
  assert.ok(!JSON.stringify(first).includes('Private saved content'));
  assert.ok(
    first.entries.every(
      (entry) => entry.changed === 1 && entry.actorId === '48080916',
    ),
  );
  assert.equal(
    (await request('/admin/activity?before=-1', { cookie: adminCookie }))
      .status,
    400,
  );
  await gameWrite('remove', game);
  const removed = await (
    await request(`/admin/activity?game=${game.id}`, { cookie: adminCookie })
  ).json();
  assert.equal(removed.entries[0].action, 'game:remove');
  assert.equal(removed.entries[0].gameName, game.name);
});

test('votes need a previously issued visitor identity, and new identities are capped per network', async () => {
  await db
    .prepare(
      "DELETE FROM rate_limits WHERE key LIKE 'vote:%' OR key LIKE 'visitor:%'",
    )
    .run();
  // A cookieless request cannot mint an identity by voting.
  const anonymous = await request('/cards/original/vote', {
    data: { value: 1 },
  });
  assert.equal(anonymous.status, 403);
  assert.equal(anonymous.headers.get('Set-Cookie'), null);
  const forged = await request('/cards/original/vote', {
    data: { value: 1 },
    cookie: `jb_visitor=${'a'.repeat(43)}.${'b'.repeat(43)}`,
  });
  assert.equal(forged.status, 403);
  // IPv6 clients share a budget across their /64.
  const ipv6 = (suffix) => ({ 'CF-Connecting-IP': `2001:db8:1:2::${suffix}` });
  let issued = 0;
  for (let i = 0; i < 35; i++) {
    const response = await worker.fetch(
      new Request(`${origin}/api/session`, { headers: ipv6(i.toString(16)) }),
      { ...env, DB: db },
    );
    if (response.headers.get('Set-Cookie')) issued++;
    assert.equal(response.status, 200);
  }
  assert.equal(issued, 30);
  const other = await worker.fetch(
    new Request(`${origin}/api/session`, {
      headers: { 'CF-Connecting-IP': '2001:db8:1:3::1' },
    }),
    { ...env, DB: db },
  );
  assert.ok(other.headers.get('Set-Cookie'));
});

test('reads keep working without a cookie secret; voting reports that feedback is unavailable', async () => {
  const extraEnv = { COOKIE_SECRET: '' };
  const session = await request('/session', { extraEnv });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).feedbackEnabled, false);
  const cards = await request('/games/game2/cards', { extraEnv });
  assert.equal(cards.status, 200);
  assert.equal((await cards.json())[0].myVote, 0);
  assert.equal(
    (await request('/cards/other/vote', { data: { value: 1 }, extraEnv }))
      .status,
    503,
  );
  assert.equal(
    (
      await request('/cards/other/vote', {
        data: { value: 0 },
        cookie: userCookie,
        extraEnv,
      })
    ).status,
    200,
  );
});

test('card and game lists support conditional requests; malformed paths are client errors', async () => {
  const first = await request('/games/game2/cards', { cookie: userCookie });
  const etag = first.headers.get('ETag');
  assert.match(etag, /^W\/"/);
  const repeat = await worker.fetch(
    new Request(`${origin}/api/games/game2/cards`, {
      headers: { Cookie: userCookie, 'If-None-Match': etag },
    }),
    { ...env, DB: db },
  );
  assert.equal(repeat.status, 304);
  await request('/cards/other/vote', {
    data: { value: 1 },
    cookie: userCookie,
  });
  const changed = await worker.fetch(
    new Request(`${origin}/api/games/game2/cards`, {
      headers: { Cookie: userCookie, 'If-None-Match': etag },
    }),
    { ...env, DB: db },
  );
  assert.equal(changed.status, 200);
  await request('/cards/other/vote', {
    data: { value: 0 },
    cookie: userCookie,
  });
  assert.equal((await request('/games/%E0%A4%A/cards')).status, 400);
});

test('audits keep previous card content and game settings; copies reject a stale source game', async () => {
  await db.prepare("DELETE FROM rate_limits WHERE key LIKE 'admin:%'").run();
  const game = await createGame();
  const { ids } = await (
    await gameBulk(game, 'import', [{ Name: 'Before' }])
  ).json();
  assert.equal(
    (await gameBulk(game, 'edit', [{ id: ids[0], version: 1, Name: 'After' }]))
      .status,
    200,
  );
  const edit = JSON.parse(
    (
      await db
        .prepare(
          "SELECT details FROM audit_log WHERE game_id=? AND action='edit'",
        )
        .bind(game.id)
        .first()
    ).details,
  );
  assert.equal(edit.before[0].Name, 'Before');
  assert.equal(edit.cards[0].Name, 'After');
  assert.equal(
    (await gameWrite('edit', { ...game, name: 'Renamed deck' })).status,
    200,
  );
  const gameEdit = JSON.parse(
    (
      await db
        .prepare(
          "SELECT details FROM audit_log WHERE game_id=? AND action='game:edit'",
        )
        .bind(game.id)
        .first()
    ).details,
  );
  assert.equal(gameEdit.before.name, 'Test deck');
  assert.equal(gameEdit.before.hasCategories, false);
  assert.equal(gameEdit.name, 'Renamed deck');
  const activityReport = await (
    await request(`/admin/activity?game=${game.id}`, { cookie: adminCookie })
  ).json();
  assert.ok(
    activityReport.entries.every(
      (entry) => entry.actorLogin === 'thehaseebshah',
    ),
  );
  assert.ok(!JSON.stringify(activityReport).includes('Before'));
  const target = await createGame();
  assert.equal(
    (await copy(game, target, [{ id: ids[0], version: 2 }])).status,
    409,
  );
  assert.equal(
    (await copy({ ...game, version: 2 }, target, [{ id: ids[0], version: 2 }]))
      .status,
    201,
  );
});

test('signing in moves anonymous votes to the account so one person counts once', async () => {
  await db
    .prepare(
      "DELETE FROM rate_limits WHERE key LIKE 'vote:%' OR key LIKE 'visitor:%' OR key LIKE 'auth:%'",
    )
    .run();
  const visitor = (await request('/session')).headers
    .get('Set-Cookie')
    .split(';')[0];
  assert.equal(
    (
      await request('/cards/other/vote', {
        data: { value: -1 },
        cookie: visitor,
      })
    ).status,
    200,
  );
  const start = await request('/auth/github');
  const state = new URL(start.headers.get('Location')).searchParams.get(
    'state',
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url === 'https://github.com/login/oauth/access_token')
      return Response.json({ access_token: 'github-test-token' });
    if (url === 'https://api.github.com/user')
      return Response.json({ id: 777, login: 'returning-player' });
    throw new Error('Unexpected network request');
  };
  try {
    const response = await request(
      `/auth/github/callback?state=${state}&code=test`,
      { cookie: `jb_oauth=${state}; ${visitor}` },
    );
    assert.equal(response.status, 302);
    const account = response.headers
      .getSetCookie()
      .find((value) => value.startsWith('jb_session='))
      .split(';')[0];
    const [card] = await (
      await request('/games/game2/cards', { cookie: account })
    ).json();
    assert.equal(card.myVote, -1);
    assert.equal(card.dislikes, 1);
    assert.equal(
      (
        await db
          .prepare("SELECT COUNT(*) AS count FROM votes WHERE card_id='other'")
          .first()
      ).count,
      1,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  await db.prepare("DELETE FROM votes WHERE card_id='other'").run();
});
