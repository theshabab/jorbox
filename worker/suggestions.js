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
  const { pending } = await statement(
    env,
    "SELECT COUNT(*) AS pending FROM suggestions WHERE actor=? AND status='pending'",
    identity,
  ).first();
  if (pending >= MAX_PENDING_PER_PLAYER)
    fail(
      429,
      'You have many suggestions waiting for review. Please try again later.',
    );
  await statement(
    env,
    'INSERT INTO suggestions (id,game_id,name,description,category,actor,login) VALUES (?,?,?,?,?,?,?)',
    crypto.randomUUID(),
    game.id,
    card.Name,
    card.Description,
    card.Category,
    identity,
    user?.login || '',
  ).run();
  return json({ ok: true }, 201);
}

export async function listSuggestions(env, url) {
  const status = url.searchParams.get('status') || 'pending';
  if (!['pending', 'accepted', 'rejected'].includes(status))
    fail(400, 'Unknown suggestion status.');
  const [list, count] = await env.DB.batch([
    statement(
      env,
      `SELECT s.id,s.game_id AS gameId,g.name AS gameName,g.version AS gameVersion,s.name AS Name,s.description AS Description,
      s.category AS Category,s.login,s.status,s.created_at AS createdAt,s.reviewed_at AS reviewedAt,s.card_id AS cardId
      FROM suggestions s JOIN games g ON g.id=s.game_id WHERE g.deleted_at IS NULL AND s.status=?
      ORDER BY ${status === 'pending' ? 's.created_at ASC' : 's.reviewed_at DESC'} LIMIT 100`,
      status,
    ),
    statement(
      env,
      "SELECT COUNT(*) AS pending FROM suggestions s JOIN games g ON g.id=s.game_id WHERE g.deleted_at IS NULL AND s.status='pending'",
    ),
  ]);
  return json({ suggestions: list.results, pending: count.results[0].pending });
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
        'INSERT INTO write_guards (id,valid) SELECT ?, CASE WHEN EXISTS (SELECT 1 FROM games WHERE id=? AND version=? AND deleted_at IS NULL) THEN 1 ELSE 0 END',
        `${operation}:game`,
        game.id,
        suggestion.game_version,
      ),
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
