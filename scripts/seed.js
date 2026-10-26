import { readFileSync, writeFileSync } from 'node:fs';
import Papa from 'papaparse';

const quote = (value) => `'${String(value ?? '').replaceAll("'", "''")}'`;
const games = JSON.parse(readFileSync('data/seed/games.json', 'utf8'));
const sql = [
  '-- One-time baseline import. Existing cards and later edits are never overwritten.',
];
let count = 0;
for (const game of games) {
  sql.push(
    `INSERT OR IGNORE INTO games (id,name,has_categories) VALUES (${quote(game.id)},${quote(game.name)},${Number(game.hasCategories)});`,
  );
  const parsed = Papa.parse(readFileSync(`data/seed${game.csv}`, 'utf8'), {
    header: true,
    delimiter: ',',
    skipEmptyLines: 'greedy',
  });
  if (parsed.errors.length)
    throw new Error(`${game.id}: ${JSON.stringify(parsed.errors)}`);
  parsed.data.forEach((card, index) => {
    if (!card.Name?.trim() && !card.Description?.trim())
      throw new Error(`${game.id} row ${index + 2} is empty`);
    sql.push(
      `INSERT OR IGNORE INTO cards (id,game_id,name,description,category) VALUES (${quote(`${game.id}-${index + 1}`)},${quote(game.id)},${quote(card.Name)},${quote(card.Description)},${quote(game.hasCategories ? card.Category : '')});`,
    );
    count++;
  });
}
writeFileSync('worker/seed.sql', `${sql.join('\n')}\n`);
console.log(`Prepared ${count} cards across ${games.length} games.`);
