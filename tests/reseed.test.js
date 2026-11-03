import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { blockers, readRow } from '../scripts/reseed-guard.js';

const clean = { votes: 0, suggestions: 0, added_cards: 0, edited_cards: 0 };

test('the reseed guard passes an untouched database', () => {
  assert.deepEqual(blockers(clean), []);
});

test('the reseed guard names everything a fresh seed would destroy', () => {
  const found = blockers({
    votes: 2,
    suggestions: 1,
    added_cards: 3,
    edited_cards: 4,
  });
  assert.equal(found.length, 4);
  assert.match(found[0], /2 votes/);
});

test('the reseed guard refuses when the answer is missing or malformed', () => {
  assert.notDeepEqual(blockers(undefined), []);
  assert.notDeepEqual(blockers({ votes: 0 }), []);
  assert.deepEqual(
    readRow(
      '[{"results":[{"votes":0,"suggestions":0,"added_cards":0,"edited_cards":0}]}]',
    ),
    clean,
  );
});

test('the reseed workflow runs by hand on main only and needs the confirmation word', () => {
  const workflow = readFileSync('.github/workflows/reseed.yml', 'utf8');
  assert.match(workflow, /on:\s+workflow_dispatch:/);
  assert.match(workflow, /refs\/heads\/main/);
  assert.match(workflow, /inputs\.confirm == 'RESEED'/);
  assert.doesNotMatch(workflow, /\n\s+push:/);
  assert.ok(
    workflow.indexOf('reseed-guard.js') <
      workflow.indexOf('--file=worker/reseed.sql'),
    'the guard must run before the reseed',
  );
});
