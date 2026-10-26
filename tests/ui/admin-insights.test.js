import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { startFixture } from './fixture.js';

test('duplicates, copying, categories, feedback overview and activity history in Chromium', async () => {
  const fixture = await startFixture();
  let browser;
  const artifactDir = resolve('.ui-artifacts');
  mkdirSync(artifactDir, { recursive: true });
  async function post(path, data) {
    const response = await fetch(`${fixture.origin}/api${path}`, {
      method: 'POST',
      headers: {
        Cookie: 'jb_session=local-ui-test',
        Origin: fixture.origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    assert.ok(response.ok, JSON.stringify(result));
    return result;
  }
  async function getCards(game) {
    return (await fetch(`${fixture.origin}/api/games/${game}/cards`)).json();
  }
  try {
    const source = await post('/games/manage', {
      action: 'create',
      name: 'Source Deck',
      hasCategories: true,
      cardFormat: 'flexible',
    });
    const target = await post('/games/manage', {
      action: 'create',
      name: 'Destination Deck',
      hasCategories: true,
      cardFormat: 'flexible',
    });
    const added = await post(`/games/${source.id}/cards/bulk`, {
      action: 'import',
      cards: [
        { Name: 'Repeated', Description: 'Same prompt', Category: 'Old' },
        { Name: ' repeated ', Description: 'same prompt', Category: 'Old' },
        {
          Name: 'Needs review',
          Description: 'A less popular prompt',
          Category: 'Old',
        },
        { Name: 'Popular', Description: 'A liked prompt', Category: 'Other' },
      ],
    });
    await post(`/games/${source.id}/cards/bulk`, {
      action: 'feedback',
      cards: [
        { id: added.ids[2], version: 1, value: -1 },
        { id: added.ids[3], version: 1, value: 1 },
      ],
    });
    const executablePath =
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
      (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
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
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const button = (name) => page.getByRole('button', { name, exact: true });
    await page.goto(fixture.origin);
    await button('Manage cards').click();
    await page.locator('.game-tile').filter({ hasText: 'Source Deck' }).click();
    await button('Find duplicates').click();
    await page.getByText('1 duplicate groups · 1 extra copies').waitFor();
    await button('Select 1 extra copies').click();
    await button('Review removal').click();
    await button('Confirm changes').click();
    await page
      .getByRole('status')
      .filter({ hasText: '1 card removed.' })
      .waitFor();
    assert.equal((await getCards(source.id)).length, 3);
    await button('Find duplicates').click();
    await page
      .getByRole('status')
      .filter({ hasText: 'No duplicate cards found.' })
      .waitFor();
    await page.keyboard.press('Escape');
    await button('Select first 3 matching').click();
    await button('Copy selected cards').click();
    await page
      .getByLabel('Destination game', { exact: true })
      .selectOption(target.id);
    await page.getByLabel('Category for copies').fill('Copies');
    await button('Review copies').click();
    await button('Confirm copies').click();
    await page
      .getByRole('status')
      .filter({ hasText: '3 cards copied to Destination Deck.' })
      .waitFor();
    const copied = await getCards(target.id);
    assert.equal(copied.length, 3);
    assert.ok(
      copied.every(
        (card) =>
          card.Category === 'Copies' && card.likes === 0 && card.dislikes === 0,
      ),
    );
    assert.ok(copied.every((card) => !added.ids.includes(card.id)));
    await button('Manage categories').click();
    await page
      .getByLabel('Source category', { exact: true })
      .selectOption('Old');
    await page.getByLabel('New or existing category').fill('Other');
    await button('Review category merge').click();
    await page
      .getByText('2 active cards and 1 removed cards will change category.', {
        exact: false,
      })
      .waitFor();
    await button('Confirm category changes').click();
    await page
      .getByRole('status')
      .filter({ hasText: '3 cards moved from “Old” to “Other”.' })
      .waitFor();
    assert.ok(
      (await getCards(source.id)).every((card) => card.Category === 'Other'),
    );
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await button('Reports').click();
    await page
      .getByLabel('Report game', { exact: true })
      .selectOption(source.id);
    await page
      .getByRole('heading', { name: 'Most disliked', exact: true })
      .waitFor();
    assert.deepEqual(
      await page.locator('.report-stats strong').allTextContents(),
      ['3', '2', '1', '1'],
    );
    await button('Feedback overview').click(); // Reopening the selected tab must refresh rather than hang.
    await page
      .getByRole('heading', { name: 'Most disliked', exact: true })
      .waitFor();
    await page.screenshot({
      path: resolve(artifactDir, 'feedback-overview.png'),
      fullPage: true,
    });
    await page
      .getByRole('row')
      .filter({ hasText: 'Needs review' })
      .getByRole('button', { name: 'Review this card' })
      .click();
    await page
      .getByRole('heading', { name: 'Manage Source Deck', exact: true })
      .waitFor();
    await page.getByRole('row').filter({ hasText: 'Needs review' }).waitFor();
    assert.equal(
      await page.locator('[aria-label="Card management"] tbody tr').count(),
      1,
    );
    await button('Reports').click();
    await button('Activity log').click();
    await page
      .getByLabel('Report game', { exact: true })
      .selectOption(source.id);
    await page
      .getByRole('cell', { name: /^Category renamed \/ merged/ })
      .waitFor();
    await button('Activity log').click(); // Selected activity tab also remains usable.
    await page
      .getByRole('cell', { name: /^Category renamed \/ merged/ })
      .waitFor();
    await page
      .getByLabel('Report game', { exact: true })
      .selectOption(target.id);
    await page
      .getByRole('cell', { name: 'Cards copied', exact: true })
      .waitFor();
    await page.screenshot({
      path: resolve(artifactDir, 'activity-log.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: resolve(artifactDir, 'activity-log-mobile.png'),
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await fixture.stop();
  }
});
