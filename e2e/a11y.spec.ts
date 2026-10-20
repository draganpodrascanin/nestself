import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { applyTheme, applyLocale, settle, prepareActions } from './helpers';
import { pages } from './pages';

for (const entry of pages) {
  test(`a11y: ${entry.name}`, async ({ page }) => {
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

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
}

test.describe('keyboard navigation: marketing-home', () => {
  test('first Tab focuses the skip link', async ({ page }) => {
    await page.goto('http://localhost:3000/en');
    await settle(page);
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.textContent);
    expect(focused).toMatch(/skip/i);
  });

  test('privacy dialog traps focus and Escape returns it to trigger', async ({ page }) => {
    await page.goto('http://localhost:3000/en');
    await settle(page);

    // Open the privacy dialog (trigger selector will be finalised in Task 3.1)
    await page.click('[data-testid="privacy-trigger"]');
    await page.waitForSelector('[role="dialog"]');

    // Tab should cycle within the dialog
    const _firstFocused = await page.evaluate(() => document.activeElement?.tagName);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const stillInDialog = await page.evaluate(() =>
      document.activeElement?.closest('[role="dialog"]') !== null,
    );
    expect(stillInDialog).toBe(true);

    // Escape should close dialog and return focus to the trigger
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="dialog"]', { state: 'detached' });
    const returnedToTrigger = await page.evaluate(() =>
      document.activeElement?.getAttribute('data-testid'),
    );
    expect(returnedToTrigger).toBe('privacy-trigger');
  });
});
