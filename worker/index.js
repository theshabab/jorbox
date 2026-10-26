import { decodeSegment, fail, json, readBody, statement } from './http.js';
import {
  copyCards,
  categories,
  renameCategory,
  activity,
  feedbackOverview,
} from './adminTools.js';
import {
  CARD_LIMITS,
  MAX_BULK_ROWS,
  cardErrors,
} from '../src/utils/cardFormats.js';

const SESSION_SECONDS = 7 * 24 * 3600;
const VISITOR_SECONDS = 365 * 86400;
// New anonymous identities per network per hour. Generous enough for a room of
// players sharing one Wi-Fi network, but it caps scripted vote stuffing.
const VISITORS_PER_HOUR = 30;
const now = () => Math.floor(Date.now() / 1000);
const cookies = (request) =>
  Object.fromEntries(
    (request.headers.get('Cookie') || '')
      .split(';')
      .filter((part) => part.includes('='))
      .map((part) => {
        const i = part.indexOf('=');
        return [part.slice(0, i).trim(), part.slice(i + 1).trim()];
      }),
  );
const cookie = (request, name, value, age) =>
  `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
const bytes = (value) => new TextEncoder().encode(value);
const base64 = (value) =>
  btoa(String.fromCharCode(...new Uint8Array(value)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
const unbase64 = (value) =>
  Uint8Array.from(
    atob(
      value.replaceAll('-', '+').replaceAll('_', '/') +
        '='.repeat((4 - (value.length % 4)) % 4),
    ),
    (char) => char.charCodeAt(0),
  );
const hash = async (value) =>
  base64(await crypto.subtle.digest('SHA-256', bytes(value)));
const random = () => base64(crypto.getRandomValues(new Uint8Array(32)));

async function session(request, env) {
  const token = cookies(request).jb_session;
  if (!token) return null;
  const user = await env.DB.prepare(
    'SELECT github_id, login FROM sessions WHERE token_hash = ? AND expires_at > ?',
  )
    .bind(await hash(token), now())
    .first();
  if (!user) return null;
  return {
    ...user,
    isAdmin: (env.ADMIN_GITHUB_IDS || '')
      .split(',')
      .map((id) => id.trim())
      .includes(user.github_id),
  };
}

const feedbackConfigured = (env) =>
  Boolean(env.COOKIE_SECRET && env.COOKIE_SECRET.length >= 32);
const signingKey = (env) =>
  crypto.subtle.importKey(
    'raw',
    bytes(env.COOKIE_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );

// Rate limits are keyed by network: a single IPv4 address, or the /64 prefix for
// IPv6 because one IPv6 client can rotate through its whole /64.
function clientNetwork(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::')
    ? [
        ...left,
        ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'),
        ...right,
      ]
    : left;
  return `${groups
    .slice(0, 4)
    .map((group) => group.padStart(4, '0'))
    .join(':')}::/64`;
}

const LIMITER_BINDINGS = {
  auth: 'AUTH_LIMITER',
  admin: 'ADMIN_LIMITER',
  vote: 'VOTE_LIMITER',
};

// Uses the Workers Rate Limiting binding when configured so hot paths do not
// write to D1. D1 buckets remain the fallback and back longer windows.
async function rateLimit(
  request,
  env,
  kind,
  limit,
  { window = 60, soft = false } = {},
) {
  const client = await hash(
    `${env.COOKIE_SECRET || ''}:${clientNetwork(request)}`,
  );
  const binding = window === 60 && env[LIMITER_BINDINGS[kind]];
  let allowed;
  if (binding) {
    allowed = (await binding.limit({ key: `${kind}:${client}` })).success;
  } else {
    const bucket = Math.floor(now() / window);
    const result = await env.DB.prepare(
      `INSERT INTO rate_limits (key,count,expires_at) VALUES (?,1,?)
      ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count`,
    )
      .bind(`${kind}:${client}:${bucket}`, now() + window * 2)
      .first();
    allowed = result.count <= limit;
  }
  if (!allowed && !soft)
    fail(429, 'Too many requests. Please try again in a minute.');
  return allowed;
}

// Resolves who is voting. Reads never fail because feedback is misconfigured:
// they continue without a personal vote. Only voting itself needs the secret.
async function actor(request, env, user, { issue = false } = {}) {
  if (user) return { id: `github:${user.github_id}` };
  if (!feedbackConfigured(env)) return { id: null };
  const key = await signingKey(env);
  const value = cookies(request).jb_visitor;
  if (value && /^[a-zA-Z0-9_-]{43}\.[a-zA-Z0-9_-]{43}$/.test(value)) {
    const [token, signature] = value.split('.');
    if (
      await crypto.subtle.verify('HMAC', key, unbase64(signature), bytes(token))
    )
      return { id: `visitor:${await hash(token)}` };
  }
  if (!issue) return { id: null };
  if (
    !(await rateLimit(request, env, 'visitor', VISITORS_PER_HOUR, {
      window: 3600,
      soft: true,
    }))
  )
    return { id: null };
  const token = random();
  const signature = base64(await crypto.subtle.sign('HMAC', key, bytes(token)));
  return {
    id: `visitor:${await hash(token)}`,
    cookie: cookie(
      request,
      'jb_visitor',
      `${token}.${signature}`,
      VISITOR_SECONDS,
    ),
  };
}

async function githubAuth(request, env, path) {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.APP_ORIGIN)
    fail(503, 'GitHub sign-in is not configured yet.');
  const url = new URL(request.url);
  const callback = `${env.APP_ORIGIN}/api/auth/github/callback`;
  if (url.origin !== env.APP_ORIGIN)
    fail(400, 'Sign in from the configured application URL.');
  await rateLimit(request, env, 'auth', 20);
  if (path === '/api/auth/github') {
    const state = random();
    const verifier = random();
    await env.DB.prepare(
      'INSERT INTO oauth_states (state_hash,verifier,expires_at) VALUES (?,?,?)',
    )
      .bind(await hash(state), verifier, now() + 600)
      .run();
    const target = new URL('https://github.com/login/oauth/authorize');
    target.search = new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID,
      redirect_uri: callback,
      state,
      scope: '',
      code_challenge: await hash(verifier),
      code_challenge_method: 'S256',
    });
    return new Response(null, {
      status: 302,
      headers: {
        Location: target.href,
        'Set-Cookie': cookie(request, 'jb_oauth', state, 600),
      },
    });
  }
  const state = url.searchParams.get('state');
  if (!state || state !== cookies(request).jb_oauth)
    fail(400, 'Sign-in expired or invalid. Please sign in again.');
  const stored = await env.DB.prepare(
    'DELETE FROM oauth_states WHERE state_hash = ? AND expires_at > ? RETURNING verifier',
  )
    .bind(await hash(state), now())
    .first();
  if (!stored || !url.searchParams.get('code'))
    fail(400, 'Sign-in was cancelled or expired. Please sign in again.');
  const tokenResponse = await fetch(
    'https://github.com/login/oauth/access_token',
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code: url.searchParams.get('code'),
        redirect_uri: callback,
        code_verifier: stored.verifier,
      }),
    },
  );
  if (!tokenResponse.ok) fail(502, 'GitHub sign-in failed. Please try again.');
  const token = await tokenResponse.json();
  if (!token.access_token)
    fail(400, 'GitHub sign-in failed. Please sign in again.');
  const profileResponse = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'JorBox',
    },
  });
  if (!profileResponse.ok) fail(502, 'Unable to verify your GitHub account.');
  const profile = await profileResponse.json();
  if (!Number.isSafeInteger(profile.id) || typeof profile.login !== 'string')
    fail(502, 'Invalid GitHub profile.');
  const sessionToken = random();
  const statements = [
    statement(
      env,
      'INSERT INTO sessions (token_hash,github_id,login,expires_at) VALUES (?,?,?,?)',
      await hash(sessionToken),
      String(profile.id),
      profile.login,
      now() + SESSION_SECONDS,
    ),
  ];
  // Move this browser's anonymous votes to the account so one person cannot vote
  // once anonymously and again after signing in. Existing account votes win.
  const visitor = await actor(request, env, null);
  if (visitor.id)
    statements.push(
      statement(
        env,
        'INSERT OR IGNORE INTO votes (card_id,actor,value) SELECT card_id,?,value FROM votes WHERE actor=?',
        `github:${profile.id}`,
        visitor.id,
      ),
      statement(env, 'DELETE FROM votes WHERE actor=?', visitor.id),
    );
  const oldToken = cookies(request).jb_session;
  if (oldToken)
    statements.push(
      statement(
        env,
        'DELETE FROM sessions WHERE token_hash = ?',
        await hash(oldToken),
      ),
    );
  await env.DB.batch(statements);
  const headers = new Headers({ Location: `${env.APP_ORIGIN}/` });
  headers.append(
    'Set-Cookie',
    cookie(request, 'jb_session', sessionToken, SESSION_SECONDS),
  );
  headers.append('Set-Cookie', cookie(request, 'jb_oauth', '', 0));
  return new Response(null, { status: 302, headers });
}

export function validateCard(row, game) {
  if (!row || typeof row !== 'object' || Array.isArray(row))
    fail(400, 'Invalid card.');
  const card = {};
  for (const [field, limit] of Object.entries(CARD_LIMITS)) {
    const value = row[field] ?? '';
    if (typeof value !== 'string' || value.length > limit)
      fail(400, `${field} must be text of at most ${limit} characters.`);
    card[field] = value.trim();
  }
  const [error] = cardErrors(card, {
    cardFormat: game.card_format,
    hasCategories: Boolean(game.has_categories),
  });
  if (error) fail(400, `Invalid card: ${error}`);
  return card;
}

const conflict = (message) => (error) => {
  if (String(error.message).includes('CHECK constraint failed'))
    fail(409, message);
  throw error;
};

async function bulk(request, env, game, user) {
  const data = await readBody(request);
  const action = data?.action;
  if (!['import', 'edit', 'remove', 'restore', 'feedback'].includes(action))
    fail(400, 'Unknown bulk action.');
  if (
    !Array.isArray(data.cards) ||
    !data.cards.length ||
    data.cards.length > MAX_BULK_ROWS
  )
    fail(400, `Select between 1 and ${MAX_BULK_ROWS} cards.`);
  const rows = data.cards.map((row) => {
    if (action === 'import')
      return { ...validateCard(row, game), id: crypto.randomUUID() };
    if (
      !row ||
      typeof row.id !== 'string' ||
      !row.id ||
      !Number.isSafeInteger(row.version) ||
      row.version < 1
    )
      fail(
        400,
        'Each existing card needs its ID and version. Refresh the card list.',
      );
    const value = row.value ?? data.value;
    if (action === 'feedback' && ![1, -1, 0].includes(value))
      fail(400, 'Feedback must be like, dislike, or clear.');
    return {
      ...(action === 'edit' ? validateCard(row, game) : {}),
      ...(action === 'feedback' ? { value } : {}),
      id: row.id,
      version: row.version,
    };
  });
  if (new Set(rows.map((row) => row.id)).size !== rows.length)
    fail(400, 'A card can only appear once in a bulk operation.');
  const statements = [];
  const operation = crypto.randomUUID();
  const expected = JSON.stringify(
    rows.map(({ id, version }) => ({ id, version })),
  );
  // Pin the format and game state for the entire transaction, including imports.
  statements.push(
    statement(
      env,
      'INSERT INTO write_guards (id,valid) SELECT ?, CASE WHEN EXISTS (SELECT 1 FROM games WHERE id=? AND version=? AND deleted_at IS NULL) THEN 1 ELSE 0 END',
      `${operation}:game`,
      game.id,
      game.version,
    ),
  );
  if (action !== 'import') {
    // D1 batch is transactional. A failing CHECK aborts every write, including the audit log.
    statements.push(
      statement(
        env,
        `INSERT INTO write_guards (id,valid) SELECT ?,
      CASE WHEN (SELECT COUNT(*) FROM cards c JOIN json_each(?) j ON c.id=json_extract(j.value,'$.id')
      WHERE c.game_id=? AND c.version=json_extract(j.value,'$.version') AND c.deleted_at IS ${action === 'restore' ? 'NOT ' : ''}NULL)=? THEN 1 ELSE 0 END`,
        operation,
        expected,
        game.id,
        rows.length,
      ),
    );
  }
  // Written before the changes so the audit keeps each card's previous content.
  statements.push(
    statement(
      env,
      `INSERT INTO audit_log (id,github_id,game_id,action,details) SELECT ?,?,?,?,json_object('cards',json(?),'before',
      json(CASE WHEN ?='import' THEN '[]' ELSE (SELECT json_group_array(json_object('id',c.id,'version',c.version,'Name',c.name,'Description',c.description,'Category',c.category))
      FROM cards c JOIN json_each(?) j ON c.id=json_extract(j.value,'$.id') WHERE c.game_id=?) END))`,
      operation,
      user.github_id,
      game.id,
      action,
      JSON.stringify(rows),
      action,
      expected,
      game.id,
    ),
  );
  for (const row of rows) {
    if (action === 'import')
      statements.push(
        statement(
          env,
          'INSERT INTO cards (id,game_id,name,description,category) VALUES (?,?,?,?,?)',
          row.id,
          game.id,
          row.Name,
          row.Description,
          row.Category,
        ),
      );
    if (action === 'edit')
      statements.push(
        statement(
          env,
          'UPDATE cards SET name=?,description=?,category=?,version=version+1,updated_at=unixepoch() WHERE id=? AND game_id=?',
          row.Name,
          row.Description,
          row.Category,
          row.id,
          game.id,
        ),
      );
    if (action === 'remove' || action === 'restore')
      statements.push(
        statement(
          env,
          'UPDATE cards SET deleted_at=?,version=version+1,updated_at=unixepoch() WHERE id=? AND game_id=?',
          action === 'remove' ? now() : null,
          row.id,
          game.id,
        ),
      );
    if (action === 'feedback') {
      const identity = `github:${user.github_id}`;
      statements.push(
        row.value === 0
          ? statement(
              env,
              'DELETE FROM votes WHERE card_id=? AND actor=?',
              row.id,
              identity,
            )
          : statement(
              env,
              'INSERT INTO votes (card_id,actor,value) VALUES (?,?,?) ON CONFLICT(card_id,actor) DO UPDATE SET value=excluded.value',
              row.id,
              identity,
              row.value,
            ),
      );
    }
  }
  statements.push(
    statement(
      env,
      'DELETE FROM write_guards WHERE id IN (?,?)',
      operation,
      `${operation}:game`,
    ),
  );
  await env.DB.batch(statements).catch(
    conflict(
      'Some cards changed or were removed. Refresh and review your changes before trying again.',
    ),
  );
  return json(
    { changed: rows.length, ids: rows.map((row) => row.id) },
    action === 'import' ? 201 : 200,
  );
}

async function manageGame(request, env, user) {
  const data = await readBody(request);
  const action = data?.action;
  if (!['create', 'edit', 'remove', 'restore'].includes(action))
    fail(400, 'Unknown game action.');
  const id = action === 'create' ? `game-${crypto.randomUUID()}` : data.id;
  if (
    typeof id !== 'string' ||
    !id ||
    (action !== 'create' &&
      (!Number.isSafeInteger(data.version) || data.version < 1))
  )
    fail(400, 'Refresh the game list before making changes.');
  let fields;
  if (action === 'create' || action === 'edit') {
    if (
      typeof data.name !== 'string' ||
      !data.name.trim() ||
      data.name.length > 200
    )
      fail(400, 'Game name must be between 1 and 200 characters.');
    if (
      !['flexible', 'name', 'description', 'name-description'].includes(
        data.cardFormat,
      )
    )
      fail(400, 'Choose a valid card format.');
    if (typeof data.hasCategories !== 'boolean')
      fail(400, 'Choose whether the game has categories.');
    if (
      data.defaultCategory !== undefined &&
      (typeof data.defaultCategory !== 'string' ||
        data.defaultCategory.length > CARD_LIMITS.Category)
    )
      fail(
        400,
        `Default category must be text of at most ${CARD_LIMITS.Category} characters.`,
      );
    if (
      data.clearCategories !== undefined &&
      typeof data.clearCategories !== 'boolean'
    )
      fail(400, 'Choose whether to clear existing categories.');
    fields = {
      name: data.name.trim(),
      cardFormat: data.cardFormat,
      hasCategories: data.hasCategories,
      defaultCategory: data.defaultCategory?.trim() || '',
      clearCategories: !data.hasCategories && data.clearCategories === true,
    };
  }
  const operation = crypto.randomUUID();
  const statements = [];
  if (action !== 'create')
    statements.push(
      statement(
        env,
        `INSERT INTO write_guards (id,valid) SELECT ?, CASE WHEN EXISTS
      (SELECT 1 FROM games WHERE id=? AND version=? AND deleted_at IS ${action === 'restore' ? 'NOT ' : ''}NULL) THEN 1 ELSE 0 END`,
        operation,
        id,
        data.version,
      ),
    );
  // Written before the change so the audit keeps the previous game settings.
  statements.push(
    statement(
      env,
      `INSERT INTO audit_log (id,github_id,game_id,action,details) SELECT ?,?,?,?,json_patch(json(?),json_object('before',
      json(COALESCE((SELECT json_object('name',name,'cardFormat',card_format,'hasCategories',json(CASE WHEN has_categories THEN 'true' ELSE 'false' END),'version',version) FROM games WHERE id=?),'null'))))`,
      operation,
      user.github_id,
      id,
      `game:${action}`,
      JSON.stringify(fields || { version: data.version }),
      id,
    ),
  );
  if (action === 'create') {
    statements.push(
      statement(
        env,
        'INSERT INTO games (id,name,has_categories,card_format) VALUES (?,?,?,?)',
        id,
        fields.name,
        Number(fields.hasCategories),
        fields.cardFormat,
      ),
    );
  } else if (action === 'edit') {
    // Validate all cards, including trash, inside the write transaction. Never silently drop content.
    statements.push(
      statement(
        env,
        `INSERT INTO write_guards (id,valid) SELECT ?, CASE WHEN NOT EXISTS (
        SELECT 1 FROM cards WHERE game_id=? AND (
          (?='name' AND (length(trim(name))=0 OR length(trim(description))>0)) OR
          (?='description' AND (length(trim(description))=0 OR length(trim(name))>0)) OR
          (?='name-description' AND (length(trim(name))=0 OR length(trim(description))=0)) OR
          (?=0 AND ?=0 AND length(trim(category))>0) OR
          (?=1 AND length(trim(category))=0 AND ?='')
        )) THEN 1 ELSE 0 END`,
        `${operation}:format`,
        id,
        fields.cardFormat,
        fields.cardFormat,
        fields.cardFormat,
        Number(fields.hasCategories),
        Number(fields.clearCategories),
        Number(fields.hasCategories),
        fields.defaultCategory,
      ),
    );
    if (fields.hasCategories && fields.defaultCategory)
      statements.push(
        statement(
          env,
          'UPDATE cards SET category=?,version=version+1,updated_at=unixepoch() WHERE game_id=? AND length(trim(category))=0',
          fields.defaultCategory,
          id,
        ),
      );
    if (fields.clearCategories)
      statements.push(
        statement(
          env,
          "UPDATE cards SET category='',version=version+1,updated_at=unixepoch() WHERE game_id=? AND length(trim(category))>0",
          id,
        ),
      );
    statements.push(
      statement(
        env,
        'UPDATE games SET name=?,has_categories=?,card_format=?,version=version+1 WHERE id=?',
        fields.name,
        Number(fields.hasCategories),
        fields.cardFormat,
        id,
      ),
    );
  } else {
    statements.push(
      statement(
        env,
        'UPDATE games SET deleted_at=?,version=version+1 WHERE id=?',
        action === 'remove' ? now() : null,
        id,
      ),
    );
  }
  statements.push(
    statement(
      env,
      'DELETE FROM write_guards WHERE id IN (?,?)',
      operation,
      `${operation}:format`,
    ),
  );
  await env.DB.batch(statements).catch(
    conflict(
      'The game changed, or existing cards (including removed cards) do not fit this format. Refresh and review the cards. When enabling categories, supply a default category.',
    ),
  );
  return json({ id, changed: 1 }, action === 'create' ? 201 : 200);
}

// Card lists and the game list may be revalidated by the browser: an unchanged
// response costs a 304 instead of re-downloading a large deck.
async function cacheable(request, data, headers = {}) {
  const body = JSON.stringify(data);
  const etag = `W/"${await hash(body)}"`;
  const response =
    request.headers.get('If-None-Match') === etag
      ? new Response(null, { status: 304 })
      : new Response(body, {
          headers: { 'Content-Type': 'application/json' },
        });
  response.headers.set('ETag', etag);
  response.headers.set('Cache-Control', 'private, no-cache');
  response.headers.set('Vary', 'Cookie');
  for (const [name, value] of Object.entries(headers))
    if (value) response.headers.append(name, value);
  return response;
}

const requireAdmin = (user, signInMessage, deniedMessage) => {
  if (!user) fail(401, signInMessage);
  if (!user.isAdmin) fail(403, deniedMessage);
};

async function activeGame(env, id) {
  const game = await statement(
    env,
    'SELECT * FROM games WHERE id=? AND deleted_at IS NULL',
    decodeSegment(id),
  ).first();
  if (!game) fail(404, 'Game not found.');
  return game;
}

const handlers = [
  [
    'GET',
    /^\/api\/session$/,
    async ({ request, env, user }) => {
      const identity = await actor(request, env, user, { issue: true });
      const response = json({
        user,
        feedbackRequiresLogin: env.FEEDBACK_REQUIRE_LOGIN === 'true',
        feedbackEnabled: Boolean(user) || Boolean(identity.id),
        githubEnabled: Boolean(
          env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.APP_ORIGIN,
        ),
        maxBulkRows: MAX_BULK_ROWS,
      });
      if (identity.cookie)
        response.headers.append('Set-Cookie', identity.cookie);
      return response;
    },
  ],
  [
    'POST',
    /^\/api\/auth\/logout$/,
    async ({ request, env }) => {
      const token = cookies(request).jb_session;
      if (token)
        await statement(
          env,
          'DELETE FROM sessions WHERE token_hash=?',
          await hash(token),
        ).run();
      const response = json({ ok: true });
      response.headers.append(
        'Set-Cookie',
        cookie(request, 'jb_session', '', 0),
      );
      return response;
    },
  ],
  [
    'GET',
    /^\/api\/games$/,
    async ({ request, env, url, user }) => {
      const removed = url.searchParams.get('removed') === 'true';
      if (removed && !user?.isAdmin)
        fail(403, 'Administrator access required.');
      const { results } = await env.DB.prepare(
        `SELECT g.id,g.name,g.has_categories AS hasCategories,g.card_format AS cardFormat,g.version,
      (SELECT COUNT(*) FROM cards WHERE game_id=g.id AND deleted_at IS NULL) AS cardCount
      FROM games g WHERE g.deleted_at IS ${removed ? 'NOT ' : ''}NULL
      ORDER BY CASE WHEN g.id GLOB 'game[0-9]*' AND SUBSTR(g.id,5) NOT GLOB '*[^0-9]*' THEN CAST(SUBSTR(g.id,5) AS INTEGER) ELSE 2147483647 END,g.name COLLATE NOCASE,g.id`,
      ).all();
      return cacheable(
        request,
        results.map((game) => ({
          ...game,
          hasCategories: Boolean(game.hasCategories),
        })),
      );
    },
  ],
  [
    'POST',
    /^\/api\/games\/manage$/,
    async ({ request, env, user }) => {
      requireAdmin(
        user,
        'Sign in to manage games.',
        'This GitHub account cannot manage games.',
      );
      await rateLimit(request, env, 'admin', 30);
      return manageGame(request, env, user);
    },
  ],
  [
    'GET',
    /^\/api\/admin\/(activity|feedback)$/,
    ({ env, url, user, params }) => {
      requireAdmin(
        user,
        'Sign in to view administrator reports.',
        'Administrator access required.',
      );
      return params[0] === 'activity'
        ? activity(env, url)
        : feedbackOverview(env, url);
    },
  ],
  [
    'GET',
    /^\/api\/games\/([^/]+)\/categories$/,
    async ({ env, user, params }) => {
      requireAdmin(
        user,
        'Sign in to manage decks.',
        'Administrator access required.',
      );
      return categories(env, await activeGame(env, params[0]));
    },
  ],
  [
    'POST',
    /^\/api\/games\/([^/]+)\/(categories|cards\/copy)$/,
    async ({ request, env, user, params }) => {
      requireAdmin(
        user,
        'Sign in to manage decks.',
        'Administrator access required.',
      );
      const game = await activeGame(env, params[0]);
      await rateLimit(request, env, 'admin', 30);
      return params[1] === 'categories'
        ? renameCategory(request, env, game, user)
        : copyCards(request, env, game, user, validateCard);
    },
  ],
  [
    'POST',
    /^\/api\/games\/([^/]+)\/cards\/bulk$/,
    async ({ request, env, user, params }) => {
      const game = await activeGame(env, params[0]);
      requireAdmin(
        user,
        'Sign in to manage cards.',
        'This GitHub account cannot manage cards.',
      );
      await rateLimit(request, env, 'admin', 30);
      return bulk(request, env, game, user);
    },
  ],
  [
    'GET',
    /^\/api\/games\/([^/]+)\/cards$/,
    async ({ request, env, url, user, params }) => {
      const game = await activeGame(env, params[0]);
      const removed = url.searchParams.get('removed') === 'true';
      if (removed && !user?.isAdmin)
        fail(403, 'Administrator access required.');
      const identity = await actor(request, env, user, { issue: true });
      const { results } = await env.DB.prepare(
        `SELECT c.id,c.name AS Name,c.description AS Description,c.category AS Category,c.version,
        COALESCE(SUM(v.value=1),0) AS likes,COALESCE(SUM(v.value=-1),0) AS dislikes,
        COALESCE(MAX(CASE WHEN v.actor=? THEN v.value END),0) AS myVote
        FROM cards c LEFT JOIN votes v ON v.card_id=c.id WHERE c.game_id=? AND c.deleted_at IS ${removed ? 'NOT ' : ''}NULL
        GROUP BY c.id ORDER BY c.rowid`,
      )
        .bind(identity.id, game.id)
        .all();
      return cacheable(request, results, { 'Set-Cookie': identity.cookie });
    },
  ],
  [
    'POST',
    /^\/api\/cards\/([^/]+)\/vote$/,
    async ({ request, env, user, params }) => {
      if (env.FEEDBACK_REQUIRE_LOGIN === 'true' && !user)
        fail(401, 'Sign in to leave feedback.');
      if (!user && !feedbackConfigured(env))
        fail(503, 'Feedback is not configured yet.');
      await rateLimit(request, env, 'vote', 60);
      const data = await readBody(request);
      if (![1, -1, 0].includes(data?.value))
        fail(400, 'Vote must be like, dislike, or clear.');
      const id = decodeSegment(params[0]);
      // Votes need an identity issued earlier by a page load. Minting one per vote
      // would let a cookieless script vote again on every request.
      const identity = await actor(request, env, user);
      if (!identity.id) fail(403, 'Reload the page before leaving feedback.');
      // Condition checked inside the write too, so a concurrent removal cannot accept a vote.
      const write =
        data.value === 0
          ? statement(
              env,
              'DELETE FROM votes WHERE card_id=? AND actor=? AND EXISTS (SELECT 1 FROM cards c JOIN games g ON g.id=c.game_id WHERE c.id=? AND c.deleted_at IS NULL AND g.deleted_at IS NULL)',
              id,
              identity.id,
              id,
            )
          : statement(
              env,
              `INSERT INTO votes (card_id,actor,value) SELECT c.id,?,? FROM cards c JOIN games g ON g.id=c.game_id WHERE c.id=? AND c.deleted_at IS NULL AND g.deleted_at IS NULL
          ON CONFLICT(card_id,actor) DO UPDATE SET value=excluded.value`,
              identity.id,
              data.value,
              id,
            );
      const [, read] = await env.DB.batch([
        write,
        statement(
          env,
          `SELECT COALESCE(SUM(v.value=1),0) AS likes,COALESCE(SUM(v.value=-1),0) AS dislikes,
      COALESCE(MAX(CASE WHEN v.actor=? THEN v.value END),0) AS myVote FROM cards c LEFT JOIN votes v ON v.card_id=c.id
      WHERE c.id=? AND c.deleted_at IS NULL AND EXISTS (SELECT 1 FROM games WHERE id=c.game_id AND deleted_at IS NULL) GROUP BY c.id`,
          identity.id,
          id,
        ),
      ]);
      if (!read.results.length) fail(404, 'Card no longer available.');
      return json(read.results[0]);
    },
  ],
];

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
  if (!env.DB) fail(503, 'Database is not configured.');
  if (!['GET', 'POST'].includes(request.method))
    fail(405, 'Method not allowed.');
  if (request.method === 'POST') {
    const origin = request.headers.get('Origin');
    if (origin !== (env.APP_ORIGIN || url.origin))
      fail(403, 'Request origin is not allowed.');
  }
  if (
    request.method === 'GET' &&
    ['/api/auth/github', '/api/auth/github/callback'].includes(path)
  )
    return githubAuth(request, env, path);
  for (const [method, pattern, handler] of handlers) {
    const match = request.method === method && path.match(pattern);
    if (match) {
      const user = await session(request, env);
      return handler({ request, env, url, user, params: match.slice(1) });
    }
  }
  fail(404, 'Endpoint not found.');
}

export default {
  async fetch(request, env) {
    let response;
    try {
      response = await route(request, env);
    } catch (error) {
      if (!error.status) console.error('Worker request failed', error.message);
      response = json(
        {
          error: error.status
            ? error.message
            : 'Something went wrong. Please try again.',
        },
        error.status || 500,
      );
    }
    response = new Response(response.body, response);
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'same-origin');
    if (
      new URL(request.url).pathname.startsWith('/api/') &&
      !response.headers.has('Cache-Control')
    )
      response.headers.set('Cache-Control', 'no-store');
    return response;
  },
  async scheduled(_event, env) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(now()),
      env.DB.prepare('DELETE FROM oauth_states WHERE expires_at<=?').bind(
        now(),
      ),
      env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<=?').bind(now()),
    ]);
  },
};
