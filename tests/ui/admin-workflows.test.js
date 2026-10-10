import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { startFixture } from './fixture.js';

test('administrator workflows in Chromium, including mobile layout', async () => {
  const fixture = await startFixture();
  const artifactDir = resolve('.ui-artifacts');
  mkdirSync(artifactDir, { recursive: true });
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  let browser;
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox'],
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    await context.addCookies([
      { name: 'jb_session', value: 'local-ui-test', url: fixture.origin },
    ]);
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const deckName = 'Browser Test Deck';
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const button = (name) => page.getByRole('button', { name, exact: true });
    await page.goto(fixture.origin);
    await button('Manage games & formats').click();
    await button('Add a game').click();
    await page.getByLabel('Game name', { exact: true }).fill(deckName);
    await page.getByLabel('Card format').selectOption('flexible');
    await button('Review game').click();
    await button('Confirm game changes').click();
    await page
      .getByRole('status')
      .filter({ hasText: 'Game created.' })
      .waitFor();
    const games = await page.evaluate(async () =>
      fetch('/api/games').then((r) => r.json()),
    );
    const game = games.find((g) => g.name === deckName);
    assert.ok(game);
    await page.getByLabel('Select Game', { exact: true }).selectOption(game.id);
    await button('Manage cards').click();
    await button('Add a card').click();
    await page.getByLabel('Name', { exact: true }).fill('New card');
    await page
      .getByLabel('Description', { exact: true })
      .fill('A browser-verified card');
    await button('Review card').click();
    await button('Confirm changes').click();
    await page
      .getByRole('status')
      .filter({ hasText: '1 card added.' })
      .waitFor();
    await page
      .getByLabel('CSV file')
      .setInputFiles({
        name: 'cards.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(
          'Name,Description\nSecond card,Second browser prompt',
        ),
      });
    await button('Review 1 new cards').click();
    await button('Confirm changes').click();
    await page
      .getByRole('status')
      .filter({ hasText: '1 card added.' })
      .waitFor();
    await button('Select first 2 matching').click();
    await button('Edit selected cards').click();
    await page.getByLabel('Replace description on every selected card').check();
    await page.getByLabel('New description').fill('Bulk edited in Chromium');
    await button('Apply replacements to draft').click();
    await button('Review all edits').click();
    // Editing a draft after review must invalidate the confirmation.
    await page
      .locator('.bulk-card-draft')
      .first()
      .getByLabel('Name', { exact: true })
      .fill('Edited first card');
    assert.equal(await button('Confirm changes').count(), 0);
    await button('Review all edits').click();
    await button('Confirm changes').click();
    await page
      .getByRole('status')
      .filter({ hasText: '2 cards updated.' })
      .waitFor();
    let cards = await page.evaluate(
      async (id) => fetch(`/api/games/${id}/cards`).then((r) => r.json()),
      game.id,
    );
    assert.equal(cards.length, 2);
    assert.ok(cards.every((c) => c.Description === 'Bulk edited in Chromium'));
    await button('Select first 2 matching').click();
    await button('Like selected').click();
    await button('Confirm changes').click();
    await page
      .getByRole('status')
      .filter({ hasText: '2 cards rated.' })
      .waitFor();
    cards = await page.evaluate(
      async (id) => fetch(`/api/games/${id}/cards`).then((r) => r.json()),
      game.id,
    );
    assert.ok(cards.every((c) => c.myVote === 1 && c.likes === 1));
    const downloadPromise = page.waitForEvent('download');
    await button('Export 2 matching cards').click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /\.csv$/);
    await page.getByLabel('Import mode').selectOption('feedback');
    await page
      .getByLabel('CSV file')
      .setInputFiles({
        name: 'feedback.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(
          `id,version,myVote\n${cards[0].id},${cards[0].version},-1\n${cards[1].id},${cards[1].version},0`,
        ),
      });
    await button('Review 2 feedback changes').click();
    await button('Confirm changes').click();
    await page
      .getByRole('status')
      .filter({ hasText: '2 cards rated.' })
      .waitFor();
    cards = await page.evaluate(
      async (id) => fetch(`/api/games/${id}/cards`).then((r) => r.json()),
      game.id,
    );
    assert.deepEqual(
      cards.map((c) => c.myVote),
      [-1, 0],
    );
    await page
      .getByLabel('My feedback', { exact: true })
      .selectOption('disliked');
    assert.equal(await page.locator('tbody tr').count(), 1);
    await page.getByLabel('My feedback', { exact: true }).selectOption('all');
    await button('Manage games & formats').click();
    let row = page.getByRole('row').filter({ hasText: deckName });
    await row.getByRole('button', { name: 'Edit game', exact: true }).click();
    await page.getByLabel('Use categories').check();
    await page
      .getByLabel('Default category for uncategorized cards')
      .fill('General');
    await button('Review game').click();
    await button('Confirm game changes').click();
    await page
      .getByRole('status')
      .filter({ hasText: 'Game updated.' })
      .waitFor();
    row = page.getByRole('row').filter({ hasText: deckName });
    await row.getByRole('button', { name: 'Edit game', exact: true }).click();
    await page.getByLabel('Card format').selectOption('name');
    await button('Review game').click();
    await button('Confirm game changes').click();
    await page
      .getByRole('alert')
      .filter({ hasText: 'do not fit this format' })
      .waitFor();
    await page
      .locator('.review-panel')
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    await page
      .locator('form')
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    row = page.getByRole('row').filter({ hasText: deckName });
    await row.getByRole('button', { name: 'Edit game', exact: true }).click();
    await page.getByLabel('Use categories').uncheck();
    await page.getByLabel('Clear categories from all cards').check();
    await button('Review game').click();
    await page
      .locator('.review-panel')
      .getByText('Category text will be cleared', { exact: false })
      .waitFor();
    await button('Confirm game changes').click();
    await page
      .getByRole('status')
      .filter({ hasText: 'Game updated.' })
      .waitFor();
    cards = await page.evaluate(
      async (id) => fetch(`/api/games/${id}/cards`).then((r) => r.json()),
      game.id,
    );
    assert.ok(cards.every((card) => card.Category === ''));
    row = page.getByRole('row').filter({ hasText: deckName });
    await row.getByRole('button', { name: 'Remove', exact: true }).click();
    await button('Confirm game changes').click();
    await page
      .getByRole('status')
      .filter({ hasText: 'Game removed.' })
      .waitFor();
    assert.equal(
      await page
        .locator('#game-select option')
        .filter({ hasText: deckName })
        .count(),
      0,
    );
    await button('Show removed games').click();
    await page
      .getByRole('row')
      .filter({ hasText: deckName })
      .getByRole('button', { name: 'Restore', exact: true })
      .click();
    await button('Confirm game changes').click();
    await page
      .getByRole('status')
      .filter({ hasText: 'Game restored.' })
      .waitFor();
    await button('Show active games').click();
    await page.screenshot({
      path: resolve(artifactDir, 'game-management.png'),
      fullPage: true,
    });
    await page.getByLabel('Select Game', { exact: true }).selectOption(game.id);
    await button('Manage cards').click();
    await page
      .getByRole('heading', { name: 'Manage ' + deckName, exact: true })
      .waitFor();
    await page.screenshot({
      path: resolve(artifactDir, 'card-management.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: resolve(artifactDir, 'card-management-mobile.png'),
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS: game creation, card creation, CSV import/export, bulk edit + review invalidation, bulk feedback, mixed CSV feedback, filters, category conversion, incompatible format rejection, game removal/restoration, mobile layout, and no page errors.',
    );
  } finally {
    await browser?.close();
    await fixture.stop();
  }
});
