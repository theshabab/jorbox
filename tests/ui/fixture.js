import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import worker from '../../worker/index.js';
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

// Applies the `/*` block of dist/_headers (CSP and friends) to static responses,
// so browser tests run under the same policy as production.
function staticHeaders(root) {
  const headers = {};
  let inBlock = false;
  for (const line of readFileSync(resolve(root, '_headers'), 'utf8').split(
    '\n',
  )) {
    if (!line.trim() || line.startsWith('#')) continue;
    if (!/^\s/.test(line)) inBlock = line.trim() === '/*';
    else if (inBlock) {
      const i = line.indexOf(':');
      headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return headers;
}

export async function startFixture({ seed = false } = {}) {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'ui-test',
          modules: true,
          script: 'export default { fetch() { return new Response("ok") } }',
          d1Databases: ['DB'],
        },
      ],
    }),
  );
  const db = await mf.getD1Database('DB');
  for (const file of [
    '0001_initial.sql',
    '0002_game_management.sql',
    '0003_admin_reports.sql',
  ])
    await db.exec(
      readFileSync(resolve(repositoryRoot, 'worker/migrations', file), 'utf8')
        .replace(/--[^\n]*/g, '')
        .replaceAll('\n', ' '),
    );
  const tokenHash = Buffer.from(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('local-ui-test'),
    ),
  ).toString('base64url');
  await db.batch([
    db
      .prepare(
        'INSERT INTO games (id,name,has_categories,card_format) VALUES (?,?,?,?)',
      )
      .bind('demo', 'Demo Deck', 0, 'flexible'),
    db
      .prepare(
        'INSERT INTO cards (id,game_id,name,description) VALUES (?,?,?,?)',
      )
      .bind('demo1', 'demo', 'First card', 'First prompt'),
    db
      .prepare(
        'INSERT INTO cards (id,game_id,name,description) VALUES (?,?,?,?)',
      )
      .bind('demo2', 'demo', 'Second card', 'Second prompt'),
    db
      .prepare(
        'INSERT INTO sessions (token_hash,github_id,login,expires_at) VALUES (?,?,?,?)',
      )
      .bind(tokenHash, '48080916', 'thehaseebshah', 9999999999),
  ]);
  if (seed) {
    // The real 19,420-card baseline, for realistic layout and performance checks.
    const lines = readFileSync(
      resolve(repositoryRoot, 'worker/seed.sql'),
      'utf8',
    )
      .split('\n')
      .filter((line) => line.startsWith('INSERT'));
    for (let i = 0; i < lines.length; i += 500)
      await db.batch(lines.slice(i, i + 500).map((line) => db.prepare(line)));
  }
  let origin;
  const env = {
    DB: db,
    ADMIN_GITHUB_IDS: '48080916',
    COOKIE_SECRET: 'local-test-cookie-secret-'.repeat(3),
    get APP_ORIGIN() {
      return origin;
    },
    ASSETS: {
      fetch(request) {
        const root = resolve(repositoryRoot, 'dist');
        const security = staticHeaders(root);
        const path = new URL(request.url).pathname;
        const file = resolve(root, path.slice(1));
        if (!file.startsWith(root + '/'))
          return new Response(readFileSync(root + '/index.html'), {
            headers: { 'Content-Type': 'text/html', ...security },
          });
        try {
          return new Response(readFileSync(file), {
            headers: {
              'Content-Type':
                {
                  '.js': 'application/javascript',
                  '.css': 'text/css',
                  '.svg': 'image/svg+xml',
                  '.html': 'text/html',
                }[extname(file)] || 'application/octet-stream',
              ...security,
            },
          });
        } catch {
          return new Response(readFileSync(root + '/index.html'), {
            headers: { 'Content-Type': 'text/html', ...security },
          });
        }
      },
    },
  };
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const response = await worker.fetch(
        new Request(`${origin}${req.url}`, {
          method: req.method,
          headers: req.headers,
          ...(body.length ? { body } : {}),
        }),
        env,
      );
      res.statusCode = response.status;
      for (const [key, value] of response.headers)
        if (key !== 'set-cookie') res.setHeader(key, value);
      const cookies = response.headers.getSetCookie();
      if (cookies.length) res.setHeader('set-cookie', cookies);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error(error);
      res.statusCode = 500;
      res.end('Test server failed');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    db,
    stop: async () => {
      await new Promise((resolve) => server.close(resolve));
      await mf.dispose();
    },
  };
}
