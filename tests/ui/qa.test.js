import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startFixture } from './fixture.js';

// Browser QA against the real 19,420-card seed: player flow, mobile layout,
// keyboard/swipe/persistence, admin dialogs, CSV round trips, and axe scans.
const axeSource = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
);
const artifactDir = resolve('.ui-artifacts');
const PHONE = { width: 390, height: 844 };
const SMALL_PHONE = { width: 320, height: 640 };
const DESKTOP = { width: 1280, height: 860 };
let fixture;
let browser;

before(async () => {
  mkdirSync(artifactDir, { recursive: true });
  fixture = await startFixture({ seed: true });
  // A long card to check scrolling text never pushes the controls away.
  await fixture.db
    .prepare('INSERT INTO cards (id,game_id,name,description) VALUES (?,?,?,?)')
    .bind('demo3', 'demo', 'Long card', 'A long prompt. '.repeat(200))
    .run();
  await fixture.db
    .prepare('INSERT INTO cards (id,game_id,name,description) VALUES (?,?,?,?)')
    .bind('demo4', 'demo', '-40', 'Freezing point where both scales meet')
    .run();
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox'],
  });
});
after(async () => {
  await browser?.close();
  await fixture?.stop();
});

async function open({ viewport = DESKTOP, admin = false, ...options } = {}) {
  const context = await browser.newContext({ viewport, ...options });
  if (admin)
    await context.addCookies([
      { name: 'jb_session', value: 'local-ui-test', url: fixture.origin },
    ]);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    // CSP violations and React warnings surface as console errors. axe's own
    // probing (it fetches stylesheets and adds styles) is not the app's doing.
    if (message.type() === 'error' && !page.axeRunning)
      problems.push(message.text());
  });
  await page.goto(fixture.origin);
  return { page, problems, close: () => context.close() };
}
const button = (page, name) => page.getByRole('button', { name, exact: true });
const position = (page) => page.locator('.card-position').textContent();
const noHorizontalScroll = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
async function inViewport(locator) {
  const box = await locator.boundingBox();
  const { width, height } = locator.page().viewportSize();
  return (
    box &&
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= width + 0.5 &&
    box.y + box.height <= height + 0.5
  );
}
async function axe(page, label) {
  // Evaluated over CDP, which the page's CSP does not apply to (inline <script> is blocked).
  if (!(await page.evaluate(() => Boolean(window.axe))))
    await page.evaluate(axeSource);
  // Scan settled pages only: a control fading in from disabled has mid-way colours.
  // Endless decorative animations (the background) are ignored.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== 'running' ||
          animation.effect?.getTiming().iterations === Infinity,
      ),
  );
  page.axeRunning = true;
  const { violations } = await page.evaluate(() =>
    window.axe.run(document, {
      resultTypes: ['violations'],
      runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'],
    }),
  );
  // Let any late console messages from axe arrive before listening again.
  await page.evaluate(() => new Promise((done) => setTimeout(done, 50)));
  page.axeRunning = false;
  const serious = violations.filter((item) =>
    ['serious', 'critical'].includes(item.impact),
  );
  assert.deepEqual(
    serious.map(
      (item) =>
        `${label}: ${item.id} (${item.nodes.length}) ${item.nodes[0]?.target}`,
    ),
    [],
  );
}
const shot = (page, name) =>
  page.screenshot({ path: resolve(artifactDir, `qa-${name}.png`) });

test('home lists every game as a tile with its size, without setup notices', async () => {
  const { page, problems, close } = await open();
  await page.locator('.game-tile').first().waitFor();
  assert.equal(await page.locator('.game-tile').count(), 17);
  await page.locator('.game-tile').filter({ hasText: '5,895 cards' }).waitFor();
  assert.equal(await page.getByText('awaits configuration').count(), 0);
  await axe(page, 'home');
  await shot(page, 'home-desktop');
  assert.deepEqual(problems, []);
  await close();
});

test('on phones the card, voting and Next fit on screen without scrolling', async () => {
  for (const viewport of [PHONE, SMALL_PHONE]) {
    const { page, problems, close } = await open({ viewport, hasTouch: true });
    assert.ok(await noHorizontalScroll(page), 'home scrolls sideways');
    await page
      .locator('.game-tile')
      .filter({ hasText: 'Main' })
      .first()
      .click();
    await page.locator('.playing-card').waitFor();
    assert.equal(await page.evaluate(() => scrollY), 0);
    for (const name of ['Next', 'Previous'])
      assert.ok(
        await inViewport(button(page, name)),
        `${name} off screen at ${viewport.width}px`,
      );
    assert.ok(
      await inViewport(page.getByRole('button', { name: 'Like', exact: true })),
    );
    assert.ok(await noHorizontalScroll(page), 'play view scrolls sideways');
    await shot(page, `play-${viewport.width}`);
    await axe(page, `play ${viewport.width}px`);
    assert.deepEqual(problems, []);
    await close();
  }
});

test('long card text scrolls inside the card and keeps the controls reachable', async () => {
  const { page, close } = await open({ viewport: PHONE });
  await page.locator('.game-tile').filter({ hasText: 'Demo Deck' }).click();
  await page.locator('.playing-card').waitFor();
  for (
    let i = 0;
    i < 4 && !(await page.getByRole('heading', { name: 'Long card' }).count());
    i++
  )
    await button(page, 'Next').click();
  const description = page.locator('.card-description');
  assert.ok(
    await description.evaluate((node) => node.scrollHeight > node.clientHeight),
  );
  assert.equal(await description.getAttribute('tabindex'), '0');
  assert.ok(await inViewport(button(page, 'Next')));
  await shot(page, 'long-card-mobile');
  await close();
});

test('arrow keys and swipes move between cards; the deck ends instead of wrapping', async () => {
  const { page, problems, close } = await open();
  await page.locator('.game-tile').filter({ hasText: 'Demo Deck' }).click();
  assert.equal(await position(page), '1 / 4');
  assert.ok(await button(page, 'Previous').isDisabled());
  const live = page.locator('[aria-live="polite"]');
  assert.match(await live.textContent(), /^Card 1 of 4: /);
  await page.keyboard.press('ArrowRight');
  assert.equal(await position(page), '2 / 4');
  assert.match(await live.textContent(), /^Card 2 of 4: /);
  await page.keyboard.press('ArrowLeft');
  assert.equal(await position(page), '1 / 4');
  // Swipe left with a pointer drag.
  const box = await page.locator('.playing-card').boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.8, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.2, y, { steps: 6 });
  await page.mouse.up();
  assert.equal(await position(page), '2 / 4');
  // Typing in a field must not flip cards.
  await page.locator('#game-select').focus();
  await page.keyboard.press('ArrowRight');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  assert.equal(await position(page), '2 / 4');
  for (let i = 0; i < 3; i++) await button(page, 'Next').click();
  await page.getByRole('heading', { name: 'That’s the whole deck' }).waitFor();
  assert.match(await live.textContent(), /End of deck/);
  await button(page, 'Start over').click();
  assert.equal(await position(page), '1 / 4');
  assert.deepEqual(problems, []);
  await close();
});

test('a reload keeps the shuffled order and position; reshuffle starts again', async () => {
  const { page, close } = await open();
  await page.locator('.game-tile').filter({ hasText: 'Trivia' }).click();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  const before = {
    name: await page.locator('.playing-card h2').textContent(),
    at: await position(page),
  };
  await page.reload();
  await page.locator('.playing-card').waitFor(); // The URL reopens the game.
  assert.deepEqual(
    {
      name: await page.locator('.playing-card h2').textContent(),
      at: await position(page),
    },
    before,
  );
  await button(page, 'Reshuffle').click();
  assert.equal(await position(page), '1 / 756');
  await close();
});

test('vote counts stay hidden until the player votes', async () => {
  const { page, close } = await open();
  await page.locator('.game-tile').filter({ hasText: 'Nouns' }).click();
  const like = page.getByRole('button', { name: /^Like/ });
  assert.equal(await like.getAttribute('aria-label'), 'Like');
  assert.equal((await like.textContent()).trim(), '');
  await like.click();
  await page.getByText('Thanks! Tap again to undo.').waitFor();
  assert.equal(await like.getAttribute('aria-pressed'), 'true');
  assert.equal(await like.getAttribute('aria-label'), 'Like (1 likes)');
  await like.click();
  await page.getByText('Good card?').waitFor();
  await close();
});

test('reduced motion turns off the card tilt', async () => {
  const { page, close } = await open({ reducedMotion: 'reduce' });
  await page.locator('.game-tile').filter({ hasText: 'Main' }).first().click();
  const card = page.locator('.playing-card');
  const box = await card.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20);
  assert.equal(await card.evaluate((node) => node.style.transform), '');
  await close();
});

test('admins get deck-order lists, tabbed sections, and dialogs that open in view', async () => {
  for (const viewport of [DESKTOP, PHONE]) {
    const { page, problems, close } = await open({ viewport, admin: true });
    await button(page, 'Manage cards').click();
    assert.equal(
      await button(page, 'Manage cards').getAttribute('aria-current'),
      'page',
    );
    await page
      .locator('.game-tile')
      .filter({ hasText: 'Main' })
      .first()
      .click();
    const firstRows = () =>
      page
        .locator('tbody tr strong')
        .evaluateAll((nodes) =>
          nodes.slice(0, 5).map((node) => node.textContent),
        );
    await page.locator('tbody tr').first().waitFor();
    // Deck order is the stored order (Karachi is the first seeded card), stable across refreshes.
    const order = await firstRows();
    assert.equal(order[0], 'Karachi');
    await button(page, 'Refresh').click();
    await page.locator('tbody tr').first().waitFor();
    assert.deepEqual(await firstRows(), order);
    // Row actions are visible on phones (stacked table, no hidden columns).
    const remove = page
      .locator('tbody tr')
      .nth(2)
      .getByRole('button', { name: 'Remove', exact: true });
    await remove.scrollIntoViewIfNeeded();
    assert.ok(await inViewport(remove), `Remove hidden at ${viewport.width}px`);
    await remove.click();
    const dialog = page.getByRole('dialog', {
      name: 'Confirm 1 card to remove',
    });
    await dialog.waitFor();
    assert.ok(
      await inViewport(dialog.getByRole('button', { name: 'Confirm changes' })),
    );
    assert.ok(
      await page.evaluate(
        () => document.activeElement.closest('dialog') !== null,
      ),
    );
    await axe(page, `remove dialog ${viewport.width}px`);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.equal(
      await page.evaluate(() => document.activeElement?.textContent),
      'Remove',
    );
    assert.ok(await noHorizontalScroll(page));
    await shot(page, `cards-admin-${viewport.width}`);
    await axe(page, `card manager ${viewport.width}px`);
    await button(page, 'Reports').click();
    // The seed has no votes, so the overview shows its empty state with a formatted total.
    await page
      .getByText(/No feedback yet across \d{1,3}(,\d{3})+ cards/)
      .waitFor();
    assert.ok(await noHorizontalScroll(page));
    await axe(page, `reports ${viewport.width}px`);
    await button(page, 'Games & formats').click();
    await page.locator('tbody tr').first().waitFor();
    assert.ok(
      await inViewport(
        page
          .locator('tbody tr')
          .first()
          .getByRole('button', { name: 'Edit game' }),
      ),
    );
    await axe(page, `games ${viewport.width}px`);
    assert.deepEqual(problems, []);
    await close();
  }
});

test('edit reviews show before/after text, and CSV round trips keep formula-like text', async () => {
  const { page, problems, close } = await open({
    admin: true,
    acceptDownloads: true,
  });
  await button(page, 'Manage cards').click();
  await page.locator('.game-tile').filter({ hasText: 'Demo Deck' }).click();
  const row = page.getByRole('row').filter({ hasText: 'First card' });
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Description', { exact: true }).fill('');
  await page.getByLabel('Name', { exact: true }).fill('Renamed card');
  await button(page, 'Review card').click();
  const review = page.getByRole('dialog', { name: /Confirm 1 card to update/ });
  await review.locator('del').filter({ hasText: 'First card' }).waitFor();
  await review.locator('ins').filter({ hasText: 'Renamed card' }).waitFor();
  await review.locator('ins').filter({ hasText: '(cleared)' }).waitFor();
  await shot(page, 'edit-diff');
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Edit card' })
    .getByRole('button', { name: 'Close dialog' })
    .click();
  // Export the "-40" card and import it back unchanged.
  await page.getByLabel('Search cards').fill('Freezing point');
  await button(page, 'Select first 1 matching').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    button(page, 'Export 1 selected cards').click(),
  ]);
  const csv = readFileSync(await download.path(), 'utf8');
  assert.match(csv, /'-40/);
  const file = resolve(artifactDir, 'qa-roundtrip.csv');
  writeFileSync(file, csv);
  await page.getByText('Bulk import & CSV edits').click();
  await page.getByLabel('Import mode').selectOption('edit');
  await page.getByLabel('CSV file').setInputFiles(file);
  await button(page, 'Review 1 updates').click();
  const roundTrip = page.getByRole('dialog', {
    name: /Confirm 1 card to update/,
  });
  await roundTrip.getByText('0 of 1 cards change.', { exact: false }).waitFor();
  await roundTrip.getByText('No changes.').waitFor();
  assert.deepEqual(problems, []);
  await close();
});

test('URLs open games directly, survive reloads, and the Back button returns', async () => {
  const { page, problems, close } = await open();
  await page.goto(`${fixture.origin}/play/game9`);
  await page.locator('.playing-card').waitFor();
  assert.equal(await page.locator('#game-select').inputValue(), 'game9');
  await page.keyboard.press('ArrowRight');
  const card = await page.locator('.playing-card h2').textContent();
  await page.reload();
  await page.locator('.playing-card').waitFor();
  assert.equal(await page.locator('.playing-card h2').textContent(), card);
  await button(page, 'All games').click();
  assert.equal(new URL(page.url()).pathname, '/');
  await page.goBack();
  await page.locator('.playing-card').waitFor();
  assert.equal(new URL(page.url()).pathname, '/play/game9');
  await page.goto(`${fixture.origin}/play/no-such-game`);
  await page
    .getByRole('alert')
    .filter({ hasText: 'That game is not available' })
    .waitFor();
  assert.equal(new URL(page.url()).pathname, '/');
  assert.deepEqual(problems, []);
  await close();
});

test('administrator sections have their own URLs', async () => {
  const { page, problems, close } = await open({ admin: true });
  await page.goto(`${fixture.origin}/cards/demo`);
  await page
    .getByRole('heading', { name: 'Manage Demo Deck', exact: true })
    .waitFor();
  await button(page, 'Reports').click();
  assert.equal(new URL(page.url()).pathname, '/reports');
  await page.goBack();
  await page
    .getByRole('heading', { name: 'Manage Demo Deck', exact: true })
    .waitFor();
  assert.equal(
    await button(page, 'Manage cards').getAttribute('aria-current'),
    'page',
  );
  // A player opening an administrator URL just gets the player view.
  const player = await open();
  await player.page.goto(`${fixture.origin}/cards/demo`);
  await player.page.locator('.playing-card').waitFor();
  assert.equal(new URL(player.page.url()).pathname, '/play/demo');
  await player.close();
  assert.deepEqual(problems, []);
  await close();
});

test('the round timer counts down, warns at the end, and remembers its length', async () => {
  const { page, problems, close } = await open({ viewport: PHONE });
  await page.clock.install();
  await page.goto(`${fixture.origin}/play/game2`);
  await page.locator('.playing-card').waitFor();
  await page.getByRole('button', { name: 'Timer', exact: true }).click();
  const timer = page.getByRole('timer');
  assert.equal(await timer.textContent(), '1:00');
  await page.getByLabel('Round length').selectOption('30');
  await page.getByRole('button', { name: 'Start timer' }).click();
  await page.clock.runFor(12_000);
  assert.equal(await timer.textContent(), '0:18');
  await page.getByRole('button', { name: 'Pause timer' }).click();
  await page.clock.runFor(5_000);
  assert.equal(await timer.textContent(), '0:18');
  // Scoring cards keeps the timer running.
  await page.getByRole('button', { name: 'Start timer' }).click();
  await button(page, 'Got it').click();
  await page.clock.runFor(19_000);
  assert.equal(await timer.textContent(), 'Time’s up!');
  assert.ok(await inViewport(button(page, 'Next')));
  await shot(page, 'timer-mobile');
  await page.reload();
  await page.getByRole('button', { name: 'Timer', exact: true }).click();
  assert.equal(await page.getByRole('timer').textContent(), '0:30');
  assert.deepEqual(problems, []);
  await close();
});

test('players do not see empty games; administrators do', async () => {
  const response = await fetch(`${fixture.origin}/api/games/manage`, {
    method: 'POST',
    headers: {
      Cookie: 'jb_session=local-ui-test',
      Origin: fixture.origin,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'create',
      name: 'Empty Deck',
      hasCategories: false,
      cardFormat: 'flexible',
    }),
  });
  assert.equal(response.status, 201);
  const player = await open();
  await player.page.locator('.game-tile').first().waitFor();
  assert.equal(
    await player.page
      .locator('.game-tile')
      .filter({ hasText: 'Empty Deck' })
      .count(),
    0,
  );
  await player.close();
  const admin = await open({ admin: true });
  await button(admin.page, 'Manage cards').click();
  await admin.page
    .locator('.game-tile')
    .filter({ hasText: 'Empty Deck' })
    .waitFor();
  await button(admin.page, 'Play').click();
  await admin.page
    .locator('.game-tile')
    .filter({ hasText: 'Empty Deck' })
    .click();
  await admin.page.getByText('This game has no cards yet.').waitFor();
  await admin.close();
});

test('answers stay hidden until revealed in decks that hide them', async () => {
  const { page, problems, close } = await open({ viewport: PHONE });
  await page.goto(`${fixture.origin}/play/game9`);
  await page.locator('.playing-card h2').waitFor();
  const reveal = page.getByRole('button', { name: 'Reveal answer' });
  await reveal.waitFor();
  assert.equal(await page.locator('.card-description').count(), 0);
  await page.keyboard.press('Space');
  await page.locator('.card-description').waitFor();
  assert.equal(await reveal.count(), 0);
  // The next card starts hidden again.
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Reveal answer' }).click();
  await page.locator('.card-description').waitFor();
  await axe(page, 'trivia reveal');
  assert.deepEqual(problems, []);
  await close();
});

test('word lists, scales and blanks are laid out for play', async () => {
  const db = fixture.db;
  await db.batch([
    db
      .prepare(
        'INSERT INTO games (id,name,has_categories,card_format) VALUES (?,?,?,?)',
      )
      .bind('layouts', 'Layout Deck', 0, 'flexible'),
    db
      .prepare(
        'INSERT INTO cards (id,game_id,name,description) VALUES (?,?,?,?)',
      )
      .bind('layout1', 'layouts', 'Karachi', 'city | Pakistan | Sindh'),
    db
      .prepare(
        'INSERT INTO cards (id,game_id,name,description) VALUES (?,?,?,?)',
      )
      .bind(
        'layout2',
        'layouts',
        'NOT LIKELY <---> VERY LIKELY',
        'Name a movie',
      ),
    db
      .prepare(
        'INSERT INTO cards (id,game_id,name,description) VALUES (?,?,?,?)',
      )
      .bind('layout3', 'layouts', '', 'I accidentally called my teacher ____.'),
  ]);
  const { page, problems, close } = await open();
  await page.goto(`${fixture.origin}/play/layouts`);
  const seen = new Set();
  for (let i = 0; i < 3; i++) {
    await page.locator('.playing-card').waitFor();
    if (await page.locator('.word-chips').count()) {
      assert.deepEqual(await page.locator('.word-chips li').allTextContents(), [
        'city',
        'Pakistan',
        'Sindh',
      ]);
      seen.add('list');
    }
    if (await page.locator('h2.spectrum').count()) {
      assert.equal(
        await page.locator('h2.spectrum').getAttribute('aria-label'),
        'From NOT LIKELY to VERY LIKELY',
      );
      seen.add('scale');
    }
    if (await page.locator('.blank').count()) {
      assert.equal(
        await page.locator('.blank').getAttribute('aria-label'),
        'blank',
      );
      seen.add('blank');
    }
    await page.keyboard.press('ArrowRight');
  }
  assert.deepEqual([...seen].sort(), ['blank', 'list', 'scale']);
  assert.deepEqual(problems, []);
  await close();
});

test('timed rounds score Got it and Skip, summarise, and award points once', async () => {
  const { page, problems, close } = await open({ viewport: PHONE });
  await page.clock.install();
  await page.goto(`${fixture.origin}/play/game12`);
  await page.locator('.playing-card').waitFor();
  await page.getByRole('button', { name: 'Timer', exact: true }).click();
  await page.getByLabel('Round length').selectOption('30');
  await page.getByRole('button', { name: 'Start timer' }).click();
  assert.equal(await button(page, 'Previous').count(), 0);
  await button(page, 'Got it').click();
  await button(page, 'Skip').click();
  await page.keyboard.press('ArrowRight'); // Got it from the keyboard.
  await page.getByText('2 got it · 1 skipped').waitFor();
  assert.ok(await inViewport(button(page, 'Got it')));
  await page.clock.runFor(31_000);
  await page.getByRole('timer').filter({ hasText: 'Time’s up!' }).waitFor();
  await page.getByText('Cards this round').click();
  assert.equal(await page.locator('.round-summary li').count(), 3);
  await page.getByLabel('Team 1 name').fill('Blue');
  await button(page, '+2 to Blue').click();
  await page.getByText('Points added.').waitFor();
  // Hiding and reopening the timer must not allow the same round again.
  await page.getByRole('button', { name: 'Timer', exact: true }).click();
  await page.getByRole('button', { name: 'Timer', exact: true }).click();
  await page.getByText('Points added.').waitFor();
  assert.equal(await button(page, '+2 to Blue').count(), 0);
  assert.equal(await page.getByLabel('Blue score').textContent(), '2');
  await shot(page, 'round-summary-mobile');
  // Scores last for the evening (the browser tab).
  await page.reload();
  await page.getByRole('button', { name: 'Timer', exact: true }).click();
  assert.equal(await page.getByLabel('Blue score').textContent(), '2');
  await button(page, 'Reset scores').click();
  assert.equal(await page.getByLabel('Blue score').textContent(), '0');
  await axe(page, 'round panel');
  assert.deepEqual(problems, []);
  await close();
});

test('home offers to continue the last game; categories show their sizes', async () => {
  const { page, close } = await open();
  await page.goto(`${fixture.origin}/play/game1`);
  await page.locator('.playing-card').waitFor();
  const option = await page
    .locator('#category-select option')
    .nth(1)
    .textContent();
  assert.match(option, /^.+ \(\d+\)$/);
  await button(page, 'All games').click();
  await button(page, 'Continue Main').click();
  await page.locator('.playing-card').waitFor();
  assert.equal(new URL(page.url()).pathname, '/play/game1');
  await close();
});

test('admins can undo a removal, download a template, and start an empty deck', async () => {
  const { page, problems, close } = await open({
    admin: true,
    acceptDownloads: true,
  });
  await page.goto(`${fixture.origin}/games`);
  // Games table links straight to a deck's cards.
  await page.getByRole('button', { name: 'Manage cards in Demo Deck' }).click();
  await page
    .getByRole('heading', { name: 'Manage Demo Deck', exact: true })
    .waitFor();
  const row = page.getByRole('row').filter({ hasText: 'Second card' });
  await row.getByRole('button', { name: 'Remove', exact: true }).click();
  await button(page, 'Confirm changes').click();
  await page
    .getByRole('status')
    .filter({ hasText: '1 card removed.' })
    .waitFor();
  await page
    .getByRole('row')
    .filter({ hasText: 'Second card' })
    .waitFor({ state: 'detached' });
  await button(page, 'Undo').click();
  await page
    .getByRole('dialog', { name: 'Confirm 1 card to restore' })
    .getByText('Second card')
    .waitFor();
  await button(page, 'Confirm changes').click();
  await page
    .getByRole('status')
    .filter({ hasText: '1 card restored.' })
    .waitFor();
  await page.getByRole('row').filter({ hasText: 'Second card' }).waitFor();
  await page.getByText('Bulk import & CSV edits').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    button(page, 'Download a blank template').click(),
  ]);
  assert.equal(download.suggestedFilename(), 'demo-deck-template.csv');
  assert.equal(
    readFileSync(await download.path(), 'utf8'),
    'Name,Description\n',
  );
  // A new game opens on a clear empty state.
  await button(page, 'Games & formats').click();
  await button(page, 'Add a game').click();
  await page.getByLabel('Game name', { exact: true }).fill('Quiz Night');
  await page
    .getByLabel('Hide descriptions until a player taps “Reveal answer”')
    .check();
  await button(page, 'Review game').click();
  await page.getByText('Answers hidden until revealed').waitFor();
  await button(page, 'Confirm game changes').click();
  await page.getByRole('status').filter({ hasText: 'Game created.' }).waitFor();
  await page
    .getByRole('row')
    .filter({ hasText: 'Quiz Night' })
    .getByText('Answers hidden')
    .waitFor();
  await page
    .getByRole('button', { name: 'Manage cards in Quiz Night' })
    .click();
  await page.getByText('This deck has no cards yet.').waitFor();
  await button(page, 'Import from CSV').click();
  await page.getByLabel('CSV file').waitFor();
  assert.deepEqual(problems, []);
  await close();
});

test('players suggest cards and administrators review them from the queue', async () => {
  const player = await open({ viewport: PHONE });
  await player.page.goto(`${fixture.origin}/play/game10`);
  await player.page.locator('.playing-card').waitFor();
  await button(player.page, 'Suggest a card for this deck').click();
  const form = player.page.getByRole('dialog', {
    name: 'Suggest a card for Aik Rangi Soch',
  });
  await form
    .getByLabel('Name', { exact: true })
    .fill('Name a sweet you eat at Eid.');
  await button(player.page, 'Send suggestion').click();
  await form
    .getByText('Thanks! An administrator will review your card')
    .waitFor();
  await button(player.page, 'Suggest another').click();
  await form
    .getByLabel('Name', { exact: true })
    .fill('Name something you dislike.');
  await button(player.page, 'Send suggestion').click();
  await form.getByText('Thanks!', { exact: false }).waitFor();
  await axe(player.page, 'suggest dialog');
  assert.deepEqual(player.problems, []);
  await player.close();

  const { page, problems, close } = await open({ admin: true });
  const tab = page.getByRole('button', { name: /^Suggestions, \d+ waiting$/ });
  await tab.waitFor();
  await tab.click();
  assert.equal(new URL(page.url()).pathname, '/suggestions');
  const sweet = page
    .locator('.suggestion')
    .filter({ hasText: 'Name a sweet you eat at Eid.' });
  await sweet.getByText('Anonymous player').waitFor();
  await sweet.getByRole('button', { name: 'Review & accept' }).click();
  const accept = page.getByRole('dialog', {
    name: 'Accept into Aik Rangi Soch',
  });
  await accept
    .getByLabel('Name', { exact: true })
    .fill('Name a sweet you eat at Eid?');
  await button(page, 'Add card to deck').click();
  await page
    .getByRole('status')
    .filter({ hasText: 'Card added to Aik Rangi Soch.' })
    .waitFor();
  const cards = await page.evaluate(() =>
    fetch('/api/games/game10/cards').then((r) => r.json()),
  );
  assert.ok(cards.some((card) => card.Name === 'Name a sweet you eat at Eid?'));
  await page
    .locator('.suggestion')
    .filter({ hasText: 'Name something you dislike.' })
    .getByRole('button', { name: 'Reject' })
    .click();
  await button(page, 'Reject suggestion').click();
  await page
    .getByRole('status')
    .filter({ hasText: 'Suggestion rejected.' })
    .waitFor();
  await page
    .getByText('No suggestions are waiting.', { exact: false })
    .waitFor();
  assert.equal(await button(page, 'Suggestions').count(), 1); // Badge gone.
  await page.getByLabel('Show').selectOption('accepted');
  await page
    .locator('.suggestion')
    .first()
    .getByRole('button', { name: 'View card' })
    .click();
  await page
    .getByRole('heading', { name: 'Manage Aik Rangi Soch', exact: true })
    .waitFor();
  assert.equal(
    await page.locator('[aria-label="Card management"] tbody tr').count(),
    1,
  );
  await page.goto(`${fixture.origin}/suggestions`);
  await page.getByLabel('Show').waitFor();
  await axe(page, 'suggestions review');
  assert.deepEqual(problems, []);
  await close();
});

test('a deck opened on the very first visit keeps working offline', async () => {
  const { page, close } = await open({ viewport: PHONE });
  await page.goto(`${fixture.origin}/play/game12`);
  await page.locator('.playing-card').waitFor();
  // No second online load: once the worker takes control it saves what the
  // app needs to start (session, game list and this deck).
  await page.waitForFunction(async () => {
    const saved = await Promise.all(
      ['/api/session', '/api/games', '/api/games/game12/cards', '/'].map(
        (url) => caches.match(url, { ignoreVary: true }),
      ),
    );
    if (!saved.every(Boolean)) return false;
    const html = await saved[saved.length - 1].text();
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(
      (match) => match[1],
    );
    return (
      assets.length > 0 &&
      (await Promise.all(assets.map((url) => caches.match(url)))).every(Boolean)
    );
  });
  const card = await page.locator('.playing-card h2').textContent();
  await page.context().setOffline(true);
  await page.reload();
  await page.locator('.playing-card').waitFor();
  assert.equal(await page.locator('.playing-card h2').textContent(), card);
  await page.locator('.offline').waitFor();
  await page.getByRole('button', { name: 'Like', exact: true }).click();
  await page
    .getByRole('alert')
    .filter({ hasText: /offline|connection/ })
    .waitFor();
  await shot(page, 'offline-mobile');
  await page.context().setOffline(false);
  await close();
});

test('administrator data is never saved for offline use', async () => {
  const { page, close } = await open({ admin: true });
  await page.locator('.game-tile').first().waitFor();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  // Opening an administrator API address directly in a tab is not an app page.
  await page.goto(`${fixture.origin}/api/admin/suggestions`);
  const saved = await page.evaluate(async () => {
    const cache = await caches.open((await caches.keys())[0]);
    const keys = (await cache.keys()).map(
      (request) => new URL(request.url).pathname,
    );
    const shell = await cache.match('/');
    return { keys, shell: shell && (await shell.text()).slice(0, 15) };
  });
  assert.ok(
    saved.keys.every((path) => !path.startsWith('/api/admin')),
    saved.keys.join(', '),
  );
  assert.equal(saved.shell, '<!doctype html>');
  await page.context().setOffline(true);
  await page.goto(`${fixture.origin}/`);
  await page.locator('.brand').waitFor();
  await page.context().setOffline(false);
  await close();
});

test('full-screen mode shows only the card and exits with Escape', async () => {
  const { page, problems, close } = await open({ viewport: PHONE });
  await page.goto(`${fixture.origin}/play/game7`);
  await page.locator('.playing-card').waitFor();
  await page.getByRole('button', { name: 'Full screen', exact: true }).click();
  await page.locator('.app-container.presenting').waitFor();
  assert.equal(await page.locator('.app-header').isVisible(), false);
  assert.equal(await page.locator('#game-select').isVisible(), false);
  assert.ok(await inViewport(button(page, 'Next')));
  await shot(page, 'full-screen-mobile');
  await page.keyboard.press('Escape');
  await page
    .locator('.app-container.presenting')
    .waitFor({ state: 'detached' });
  assert.ok(await page.locator('.app-header').isVisible());
  assert.deepEqual(problems, []);
  await close();
});

test('the app can be installed: manifest and icons are served correctly', async () => {
  const manifest = await (
    await fetch(`${fixture.origin}/manifest.webmanifest`)
  ).json();
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
  for (const icon of manifest.icons) {
    const response = await fetch(`${fixture.origin}${icon.src}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'image/png');
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual([...bytes.slice(1, 4)], [80, 78, 71]); // "PNG"
  }
});
