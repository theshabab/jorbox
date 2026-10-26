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

test('the copy with the most feedback is kept, then the oldest by natural ID order', () => {
  const ids = (cards) =>
    findDuplicateGroups(cards).map((group) => group.map((card) => card.id));
  assert.deepEqual(
    ids([
      { id: 'game1-10', Name: 'Same' },
      { id: 'game1-9', Name: 'Same' },
    ]),
    [['game1-9', 'game1-10']],
  );
  assert.deepEqual(
    ids([
      { id: 'game1-9', Name: 'Same', likes: 0, dislikes: 0 },
      { id: 'game1-10', Name: 'Same', likes: 2, dislikes: 1 },
    ]),
    [['game1-10', 'game1-9']],
  );
});
