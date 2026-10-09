import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('upgrade infers single-field formats without changing legacy cards, categories, or feedback', async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'migration',
          modules: true,
          script: 'export default { fetch() { return new Response("ok") } }',
          d1Databases: ['DB'],
        },
      ],
    }),
  );
  try {
    const db = await mf.getD1Database('DB');
    const migrate = async (file) =>
      db.exec(
        readFileSync(`worker/migrations/${file}`, 'utf8')
          .replace(/--[^\n]*/g, '')
          .replaceAll('\n', ' '),
      );
    await migrate('0001_initial.sql');
    for (const id of ['name', 'description', 'mixed', 'empty'])
      await db
        .prepare('INSERT INTO games (id,name,has_categories) VALUES (?,?,1)')
        .bind(id, id)
        .run();
    await db.batch([
      db.prepare(
        "INSERT INTO cards (id,game_id,name,description,category,deleted_at) VALUES ('n','name','Name','','General',unixepoch())",
      ),
      db.prepare(
        "INSERT INTO cards (id,game_id,name,description,category) VALUES ('d','description','','Text','General')",
      ),
      db.prepare(
        "INSERT INTO cards (id,game_id,name,description,category) VALUES ('m','mixed','Name','Text','General')",
      ),
      db.prepare(
        "INSERT INTO votes (card_id,actor,value) VALUES ('n','github:123',1)",
      ),
    ]);
    const before = (await db.prepare('SELECT * FROM cards ORDER BY id').all())
      .results;
    await migrate('0002_game_management.sql');
    assert.deepEqual(
      (await db.prepare('SELECT * FROM cards ORDER BY id').all()).results,
      before,
    );
    const games = (
      await db
        .prepare(
          'SELECT id,card_format,version,deleted_at FROM games ORDER BY id',
        )
        .all()
    ).results;
    assert.deepEqual(
      games.map((game) => [game.id, game.card_format]),
      [
        ['description', 'description'],
        ['empty', 'flexible'],
        ['mixed', 'flexible'],
        ['name', 'name'],
      ],
    );
    assert.ok(
      games.every((game) => game.version === 1 && game.deleted_at === null),
    );
    assert.equal(
      (
        await db
          .prepare('SELECT value FROM votes WHERE card_id=?')
          .bind('n')
          .first()
      ).value,
      1,
    );
  } finally {
    await mf.dispose();
  }
});
