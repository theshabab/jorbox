import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { startFixture } from './fixture.js';

let fixture;
let browser;
before(async () => {
  fixture = await startFixture();
  await fixture.db
    .prepare('UPDATE games SET reveal_description = 1 WHERE id = ?')
    .bind('demo')
    .run();
  await fixture.db.batch([
    fixture.db
      .prepare(
        'INSERT INTO games (id,name,has_categories,card_format) VALUES (?,?,?,?)',
      )
      .bind('second', 'Word Play', 0, 'flexible'),
    fixture.db
      .prepare(
        'INSERT INTO cards (id,game_id,name,description) VALUES (?,?,?,?)',
      )
      .bind('word1', 'second', 'One more game', 'A fresh round'),
  ]);
  browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
      (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    headless: true,
    args: ['--no-sandbox'],
  });
});
after(async () => {
  await browser?.close();
  await fixture?.stop();
});

async function open() {
  const page = await browser.newPage();
  await page.clock.install();
  await page.goto(fixture.origin);
  await page.evaluate(() => {
    sessionStorage.setItem(
      'jorbox:deck:demo',
      JSON.stringify({ order: ['demo1', 'demo2'], positions: {} }),
    );
  });
  await page.goto(`${fixture.origin}/play/demo`);
  await page.locator('.playing-card h2').waitFor();
  return page;
}
const button = (page, name) => page.getByRole('button', { name, exact: true });

async function startTimer(page) {
  await button(page, 'Timer').click();
  await page.getByLabel('Round length').selectOption('30');
  await button(page, 'Start timer').click();
}

test('malformed persisted scoreboard and deck recover on reload', async () => {
  const page = await open();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.evaluate(() => {
    sessionStorage.setItem(
      'jorbox:deck:demo',
      JSON.stringify({ order: 'bad' }),
    );
    sessionStorage.setItem('jorbox:scores', '[null,{"name":{}}]');
  });
  await page.reload();
  await page.locator('.playing-card h2').waitFor();
  await button(page, 'Timer').click();
  assert.equal(await page.getByLabel('Team 1 score').textContent(), '0');
  assert.deepEqual(errors, []);
  await page.close();
});

test('revisiting a question hides its answer and held keys do not skip cards', async () => {
  const page = await open();
  await button(page, 'Reveal answer').click();
  await page.locator('.card-description').waitFor();
  await page.keyboard.down('ArrowRight');
  assert.equal(await page.locator('.card-position').textContent(), '2 / 2');
  // A second keydown without keyup is the browser's repeat event.
  await page.keyboard.down('ArrowRight');
  assert.equal(await page.locator('.deck-end').count(), 0);
  await page.keyboard.up('ArrowRight');
  await button(page, 'Previous').click();
  await button(page, 'Reveal answer').waitFor();
  assert.equal(await page.locator('.card-description').count(), 0);
  await page.close();
});

test('repeated subsecond pauses do not extend a timed round', async () => {
  const page = await open();
  await startTimer(page);
  // The previous implementation rounded each 600ms segment back to a whole second.
  for (let i = 0; i < 3; i++) {
    await page.clock.runFor(600);
    await button(page, 'Pause timer').click();
    await page.clock.runFor(1000);
    await button(page, 'Start timer').click();
  }
  await page.clock.runFor(28_500);
  assert.equal(await page.getByRole('timer').textContent(), 'Time’s up!');
  await page.close();
});

test('scoring after the deadline cannot add points or advance the card', async () => {
  const page = await open();
  await startTimer(page);
  // Change wall time without running timer callbacks, as in a suspended tab.
  await page.clock.setSystemTime(new Date(Date.now() + 60_000));
  await button(page, 'Got it').click();
  assert.equal(await page.getByRole('timer').textContent(), 'Time’s up!');
  assert.equal(await page.locator('.card-position').textContent(), '1 / 2');
  assert.equal(await page.locator('.round-tally').count(), 0);
  await page.close();
});

test('hiding the timer pauses its countdown and reopening preserves the round', async () => {
  const page = await open();
  await startTimer(page);
  await button(page, 'Got it').click();
  await page.clock.runFor(5_000);
  const remaining = await page.getByRole('timer').textContent();
  await button(page, 'Timer').click();
  assert.equal(await page.getByRole('timer').count(), 0);
  await page.clock.runFor(10_000);
  await button(page, 'Timer').click();
  assert.equal(await page.getByRole('timer').textContent(), remaining);
  await button(page, 'Start timer').waitFor();
  await button(page, 'Start timer').click();
  assert.equal(
    await page.locator('.round-tally').textContent(),
    '1 got it · 0 skipped',
  );
  await page.close();
});

test('choosing another game closes and resets the previous round', async () => {
  const page = await open();
  await startTimer(page);
  await button(page, 'Got it').click();
  await page.clock.runFor(5_000);
  await page.getByLabel('Select Game').selectOption('second');
  await page
    .getByRole('heading', { name: 'One more game', exact: true })
    .waitFor();
  assert.equal(await page.getByRole('timer').count(), 0);
  await button(page, 'Timer').click();
  assert.equal(await page.getByRole('timer').textContent(), '0:30');
  await button(page, 'Start timer').click();
  assert.equal(await page.locator('.round-tally').count(), 0);
  await page.close();
});

test('game search narrows results and both clear actions recover the full list', async () => {
  const page = await open();
  await button(page, 'All games').click();
  const search = page.getByRole('searchbox', { name: 'Find a game' });
  await search.fill('  WORD  ');
  assert.equal(await page.locator('.game-tile').count(), 1);
  assert.equal(
    await page.locator('.game-tile-name').textContent(),
    'Word Play',
  );
  await button(page, 'Clear game search').click();
  assert.equal(await page.locator('.game-tile').count(), 2);
  await search.fill('no such game');
  assert.equal(await page.locator('.game-tile').count(), 0);
  await page.getByText('No games match “no such game”.').waitFor();
  await button(page, 'Show all games').click();
  assert.equal(await search.inputValue(), '');
  assert.equal(await page.locator('.game-tile').count(), 2);
  await page.close();
});

test('reduced motion stops decorative background animations', async () => {
  const page = await open();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const animations = await page
    .locator('.aurora-blob, .bokeh-piece')
    .evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).animationName),
    );
  assert.ok(animations.length > 0);
  assert.ok(animations.every((animation) => animation === 'none'));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.notEqual(
    await page
      .locator('.aurora-blob')
      .first()
      .evaluate((element) => getComputedStyle(element).animationName),
    'none',
  );
  await page.close();
});

for (const width of [320, 390]) {
  test(`player controls fit without overlap before and after voting at ${width}px`, async () => {
    const page = await open();
    const height = width === 320 ? 640 : 844;
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const previous = button(page, 'Previous');
    const next = button(page, 'Next');
    const like = page.getByRole('button', { name: /^Like(?: \(|$)/ });
    const dislike = page.getByRole('button', { name: /^Dislike(?: \(|$)/ });
    async function checkControls(stage) {
      const controls = [previous, like, dislike, next];
      const names = ['Previous', 'Like', 'Dislike', 'Next'];
      const boxes = await Promise.all(
        controls.map((control) => control.boundingBox()),
      );
      for (let i = 0; i < boxes.length; i++) {
        const box = boxes[i];
        assert.ok(box, `${stage}: ${names[i]} is visible`);
        assert.ok(
          box.width >= 44 && box.height >= 44,
          `${stage}: ${names[i]} has a 44px target`,
        );
        assert.ok(
          box.x >= 0 &&
            box.y >= 0 &&
            box.x + box.width <= width + 0.5 &&
            box.y + box.height <= height + 0.5,
          `${stage}: ${names[i]} fits the viewport`,
        );
        for (let j = 0; j < i; j++) {
          const other = boxes[j];
          const overlapX =
            Math.min(box.x + box.width, other.x + other.width) -
            Math.max(box.x, other.x);
          const overlapY =
            Math.min(box.y + box.height, other.y + other.height) -
            Math.max(box.y, other.y);
          assert.ok(
            overlapX <= 0.5 || overlapY <= 0.5,
            `${stage}: ${names[i]} does not overlap ${names[j]}`,
          );
        }
      }
    }
    await checkControls('Before vote');
    await like.click();
    await page
      .getByRole('button', { name: /^Like \(/, pressed: true })
      .waitFor();
    await checkControls('After vote');
    await dislike.click();
    await page
      .getByRole('button', { name: /^Dislike \(/, pressed: true })
      .waitFor();
    await checkControls('After changing vote');
    await page.close();
  });
}
