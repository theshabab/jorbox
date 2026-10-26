import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { startFixture } from './fixture.js';

test('suggestion history pagination and failed loads never expose stale review actions', async () => {
  const fixture = await startFixture();
  let browser;
  try {
    await fixture.db.batch(
      Array.from({ length: 101 }, (_, index) =>
        fixture.db
          .prepare(
            `INSERT INTO suggestions (id, game_id, name, actor, status, created_at, reviewed_at)
             VALUES (?, 'demo', ?, 'test', 'rejected', ?, ?)`,
          )
          .bind(
            `history-${index}`,
            `History card ${index}`,
            1000 + index,
            2000 + index,
          ),
      ),
    );
    await fixture.db
      .prepare(
        `INSERT INTO suggestions (id, game_id, name, actor) VALUES ('waiting', 'demo', 'Waiting card', 'test')`,
      )
      .run();
    await fixture.db.batch([
      fixture.db.prepare(
        "INSERT INTO games (id, name, has_categories, card_format) VALUES ('changed', 'Changed Format', 0, 'name')",
      ),
      fixture.db.prepare(
        "INSERT INTO suggestions (id, game_id, name, description, category, actor) VALUES ('old-format', 'changed', 'Legacy idea', 'Keep this detail if useful', 'Old category', 'test')",
      ),
    ]);
    browser = await chromium.launch({
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
        (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
      headless: true,
      args: ['--no-sandbox'],
    });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.addCookies([
      { name: 'jb_session', value: 'local-ui-test', url: fixture.origin },
    ]);
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(`${fixture.origin}/suggestions`);
    await page.getByText('Waiting card', { exact: true }).waitFor();
    await page.getByLabel('Show').selectOption('rejected');
    await page.getByText('History card 100', { exact: true }).waitFor();
    assert.equal(await page.locator('.suggestion').count(), 100);
    await page
      .getByRole('button', { name: 'Next suggestions', exact: true })
      .click();
    await page.getByText('History card 0', { exact: true }).waitFor();
    assert.equal(await page.locator('.suggestion').count(), 1);
    assert.equal(
      await page
        .getByRole('button', { name: 'Next suggestions', exact: true })
        .isDisabled(),
      true,
    );
    await page
      .getByRole('button', { name: 'Previous suggestions', exact: true })
      .click();
    await page.getByText('History card 100', { exact: true }).waitFor();

    await page.route('**/api/admin/suggestions?status=pending*', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Review queue temporarily unavailable' }),
      }),
    );
    await page.getByLabel('Show').selectOption('pending');
    await page
      .getByRole('alert')
      .filter({ hasText: 'Review queue temporarily unavailable' })
      .waitFor();
    assert.equal(await page.locator('.suggestion').count(), 0);
    assert.equal(
      await page
        .getByRole('button', { name: 'Review & accept', exact: true })
        .count(),
      0,
    );
    assert.equal(await page.getByText(/No suggestions are waiting/).count(), 0);
    await page.unroute('**/api/admin/suggestions?status=pending*');
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByText('Waiting card', { exact: true }).waitFor();
    await page
      .locator('.suggestion')
      .filter({ hasText: 'Legacy idea' })
      .getByRole('button', { name: 'Review & accept', exact: true })
      .click();
    const accept = page.getByRole('button', {
      name: 'Add card to deck',
      exact: true,
    });
    assert.equal(await accept.isDisabled(), true);
    await page
      .getByRole('button', { name: 'Clear unused description', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Clear unused category', exact: true })
      .click();
    await accept.click();
    await page
      .getByRole('status')
      .filter({ hasText: 'Card added to Changed Format.' })
      .waitFor();
    const saved = await fixture.db
      .prepare(
        "SELECT name, description, category FROM cards WHERE game_id = 'changed'",
      )
      .first();
    assert.deepEqual(saved, {
      name: 'Legacy idea',
      description: '',
      category: '',
    });
  } finally {
    if (browser) await browser.close();
    await fixture.stop();
  }
});

test('rejected replacement CSV clears the previously valid import preview', async () => {
  const fixture = await startFixture();
  let browser;
  try {
    browser = await chromium.launch({
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
        (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
      headless: true,
      args: ['--no-sandbox'],
    });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.addCookies([
      { name: 'jb_session', value: 'local-ui-test', url: fixture.origin },
    ]);
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(`${fixture.origin}/cards/demo`);
    await page.getByText('Bulk import & CSV edits', { exact: true }).click();
    await page.getByLabel('CSV file').setInputFiles({
      name: 'valid.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Name\nValid preview'),
    });
    await page
      .getByRole('button', { name: 'Review 1 new cards', exact: true })
      .waitFor();
    await page.getByLabel('CSV file').setInputFiles({
      name: 'oversized.csv',
      mimeType: 'text/csv',
      buffer: Buffer.alloc(512 * 1024 + 1, 'x'),
    });
    await page
      .getByRole('alert')
      .filter({ hasText: 'CSV must be at most 512 KB.' })
      .waitFor();
    assert.equal(
      await page
        .getByRole('button', { name: 'Review 1 new cards', exact: true })
        .count(),
      0,
    );
    assert.equal(await page.locator('.csv-preview').count(), 0);
  } finally {
    if (browser) await browser.close();
    await fixture.stop();
  }
});
