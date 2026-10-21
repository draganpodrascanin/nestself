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
    // Base UI wraps focus through a guard element for one tick; poll until focus settles inside the dialog.
    await expect
      .poll(
        () => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null),
        {
          timeout: 2_000,
        },
      )
      .toBe(true);

    // Escape should close dialog and return focus to the trigger
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="dialog"]', { state: 'detached' });
    const returnedToTrigger = await page.evaluate(() =>
      document.activeElement?.getAttribute('data-testid'),
    );
    expect(returnedToTrigger).toBe('privacy-trigger');
  });
});

test.describe('keyboard navigation: marketing site', () => {
  test('a wellbeing check-in can be completed with the keyboard only', async ({ page }) => {
    await page.goto('http://localhost:3000/en/tools/wellbeing-check-in');
    await settle(page);
    await page.getByRole('button', { name: 'Start' }).focus();
    await page.keyboard.press('Enter');
    for (let i = 0; i < 8; i += 1) {
      const option = page.getByRole('radio', { name: 'Often' });
      await option.waitFor({ state: 'visible' });
      await option.focus();
      await page.keyboard.press('Space');
      const finish = page.getByRole('button', { name: 'See your result' });
      const next = (await finish.count()) > 0 ? finish : page.getByRole('button', { name: 'Next' });
      await next.focus();
      await page.keyboard.press('Enter');
    }
    const heading = page.getByRole('heading', { name: 'Your result' });
    await heading.waitFor({ state: 'visible' });
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.textContent?.trim()), { timeout: 2_000 })
      .toBe('Your result');
  });

  test('submitting the empty demo form moves focus to the error summary', async ({ page }) => {
    await page.goto('http://localhost:3000/en/demo');
    await settle(page);
    const submit = page.getByRole('button', { name: 'Send request' });
    await submit.focus();
    await page.keyboard.press('Enter');
    const summary = page.getByRole('alert').filter({ hasText: /please fix/i });
    await summary.waitFor({ state: 'visible' });
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute('role')), { timeout: 2_000 })
      .toBe('alert');
    await expect(summary).not.toContainText('expected');
  });

  test('the locale switcher menu changes the URL and the document language', async ({ page }) => {
    await page.goto('http://localhost:3000/en/plans');
    await settle(page);

    // Open the header locale menu
    const headerTrigger = page.getByRole('button', { name: /language/i }).first();
    await headerTrigger.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();

    // Click the Magyar item
    await menu.getByRole('menuitem', { name: 'Magyar' }).click();
    await page.waitForURL('**/hu/plans');
    await settle(page);
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('hu');

    // The trigger now reads "Magyar"
    const updatedTrigger = page.getByRole('button', { name: /nyelv/i }).first();
    await expect(updatedTrigger).toContainText('Magyar');

    // The footer also has a locale switcher trigger
    const footerTrigger = page.getByRole('contentinfo').getByRole('button', { name: /nyelv/i });
    await expect(footerTrigger).toBeVisible();
  });

  test('choosing Serbian leads to the unprefixed URL and the Serbian document language', async ({ page }) => {
    await page.goto('http://localhost:3000/en/plans');
    await settle(page);
    const headerTrigger = page.getByRole('button', { name: /language/i }).first();
    await headerTrigger.click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: /Srpski/ }).click();
    await page.waitForURL((url) => url.pathname === '/plans');
    await settle(page);
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('sr-Latn');
    // The old prefixed address redirects to the unprefixed one.
    const response = await page.goto('http://localhost:3000/sr-Latn/plans');
    expect(response?.url()).toBe('http://localhost:3000/plans');
  });
});
