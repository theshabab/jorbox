import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { startFixture } from './fixture.js';

let fixture;
let browser;
before(async () => {
  fixture = await startFixture();
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

test('offline play clears cached administrator identity and Retry connection verifies it again', async () => {
  const context = await browser.newContext();
  try {
    await context.addCookies([
      { name: 'jb_session', value: 'local-ui-test', url: fixture.origin },
    ]);
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(`${fixture.origin}/play/demo`);
    await page.locator('.playing-card').waitFor();
    await page
      .getByRole('button', { name: 'Manage cards', exact: true })
      .waitFor();
    await page.waitForFunction(async () => {
      const urls = ['/api/session', '/api/games', '/api/games/demo/cards', '/'];
      const saved = await Promise.all(
        urls.map((url) => caches.match(url, { ignoreVary: true })),
      );
      if (!saved.every(Boolean)) return false;
      const html = await saved[saved.length - 1].text();
      const assets = [
        ...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g),
      ].map((match) => match[1]);
      return (
        assets.length > 0 &&
        (await Promise.all(assets.map((url) => caches.match(url)))).every(
          Boolean,
        )
      );
    });
    const cachedUser = await page.evaluate(async () => {
      const response = await caches.match('/api/session', { ignoreVary: true });
      return (await response.json()).user;
    });
    assert.equal(cachedUser, null);
    await context.setOffline(true);
    await page.reload();
    await page.locator('.playing-card').waitFor();
    assert.equal(
      await page.getByRole('navigation', { name: 'Sections' }).count(),
      0,
    );
    assert.equal(
      await page.getByText('Signed in as', { exact: false }).count(),
      0,
    );
    // Chromium may report navigator.onLine=true after an offline reload, so
    // the saved-copy notice must offer a recovery path without an online event.
    await page.locator('.offline').waitFor();
    await context.setOffline(false);
    await page
      .getByRole('button', { name: 'Retry connection', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Manage cards', exact: true })
      .waitFor();
    await page.locator('.playing-card').waitFor();
  } finally {
    await context.close();
  }
});
