import { fail, json, readBody, statement } from './http.js';
import { CARD_LIMITS, MAX_BULK_ROWS } from '../src/utils/cardFormats.js';

async function commit(env, statements) {
  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (String(error.message).includes('CHECK constraint failed'))
      fail(409, 'The deck changed. Refresh and review this operation again.');
    throw error;
  }
}
const gameGuard = (env, operation, game) =>
  statement(
    env,
    'INSERT INTO write_guards (id,valid) SELECT ?, CASE WHEN EXISTS (SELECT 1 FROM games WHERE id=? AND version=? AND deleted_at IS NULL) THEN 1 ELSE 0 END',
    operation,
    game.id,
    game.version,
  );

export async function copyCards(request, env, source, user, validateCard) {
  const data = await readBody(request);
  if (
    !Array.isArray(data?.cards) ||
    !data.cards.length ||
    data.cards.length > MAX_BULK_ROWS
  )
    fail(400, `Select between 1 and ${MAX_BULK_ROWS} cards to copy.`);
  if (data.sourceVersion !== source.version)
    fail(409, 'Source game changed. Refresh before copying.');
  if (
    typeof data.targetId !== 'string' ||
    data.targetId === source.id ||
    !Number.isSafeInteger(data.targetVersion)
  )
    fail(400, 'Choose another game to copy into.');
  if (
    data.category !== undefined &&
    (typeof data.category !== 'string' ||
      data.category.length > CARD_LIMITS.Category)
  )
    fail(
      400,
      `Choose a category of at most ${CARD_LIMITS.Category} characters.`,
    );
  const target = await statement(
    env,
    'SELECT * FROM games WHERE id=? AND deleted_at IS NULL',
    data.targetId,
  ).first();
  if (!target) fail(404, 'Destination game not found.');
  if (target.version !== data.targetVersion)
    fail(409, 'Destination game changed. Refresh the game list.');
  const expected = data.cards.map((row) => {
    if (
      !row ||
      typeof row.id !== 'string' ||
      !row.id ||
      !Number.isSafeInteger(row.version) ||
      row.version < 1
    )
      fail(400, 'Each source card needs its ID and version.');
    return { id: row.id, version: row.version };
  });
  if (new Set(expected.map((row) => row.id)).size !== expected.length)
    fail(400, 'A source card can only appear once.');
  const expectedJson = JSON.stringify(expected);
  const { results } = await statement(
    env,
    `SELECT c.id,c.version,c.name AS Name,c.description AS Description,c.category AS Category FROM cards c JOIN json_each(?) j ON c.id=json_extract(j.value,'$.id') WHERE c.game_id=? AND c.deleted_at IS NULL`,
    expectedJson,
    source.id,
  ).all();
  if (
    results.length !== expected.length ||
    results.some(
      (row) =>
        expected.find((item) => item.id === row.id).version !== row.version,
    )
  )
    fail(409, 'Some source cards changed. Refresh before copying.');
  const copies = results.map((row) => ({
    ...validateCard(
      {
        ...row,
        Category: target.has_categories
          ? data.category?.trim() || row.Category
          : '',
      },
      target,
    ),
    id: crypto.randomUUID(),
    sourceId: row.id,
  }));
  const operation = crypto.randomUUID();
  const statements = [
    gameGuard(env, `${operation}:source`, source),
    gameGuard(env, `${operation}:target`, target),
    statement(
      env,
      `INSERT INTO write_guards (id,valid) SELECT ?, CASE WHEN (SELECT COUNT(*) FROM cards c JOIN json_each(?) j ON c.id=json_extract(j.value,'$.id') WHERE c.game_id=? AND c.deleted_at IS NULL AND c.version=json_extract(j.value,'$.version'))=? THEN 1 ELSE 0 END`,
      operation,
      expectedJson,
      source.id,
      expected.length,
    ),
    ...copies.map((row) =>
      statement(
        env,
        'INSERT INTO cards (id,game_id,name,description,category) VALUES (?,?,?,?,?)',
        row.id,
        target.id,
        row.Name,
        row.Description,
        row.Category,
      ),
    ),
    statement(
      env,
      'INSERT INTO audit_log (id,github_id,game_id,action,details) VALUES (?,?,?,?,?)',
      operation,
      user.github_id,
      target.id,
      'copy',
      JSON.stringify({ sourceGameId: source.id, cards: copies }),
    ),
    ...[operation, `${operation}:source`, `${operation}:target`].map((id) =>
      statement(env, 'DELETE FROM write_guards WHERE id=?', id),
    ),
  ];
  await commit(env, statements);
  return json(
    { changed: copies.length, ids: copies.map((row) => row.id) },
    201,
  );
}

export async function categories(env, game) {
  if (!game.has_categories) fail(400, 'This game does not use categories.');
  // A D1 batch gives the review counts and audit revision a consistent snapshot.
  const [list, revision] = await env.DB.batch([
    statement(
      env,
      'SELECT category AS name,SUM(deleted_at IS NULL) AS active,SUM(deleted_at IS NOT NULL) AS removed,COUNT(*) AS total FROM cards WHERE game_id=? GROUP BY category ORDER BY category COLLATE NOCASE',
      game.id,
    ),
    statement(
      env,
      'SELECT COALESCE(MAX(rowid),0) AS revision FROM audit_log WHERE game_id=?',
      game.id,
    ),
  ]);
  return json({
    categories: list.results,
    revision: revision.results[0].revision,
    gameVersion: game.version,
  });
}

export async function renameCategory(request, env, game, user) {
  if (!game.has_categories) fail(400, 'This game does not use categories.');
  const data = await readBody(request);
  if (
    !data ||
    typeof data.from !== 'string' ||
    !data.from.trim() ||
    data.from.length > CARD_LIMITS.Category ||
    typeof data.to !== 'string' ||
    !data.to.trim() ||
    data.to.length > CARD_LIMITS.Category ||
    data.from === data.to.trim()
  )
    fail(
      400,
      'Choose different non-empty source and destination categories (at most 200 characters).',
    );
  if (
    !Number.isSafeInteger(data.revision) ||
    data.revision < 0 ||
    data.gameVersion !== game.version ||
    !Number.isSafeInteger(data.expectedCount) ||
    data.expectedCount < 1
  )
    fail(409, 'Refresh the categories before reviewing this change.');
  const operation = crypto.randomUUID();
  await commit(env, [
    gameGuard(env, `${operation}:game`, game),
    statement(
      env,
      `INSERT INTO write_guards (id,valid) SELECT ?, CASE WHEN (SELECT COALESCE(MAX(rowid),0) FROM audit_log WHERE game_id=?)=? AND (SELECT COUNT(*) FROM cards WHERE game_id=? AND category=?)=? THEN 1 ELSE 0 END`,
      operation,
      game.id,
      data.revision,
      game.id,
      data.from,
      data.expectedCount,
    ),
    statement(
      env,
      'UPDATE cards SET category=?,version=version+1,updated_at=unixepoch() WHERE game_id=? AND category=?',
      data.to.trim(),
      game.id,
      data.from,
    ),
    statement(
      env,
      'INSERT INTO audit_log (id,github_id,game_id,action,details) VALUES (?,?,?,?,?)',
      operation,
      user.github_id,
      game.id,
      'category:rename',
      JSON.stringify({
        from: data.from,
        to: data.to.trim(),
        changed: data.expectedCount,
      }),
    ),
    statement(
      env,
      'DELETE FROM write_guards WHERE id IN (?,?)',
      operation,
      `${operation}:game`,
    ),
  ]);
  return json({ changed: data.expectedCount });
}

export async function activity(env, url) {
  const gameId = url.searchParams.get('game') || '';
  const before = url.searchParams.get('before');
  if (
    before !== null &&
    (!/^\d+$/.test(before) ||
      !Number.isSafeInteger(Number(before)) ||
      Number(before) < 1)
  )
    fail(400, 'Invalid activity cursor.');
  const { results } = await statement(
    env,
    `SELECT a.rowid AS cursor,a.id,a.github_id AS actorId,a.game_id AS gameId,g.name AS gameName,a.action,a.created_at AS createdAt,a.details FROM audit_log a LEFT JOIN games g ON g.id=a.game_id WHERE (?='' OR a.game_id=?) AND (? IS NULL OR a.rowid<?) ORDER BY a.rowid DESC LIMIT 51`,
    gameId,
    gameId,
    before ? Number(before) : null,
    before ? Number(before) : null,
  ).all();
  const entries = results.slice(0, 50).map((row) => {
    let details;
    try {
      details = JSON.parse(row.details);
    } catch {
      details = {};
    }
    // Expose only operation context, not saved card content or identity/session records.
    return {
      cursor: row.cursor,
      id: row.id,
      actorId: row.actorId,
      gameId: row.gameId,
      gameName: row.gameName,
      action: row.action,
      createdAt: row.createdAt,
      changed: Array.isArray(details)
        ? details.length
        : Array.isArray(details?.cards)
          ? details.cards.length
          : details?.changed || 1,
      ...(row.action === 'category:rename'
        ? { from: details.from, to: details.to }
        : {}),
    };
  });
  return json({
    entries,
    nextCursor: results.length > 50 ? entries.at(-1).cursor : null,
  });
}

export async function feedbackOverview(env, url) {
  const gameId = url.searchParams.get('game') || '';
  // One statement aggregates every card once; the totals and both leaderboards
  // read the same materialized result instead of repeating the vote join.
  const { results } = await statement(
    env,
    `WITH agg AS MATERIALIZED (
      SELECT c.id,c.game_id AS gameId,g.name AS gameName,c.name AS Name,c.description AS Description,c.category AS Category,
        COUNT(v.actor) AS votes,COALESCE(SUM(v.value=1),0) AS likes,COALESCE(SUM(v.value=-1),0) AS dislikes
      FROM cards c JOIN games g ON g.id=c.game_id LEFT JOIN votes v ON v.card_id=c.id
      WHERE g.deleted_at IS NULL AND c.deleted_at IS NULL AND (?='' OR g.id=?) GROUP BY c.id
    )
    SELECT 'summary' AS kind,NULL AS id,NULL AS gameId,NULL AS gameName,NULL AS Name,NULL AS Description,NULL AS Category,NULL AS votes,NULL AS likes,NULL AS dislikes,
      COUNT(*) AS cards,COALESCE(SUM(votes>0),0) AS ratedCards,COALESCE(SUM(likes),0) AS totalLikes,COALESCE(SUM(dislikes),0) AS totalDislikes FROM agg
    UNION ALL SELECT * FROM (SELECT 'disliked',*,NULL,NULL,NULL,NULL FROM agg WHERE dislikes>0 ORDER BY dislikes DESC,likes ASC,id LIMIT 10)
    UNION ALL SELECT * FROM (SELECT 'liked',*,NULL,NULL,NULL,NULL FROM agg WHERE likes>0 ORDER BY likes DESC,dislikes ASC,id LIMIT 10)`,
    gameId,
    gameId,
  ).all();
  const totals = results.find((row) => row.kind === 'summary');
  const card = (row) => ({
    id: row.id,
    gameId: row.gameId,
    gameName: row.gameName,
    Name: row.Name,
    Description: row.Description,
    Category: row.Category,
    votes: row.votes,
    likes: row.likes,
    dislikes: row.dislikes,
  });
  return json({
    summary: {
      cards: totals.cards,
      ratedCards: totals.ratedCards,
      unratedCards: totals.cards - totals.ratedCards,
      likes: totals.totalLikes,
      dislikes: totals.totalDislikes,
    },
    disliked: results.filter((row) => row.kind === 'disliked').map(card),
    liked: results.filter((row) => row.kind === 'liked').map(card),
  });
}
