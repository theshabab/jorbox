import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicateGroups } from '../src/utils/duplicates.js';

test('duplicate detection normalizes whitespace, case and compatibility characters, but retains categories', () => {
  const cards = [
    {
      id: 'a',
      Name: 'Question',
      Description: 'One\n prompt',
      Category: 'General',
    },
    {
      id: 'b',
      Name: ' ＱＵＥＳＴＩＯＮ ',
      Description: 'one prompt',
      Category: 'general',
    },
    { id: 'c', Name: 'Question', Description: 'one prompt', Category: 'Other' },
    {
      id: 'd',
      Name: 'Question',
      Description: 'different prompt',
      Category: 'General',
    },
    { id: 'e', Description: 'Description only' },
    { id: 'f', Description: ' description ONLY ' },
  ];
  assert.deepEqual(
    findDuplicateGroups(cards).map((group) => group.map((card) => card.id)),
    [
      ['a', 'b'],
      ['e', 'f'],
    ],
  );
  assert.equal(cards[0].Description, 'One\n prompt');
});

test('duplicate keeper and extra selection remain deterministic across shuffled deck loads', () => {
  const cards = [
    { id: 'b', Name: 'Same' },
    { id: 'a', Name: 'Same' },
    { id: 'c', Name: 'Other' },
  ];
  assert.deepEqual(
    findDuplicateGroups(cards).map((group) => group.map((card) => card.id)),
    [['a', 'b']],
  );
  assert.deepEqual(
    findDuplicateGroups([...cards].reverse()).map((group) =>
      group.map((card) => card.id),
    ),
    [['a', 'b']],
  );
  assert.deepEqual(findDuplicateGroups([]), []);
});
