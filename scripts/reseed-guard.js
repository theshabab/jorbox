// Refuses a reseed when the live database holds anything a fresh seed would
// destroy. Reads the JSON that `wrangler d1 execute --json` prints for the
// query in GUARD_QUERY and exits non-zero with the reasons.
import { readFileSync } from 'node:fs';

export const GUARD_QUERY = `SELECT
  (SELECT COUNT(*) FROM votes) AS votes,
  (SELECT COUNT(*) FROM suggestions) AS suggestions,
  (SELECT COUNT(*) FROM cards WHERE id NOT GLOB 'game[0-9]*-[0-9]*') AS added_cards,
  (SELECT COUNT(*) FROM cards WHERE id GLOB 'game[0-9]*-[0-9]*' AND (version > 1 OR deleted_at IS NOT NULL)) AS edited_cards`;

const LABELS = {
  votes: 'votes',
  suggestions: 'player suggestions',
  added_cards: 'cards added in the admin screens',
  edited_cards: 'seed cards that were edited or removed in the admin screens',
};

export function blockers(row) {
  return Object.entries(LABELS)
    .filter(([key]) => Number(row?.[key]) !== 0)
    .map(([key]) => `${row?.[key] ?? 'unknown'} ${LABELS[key]}`);
}

export function readRow(text) {
  const parsed = JSON.parse(text);
  return parsed?.[0]?.results?.[0];
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  const problems = blockers(readRow(readFileSync(0, 'utf8')));
  if (problems.length) {
    console.error(`Not reseeding. The database holds ${problems.join(', ')}.`);
    process.exit(1);
  }
  console.log('The database holds no votes, suggestions or hand edits.');
}
