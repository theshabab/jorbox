import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { parseCardCsv, exportCardCsv } from '../src/utils/cardCsv.js';

test('CSV supports description-only, name-only, quoted multiline, and edit IDs', () => {
  const game = { hasCategories: false };
  assert.deepEqual(parseCardCsv('Description\nOne\nTwo', game, 'import').errors, []);
  assert.deepEqual(parseCardCsv('Name\nOne\nTwo', game, 'import').errors, []);
  const cards = [{ id: 'a', version: 3, Name: 'A, B', Description: 'Line 1\nLine 2', Category: '', likes: 2, dislikes: 1 }];
  const parsed = parseCardCsv(exportCardCsv(cards), game, 'edit');
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.cards[0], { id: 'a', version: 3, Name: 'A, B', Description: 'Line 1\nLine 2', Category: '' });
});

test('invalid CSV gives actionable errors before an import can be applied', () => {
  const game = { hasCategories: true };
  assert.ok(parseCardCsv('Name\nOne', game, 'import').errors.some(value => value.includes('category is required')));
  assert.ok(parseCardCsv('Name,Category\nOne,Test', game, 'edit').errors.some(value => value.includes('id and version')));
  assert.ok(parseCardCsv('Name,Category,Unknown\nOne,Test,x', game, 'import').errors.some(value => value.includes('Unknown column')));
  assert.ok(parseCardCsv('Name,Category\n"broken', game, 'import').errors.length);
});

test('all 16 original decks remain in the generated seed, including all partial shapes', () => {
  const games = JSON.parse(readFileSync('public/games.json', 'utf8'));
  const seed = readFileSync('worker/seed.sql', 'utf8');
  assert.equal(games.length, 16);
  let count = 0;
  for (const game of games) {
    const parsed = Papa.parse(readFileSync(`public${game.csv}`, 'utf8'), { header: true, delimiter: ',', skipEmptyLines: 'greedy' });
    assert.deepEqual(parsed.errors, []);
    parsed.data.forEach((row, index) => {
      assert.ok(row.Name?.trim() || row.Description?.trim());
      assert.ok(seed.includes(`VALUES ('${game.id}-${index + 1}',`));
      count++;
    });
  }
  assert.equal((seed.match(/INSERT OR IGNORE INTO cards/g) || []).length, count);
  assert.equal(count, 19420);
});
