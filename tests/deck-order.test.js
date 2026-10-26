import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import {
  deckOrder,
  loadPosition,
  savePosition,
} from '../src/utils/deckOrder.js';

let values;
const previousStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  'sessionStorage',
);
beforeEach(() => {
  values = new Map();
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  });
});
afterEach(() => {
  if (previousStorage)
    Object.defineProperty(globalThis, 'sessionStorage', previousStorage);
  else delete globalThis.sessionStorage;
});
const cards = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

test('malformed saved decks recover without losing available cards', () => {
  for (const saved of [
    null,
    'old-format',
    [],
    { order: {} },
    { order: 3, positions: [] },
  ]) {
    values.set('jorbox:deck:demo', JSON.stringify(saved));
    assert.deepEqual(
      new Set(deckOrder('demo', cards)),
      new Set(['a', 'b', 'c']),
    );
  }
});

test('saved order deduplicates IDs and discards removed cards', () => {
  values.set(
    'jorbox:deck:demo',
    JSON.stringify({ order: ['b', 'b', 'gone', 'a', null] }),
  );
  assert.deepEqual(deckOrder('demo', cards), ['b', 'a', 'c']);
});

test('positions survive an updated deck and reshuffle clears them', () => {
  deckOrder('demo', cards);
  savePosition('demo', null, 'b');
  savePosition('demo', 'animals', 'c');
  deckOrder('demo', cards);
  assert.equal(loadPosition('demo', null), 'b');
  assert.equal(loadPosition('demo', 'animals'), 'c');
  deckOrder('demo', cards, true);
  assert.equal(loadPosition('demo', null), null);
});

test('positions use own string properties even for unusual category names', () => {
  values.set(
    'jorbox:deck:demo',
    JSON.stringify({ order: [], positions: { animals: {} } }),
  );
  assert.equal(loadPosition('demo', 'animals'), null);
  assert.equal(loadPosition('demo', 'toString'), null);
  savePosition('demo', '__proto__', 'a');
  assert.equal(loadPosition('demo', '__proto__'), 'a');
});
