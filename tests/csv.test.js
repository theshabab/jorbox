import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { parseCardCsv, exportCardCsv } from '../src/utils/cardCsv.js';

test('CSV supports description-only, name-only, quoted multiline, and edit IDs', () => {
  const game = { hasCategories: false };
  assert.deepEqual(
    parseCardCsv('Description\nOne\nTwo', game, 'import').errors,
    [],
  );
  assert.deepEqual(parseCardCsv('Name\nOne\nTwo', game, 'import').errors, []);
  const cards = [
    {
      id: 'a',
      version: 3,
      Name: 'A, B',
      Description: 'Line 1\nLine 2',
      Category: '',
      likes: 2,
      dislikes: 1,
    },
  ];
  const parsed = parseCardCsv(exportCardCsv(cards), game, 'edit');
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.cards[0], {
    id: 'a',
    version: 3,
    Name: 'A, B',
    Description: 'Line 1\nLine 2',
    Category: '',
  });
});

test('invalid CSV gives actionable errors before an import can be applied', () => {
  const game = { hasCategories: true };
  assert.ok(
    parseCardCsv('Name\nOne', game, 'import').errors.some((value) =>
      value.includes('category is required'),
    ),
  );
  assert.ok(
    parseCardCsv('Name,Category\nOne,Test', game, 'edit').errors.some((value) =>
      value.includes('id and version'),
    ),
  );
  assert.ok(
    parseCardCsv(
      'Name,Category,Unknown\nOne,Test,x',
      game,
      'import',
    ).errors.some((value) => value.includes('Unknown column')),
  );
  assert.ok(
    parseCardCsv('Name,Category\n"broken', game, 'import').errors.length,
  );
});

test('all 16 original decks remain in the generated seed, including all partial shapes', () => {
  const games = JSON.parse(readFileSync('data/seed/games.json', 'utf8'));
  const seed = readFileSync('worker/seed.sql', 'utf8');
  assert.equal(games.length, 16);
  let count = 0;
  for (const game of games) {
    const parsed = Papa.parse(readFileSync(`data/seed${game.csv}`, 'utf8'), {
      header: true,
      delimiter: ',',
      skipEmptyLines: 'greedy',
    });
    assert.deepEqual(parsed.errors, []);
    parsed.data.forEach((row, index) => {
      assert.ok(row.Name?.trim() || row.Description?.trim());
      assert.ok(seed.includes(`VALUES ('${game.id}-${index + 1}',`));
      count++;
    });
  }
  assert.equal(
    (seed.match(/INSERT OR IGNORE INTO cards/g) || []).length,
    count,
  );
  assert.equal(count, 17177);
});

test('CSV feedback round-trips personal votes and validates values and identities', () => {
  const cards = [
    {
      id: 'a',
      version: 2,
      Name: 'A',
      Description: '',
      Category: '',
      likes: 9,
      dislikes: 4,
      myVote: -1,
    },
  ];
  const parsed = parseCardCsv(
    exportCardCsv(cards),
    { hasCategories: false },
    'feedback',
  );
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.cards[0].value, -1);
  assert.deepEqual(
    parseCardCsv('id,version,myVote\na,2,0', {}, 'feedback').errors,
    [],
  );
  for (const csv of [
    'id,version,myVote\na,2,2',
    'id,version,myVote\na,2,',
    'id,version,myVote\na,2,1\na,2,-1',
    'id,version\na,2',
  ]) {
    assert.ok(parseCardCsv(csv, {}, 'feedback').errors.length > 0);
  }
});

test('CSV follows each configured card format before upload', () => {
  assert.deepEqual(
    parseCardCsv('Name\nOne', { cardFormat: 'name' }, 'import').errors,
    [],
  );
  assert.ok(
    parseCardCsv('Name,Description\nOne,Text', { cardFormat: 'name' }, 'import')
      .errors.length,
  );
  assert.deepEqual(
    parseCardCsv('Description\nText', { cardFormat: 'description' }, 'import')
      .errors,
    [],
  );
  assert.ok(
    parseCardCsv('Name\nOne', { cardFormat: 'description' }, 'import').errors
      .length,
  );
  assert.ok(
    parseCardCsv('Name\nOne', { cardFormat: 'name-description' }, 'import')
      .errors.length,
  );
});

test('export/import round trips keep text that starts like a spreadsheet formula', () => {
  const game = { hasCategories: false };
  const cards = [
    { id: 'a', version: 1, Name: '-40', Description: '=SUM(1)', Category: '' },
    {
      id: 'b',
      version: 2,
      Name: '+1 point',
      Description: '@everyone',
      Category: '',
    },
  ];
  const csv = exportCardCsv(cards);
  assert.match(csv, /'-40/); // Still protected when opened in a spreadsheet.
  const parsed = parseCardCsv(csv, game, 'edit');
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(
    parsed.cards.map((card) => [card.Name, card.Description]),
    [
      ['-40', '=SUM(1)'],
      ['+1 point', '@everyone'],
    ],
  );
});

test('semicolon CSVs from regional spreadsheet settings are accepted', () => {
  const parsed = parseCardCsv(
    'Name;Description\nKarachi;City, by the sea',
    { hasCategories: false },
    'import',
  );
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.cards[0], {
    Name: 'Karachi',
    Description: 'City, by the sea',
    Category: '',
  });
  // A comma header keeps semicolons inside text intact.
  assert.equal(
    parseCardCsv('Name\nA; B', { hasCategories: false }, 'import').cards[0]
      .Name,
    'A; B',
  );
});
