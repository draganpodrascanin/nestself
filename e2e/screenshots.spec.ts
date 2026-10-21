import { test, expect } from '@playwright/test';

import { applyTheme, applyLocale, settle, scrollThrough, collectConsoleErrors, prepareActions } from './helpers';
import { pages } from './pages';

for (const entry of pages) {
  test(`screenshot: ${entry.name}`, async ({ page }) => {
    const errors = collectConsoleErrors(page);

    if (entry.theme) {
      await applyTheme(page, entry.theme);
    }

    if (entry.locale) {
      await applyLocale(page, entry.locale);
    }

    await page.goto(entry.url);

    if (entry.prepare) {
      const action = prepareActions[entry.prepare];
      if (!action) {
        throw new Error(`Unknown prepare action "${entry.prepare}" for page "${entry.name}"`);
      }
      await action(page);
    }

    await settle(page);
    await scrollThrough(page);

    await expect(page).toHaveScreenshot(`${entry.name}.png`, { fullPage: true });

    expect(errors).toEqual([]);
  });
}
