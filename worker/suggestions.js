import { fail, json, readBody, statement } from './http.js';
import { CARD_LIMITS, cardErrors } from '../src/utils/cardFormats.js';

// A player may have at most this many suggestions waiting for review.
const MAX_PENDING_PER_PLAYER = 25;

const conflict = (error) => {
  if (String(error.message).includes('CHECK constraint failed'))
    fail(
      409,
      'This suggestion was already reviewed, or the game changed. Refresh and try again.',
    );
  throw error;
};

// Players suggest content only; the category is optional because players may
// not know the deck's categories. The administrator chooses one on accepting.
function validateSuggestion(row, game) {
  if (!row || typeof row !== 'object' || Array.isArray(row))
    fail(400, 'Invalid suggestion.');
  const card = {};
  for (const [field, limit] of Object.entries(CARD_LIMITS)) {
    const value = row[field] ?? '';
    if (typeof value !== 'string' || value.length > limit)
      fail(400, `${field} must be text of at most ${limit} characters.`);
    card[field] = value.trim();
  }
  if (!game.has_categories) card.Category = '';
  const [error] = cardErrors(
    { ...card, Category: '' },
    { cardFormat: game.card_format, hasCategories: false },
  );
  if (error) fail(400, `Invalid suggestion: ${error}`);
  return card;
}

export async function suggest(request, env, game, identity, user) {
  const data = await readBody(request);
  const card = validateSuggestion(data, game);
  const operation = crypto.randomUUID();
  // D1 batches are transactional: pin the validated game state, then check the
  // quota inside the insert so simultaneous submissions cannot both take slot 25.
  const [, inserted] = await env.DB.batch([
    statement(
      env,
      'INSERT INTO write_guards (id,valid) SELECT ?, CASE WHEN EXISTS (SELECT 1 FROM games WHERE id=? AND version=? AND deleted_at IS NULL) THEN 1 ELSE 0 END',
      operation,
      game.id,
      game.version,
    ),
    statement(
      env,
      `INSERT INTO suggestions (id,game_id,name,description,category,actor,login)
      SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM suggestions WHERE actor=? AND status='pending')<?`,
      crypto.randomUUID(),
      game.id,
      card.Name,
      card.Description,
      card.Category,
      identity,
      user?.login || '',
      identity,
      MAX_PENDING_PER_PLAYER,
    ),
    statement(env, 'DELETE FROM write_guards WHERE id=?', operation),
  ]).catch((error) => {
    if (String(error.message).includes('CHECK constraint failed'))
      fail(409, 'This game changed. Reload it before suggesting a card.');
    throw error;
  });
  if (!inserted.meta.changes)
    fail(
      429,
      'You have many suggestions waiting for review. Please try again later.',
    );
  return json({ ok: true }, 201);
}

export async function listSuggestions(env, url) {
  const status = url.searchParams.get('status') || 'pending';
  if (!['pending', 'accepted', 'rejected'].includes(status))
    fail(400, 'Unknown suggestion status.');
  const cursor = url.searchParams.get('before');
  const parts = cursor?.split(':');
  if (
    cursor !== null &&
    (parts.length !== 2 ||
      parts.some(
        (part) => !/^\d+$/.test(part) || !Number.isSafeInteger(Number(part)),
      ) ||
      Number(parts[1]) < 1)
  )
    fail(400, 'Invalid suggestion cursor.');
  const timestamp = parts ? Number(parts[0]) : null;
  const rowid = parts ? Number(parts[1]) : null;
  const pending = status === 'pending';
  const timeColumn = pending ? 's.created_at' : 's.reviewed_at';
  const comparison = pending ? '>' : '<';
  const direction = pending ? 'ASC' : 'DESC';
  const [list, count] = await env.DB.batch([
    statement(
      env,
      `SELECT s.rowid AS cursorRow,s.id,s.game_id AS gameId,g.name AS gameName,g.version AS gameVersion,s.name AS Name,s.description AS Description,
      s.category AS Category,s.login,s.status,s.created_at AS createdAt,s.reviewed_at AS reviewedAt,s.card_id AS cardId
      FROM suggestions s JOIN games g ON g.id=s.game_id WHERE g.deleted_at IS NULL AND s.status=?
      ${cursor === null ? '' : `AND (${timeColumn},s.rowid)${comparison}(?,?)`}
      ORDER BY ${timeColumn} ${direction},s.rowid ${direction} LIMIT 101`,
      status,
      ...(cursor === null ? [] : [timestamp, rowid]),
    ),
    statement(
      env,
      "SELECT COUNT(*) AS pending FROM suggestions s JOIN games g ON g.id=s.game_id WHERE g.deleted_at IS NULL AND s.status='pending'",
    ),
  ]);
  const page = list.results.slice(0, 100);
  const last = page.at(-1);
  return json({
    suggestions: page.map((row) => {
      const suggestion = { ...row };
      delete suggestion.cursorRow;
      return suggestion;
    }),
    pending: count.results[0].pending,
    nextCursor:
      list.results.length > 100
        ? `${pending ? last.createdAt : last.reviewedAt}:${last.cursorRow}`
        : null,
  });
}

export async function reviewSuggestion(request, env, id, user, validateCard) {
  const data = await readBody(request);
  if (!['accept', 'reject'].includes(data?.action))
    fail(400, 'Choose to accept or reject the suggestion.');
  const suggestion = await statement(
    env,
    `SELECT s.*,g.version AS game_version,g.card_format,g.has_categories,g.deleted_at AS game_deleted
    FROM suggestions s JOIN games g ON g.id=s.game_id WHERE s.id=?`,
    id,
  ).first();
  if (!suggestion || suggestion.game_deleted)
    fail(404, 'Suggestion not found.');
  if (suggestion.status !== 'pending')
    fail(409, 'This suggestion was already reviewed.');
  const operation = crypto.randomUUID();
  const before = {
    suggestion: id,
    Name: suggestion.name,
    Description: suggestion.description,
    Category: suggestion.category,
  };
  const statements = [
    statement(
      env,
      "INSERT INTO write_guards (id,valid) SELECT ?, CASE WHEN EXISTS (SELECT 1 FROM suggestions WHERE id=? AND status='pending') THEN 1 ELSE 0 END",
      operation,
      id,
    ),
    statement(
      env,
      'INSERT INTO write_guards (id,valid) SELECT ?, CASE WHEN EXISTS (SELECT 1 FROM games WHERE id=? AND version=? AND deleted_at IS NULL) THEN 1 ELSE 0 END',
      `${operation}:game`,
      suggestion.game_id,
      suggestion.game_version,
    ),
  ];
  let cardId = null;
  if (data.action === 'accept') {
    // The administrator may edit the card before accepting; it must fit the game.
    const game = {
      id: suggestion.game_id,
      card_format: suggestion.card_format,
      has_categories: suggestion.has_categories,
    };
    const card = validateCard(data.card, game);
    cardId = crypto.randomUUID();
    statements.push(
      statement(
        env,
        'INSERT INTO audit_log (id,github_id,login,game_id,action,details) VALUES (?,?,?,?,?,?)',
        operation,
        user.github_id,
        user.login,
        game.id,
        'suggestion:accept',
        JSON.stringify({ cards: [{ ...card, id: cardId }], before }),
      ),
      statement(
        env,
        'INSERT INTO cards (id,game_id,name,description,category) VALUES (?,?,?,?,?)',
        cardId,
        game.id,
        card.Name,
        card.Description,
        card.Category,
      ),
    );
  } else {
    statements.push(
      statement(
        env,
        'INSERT INTO audit_log (id,github_id,login,game_id,action,details) VALUES (?,?,?,?,?,?)',
        operation,
        user.github_id,
        user.login,
        suggestion.game_id,
        'suggestion:reject',
        JSON.stringify({ before }),
      ),
    );
  }
  statements.push(
    statement(
      env,
      'UPDATE suggestions SET status=?,reviewed_at=unixepoch(),card_id=? WHERE id=?',
      data.action === 'accept' ? 'accepted' : 'rejected',
      cardId,
      id,
    ),
    statement(
      env,
      'DELETE FROM write_guards WHERE id IN (?,?)',
      operation,
      `${operation}:game`,
    ),
  );
  await env.DB.batch(statements).catch(conflict);
  return json({
    status: data.action === 'accept' ? 'accepted' : 'rejected',
    cardId,
  });
}
