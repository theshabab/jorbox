import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { startFixture } from './fixture.js';

test('a failed lazy screen preserves navigation and recovers after reload', async () => {
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
    const chunk = '**/assets/GameManager-*.js';
    let blocked = 0;
    await page.route(chunk, (route) => {
      blocked++;
      return route.abort('failed');
    });
    await page.goto(`${fixture.origin}/games`);
    await page
      .getByRole('alert')
      .filter({ hasText: 'This screen couldn’t load' })
      .waitFor();
    assert.ok(blocked > 0, 'the game-management chunk must fail to load');
    assert.equal(
      await page.getByRole('heading', { level: 1 }).isVisible(),
      true,
    );
    assert.equal(
      await page.getByRole('button', { name: 'Play', exact: true }).isVisible(),
      true,
    );
    assert.equal(
      await page.getByRole('button', { name: 'Play', exact: true }).isEnabled(),
      true,
    );
    assert.equal(
      await page
        .getByRole('button', { name: 'Games & formats', exact: true })
        .isVisible(),
      true,
    );
    await page.unroute(chunk);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.getByRole('button', { name: 'Reload JorBox', exact: true }).click(),
    ]);
    await page
      .getByRole('heading', {
        name: 'Manage games & card formats',
        exact: true,
      })
      .waitFor();
    assert.equal(
      await page
        .getByRole('button', { name: 'Reload JorBox', exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page
        .getByRole('button', { name: 'Add a game', exact: true })
        .isEnabled(),
      true,
    );
  } finally {
    if (browser) await browser.close();
    await fixture.stop();
  }
});
