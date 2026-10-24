/**
 * HR grant administration journey (workspace `/hr/access`).
 *
 * Run with `pnpm e2e:auth` against the seeded database: the seed gives the
 * sample HR admin (user_ivana) the employer_owner template on top of her
 * hr_admin and employee grants, which is what makes `access.preview` and
 * `access.delegate` reachable here.
 *
 * Covered: the grant table, the effective-access preview and delegating
 * part of her own hr_admin grant. Assigning a template and revoking a grant
 * are NOT exercised: no organization template holds `access.grant` or
 * `access.revoke` yet (owner decision pending), so neither control renders
 * for any seeded person. Both are covered by the component tests in
 * `apps/workspace/src/features/access/access-screen.test.tsx` and the API e2e
 * in `apps/api/test/grants.e2e.spec.ts`.
 *
 * The session is fresh, so no step-up dialog fires in this journey.
 *
 * The screen is opened with a full page load (a deep link): the guards wait
 * for the session before deciding, and the Access nav item appears because
 * `/auth/me` carries the effective actions.
 *
 * Re-runs: the API accepts duplicate delegations and Ivana cannot revoke, so
 * every run adds one more delegated grant for Stefan. The assertions only
 * require at least one such row.
 *
 * Labels come from packages/i18n/locales/en/auth.json and workspace.json
 * (`access`).
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const WORKSPACE_URL = 'http://localhost:5173';
const HR_ADMIN_EMAIL = 'user_ivana@example.com';
const FIXED_OTP = '123456';

const EMPLOYEE_NAME = 'Ana Nikolić';
const MANAGER_NAME = 'Stefan Marković';

async function signIn(page: Page) {
  await page.goto(`${WORKSPACE_URL}/sign-in`);
  await page.getByLabel('Email address').fill(HR_ADMIN_EMAIL);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible({
    timeout: 10_000,
  });
  await page.getByLabel('Verification code').fill(FIXED_OTP);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).not.toHaveURL(/\/sign-in/, { timeout: 15_000 });
}

/** Picks a member in the effective-access preview and returns the panel. */
async function previewFor(page: Page, memberName: string) {
  const panel = page.getByRole('region', { name: 'Effective access' });
  await panel.getByRole('combobox', { name: 'Member' }).click();
  await page.getByRole('option', { name: memberName }).click();
  return panel;
}

test.describe('Workspace HR grant administration', () => {
  test('HR admin reviews grants, previews access and delegates part of a grant', async ({
    page,
  }) => {
    await signIn(page);

    // The nav offers the screen (effective actions from /auth/me).
    await expect(page.getByRole('link', { name: 'Access', exact: true })).toBeVisible({ timeout: 15_000 });

    // Deep link with a full page load: the guards wait for the session.
    await page.goto(`${WORKSPACE_URL}/hr/access`);
    await expect(page).toHaveURL(/\/hr\/access$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Access management' })).toBeVisible({
      timeout: 15_000,
    });

    // Grant table: header row plus the seeded grants.
    const table = page.getByRole('table', { name: 'Grants in your organization' });
    await expect(table).toBeVisible({ timeout: 15_000 });
    await expect(table.getByRole('row').nth(1)).toBeVisible();
    await expect(
      table.getByRole('row').filter({ hasText: 'Employer owner' }).filter({ hasText: 'Ivana Jovanović' }),
    ).toHaveCount(1);

    // Effective access for an employee: the employee template's actions.
    const anaPanel = await previewFor(page, EMPLOYEE_NAME);
    await expect(
      anaPanel.getByRole('list', { name: 'content' }).getByText('content.read', { exact: true }),
    ).toBeVisible({ timeout: 10_000 });

    // Delegate people.invite from Ivana's own hr_admin grant to Stefan.
    await page.getByRole('button', { name: 'Delegate part of HR administrator' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delegate part of your access' });
    await expect(dialog).toBeVisible();
    // Keyboard, not a pointer click: the select's popup is layered below the
    // dialog (--z-dropdown 20 < --z-dialog 40), so the dialog intercepts
    // clicks on its options. Reported; the keyboard path is unaffected.
    const member = dialog.getByRole('combobox', { name: 'Member' });
    await member.click();
    await expect(page.getByRole('option', { name: MANAGER_NAME })).toBeVisible();
    await page.keyboard.type('Stefan');
    await page.keyboard.press('Enter');
    await expect(member).toHaveText(MANAGER_NAME);
    await dialog.getByRole('checkbox', { name: 'people.invite', exact: true }).click();
    await dialog.getByRole('button', { name: 'Delegate', exact: true }).click();

    await expect(page.getByText('Access delegated.')).toBeVisible({ timeout: 10_000 });
    await expect(dialog).toBeHidden();

    // At least one delegated row for Stefan (earlier runs may have added more).
    const delegatedRows = table
      .getByRole('row')
      .filter({ hasText: 'Delegated access' })
      .filter({ hasText: MANAGER_NAME });
    await expect(delegatedRows.first()).toBeVisible({ timeout: 10_000 });

    // Not asserted: Stefan's effective access. The engine only accepts a
    // delegated grant when its parent chain is in the context, and the
    // context loader loads the subject's own grants only, so the delegation
    // does not show in the preview yet (reported with Task 15).
  });
});
