// Builds worker/reseed.sql: clears the cards of the seed games and loads the
// current seed. Only run it through the guarded "Reseed production" workflow
// (or locally), because it removes the cards, votes and suggestions of those
// games. Run `npm run db:generate-seed` first so worker/seed.sql is current.
import { readFileSync, writeFileSync } from 'node:fs';

const quote = (value) => `'${String(value ?? '').replaceAll("'", "''")}'`;
const games = JSON.parse(readFileSync('data/seed/games.json', 'utf8'));
const seed = readFileSync('worker/seed.sql', 'utf8');
const ids = games.map((game) => quote(game.id)).join(',');

const sql = [
  '-- Fresh start: remove the cards, votes and suggestions of the seed games,',
  '-- apply the seed game settings, then load the seed below.',
  `DELETE FROM votes WHERE card_id IN (SELECT id FROM cards WHERE game_id IN (${ids}));`,
  `DELETE FROM suggestions WHERE game_id IN (${ids});`,
  `DELETE FROM cards WHERE game_id IN (${ids});`,
  ...games.map(
    (game) =>
      `UPDATE games SET name=${quote(game.name)},has_categories=${Number(game.hasCategories)},reveal_description=${Number(game.revealDescription === true)},version=version+1,deleted_at=NULL WHERE id=${quote(game.id)};`,
  ),
  "INSERT INTO audit_log (id,github_id,game_id,action,details,login) VALUES (lower(hex(randomblob(8))),'system','all','reseed','{\"source\":\"seed\"}','system');",
  seed,
];
writeFileSync('worker/reseed.sql', sql.join('\n'));
console.log(`Prepared worker/reseed.sql for ${games.length} games.`);
