/**
 * Account and security settings journey (workspace `/settings`).
 *
 * Ivana (sample HR admin, email code) opens /settings by deep link and sees
 * her saved display name in the field, changes it and sees it in
 * the header's account menu, checks that the sessions list marks this
 * browser, and signs out everywhere: this browser lands on `/sign-in`, and a
 * second browser signed in at the start of the test loses its session too.
 *
 * Re-runs: the display name is restored before sign-out, so the later
 * journeys (hr-access asserts "Ivana Jovanović" in the grant table) see the
 * seeded name. Global setup reseeds the database on every run anyway.
 *
 * Labels come from packages/i18n/locales/en/auth.json (`account`).
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { WORKSPACE_URL, signInWithEmailCode } from './support';

const EMAIL = 'user_ivana@example.com';
const SEEDED_NAME = 'Ivana Jovanović';
const NEW_NAME = 'Ivana J. (e2e rename)';

async function saveDisplayName(page: Page, name: string) {
  const field = page.getByRole('textbox', { name: 'Display name', exact: true });
  await field.fill(name);
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByText('Your display name was updated.').first()).toBeVisible({ timeout: 10_000 });
}

test.describe('Workspace account settings', () => {
  test('display name, sessions list and sign out everywhere', async ({ page, browser }) => {
    // A second browser with its own session, ended by "Sign out everywhere".
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await signInWithEmailCode(otherPage, WORKSPACE_URL, EMAIL);

    await signInWithEmailCode(page, WORKSPACE_URL, EMAIL);
    await page.goto(`${WORKSPACE_URL}/settings`);
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible({ timeout: 15_000 });

    // A deep link to /settings shows the saved name (the principal arrives after the first render).
    await expect(page.getByRole('textbox', { name: 'Display name', exact: true })).toHaveValue(SEEDED_NAME);

    // Display name: saved, then shown in the header's account menu.
    await saveDisplayName(page, NEW_NAME);
    await expect(page.getByRole('button', { name: `Account menu for ${NEW_NAME}` })).toBeVisible({
      timeout: 10_000,
    });

    // Sessions: both browsers are listed, this one carries the badge.
    const sessions = page.getByRole('table', { name: 'Signed-in sessions' });
    await expect(sessions).toBeVisible({ timeout: 15_000 });
    const current = sessions.getByRole('row').filter({ hasText: 'This browser' });
    await expect(current).toHaveCount(1);
    await expect(current.getByRole('button', { name: 'Sign out of this browser' })).toBeVisible();
    await expect(sessions.getByRole('button', { name: /^End session in / }).first()).toBeVisible();

    // Restore the seeded name before the sessions end.
    await saveDisplayName(page, SEEDED_NAME);
    await expect(page.getByRole('button', { name: `Account menu for ${SEEDED_NAME}` })).toBeVisible({
      timeout: 10_000,
    });

    // Sign out everywhere: confirm in the dialog, land on /sign-in.
    await page.getByRole('button', { name: 'Sign out everywhere' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Sign out everywhere?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Sign out everywhere' }).click();
    await expect(page).toHaveURL(/\/sign-in(\?|$)/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    // This browser's session is gone ...
    await page.goto(`${WORKSPACE_URL}/settings`);
    await expect(page).toHaveURL(/\/sign-in\?return=/, { timeout: 10_000 });
    // ... and so is the other browser's.
    await otherPage.goto(`${WORKSPACE_URL}/settings`);
    await expect(otherPage).toHaveURL(/\/sign-in\?return=/, { timeout: 10_000 });
    await other.close();
  });
});
