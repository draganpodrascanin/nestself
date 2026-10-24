/**
 * Workspace screenshots for the auth guides: sign-in, the access screen, its
 * dialogs and the step-up dialog. Signs in as the sample HR admin and
 * employer owner (user_ivana) against the freshly seeded e2e database.
 *
 * Nothing is created or changed: every dialog is cancelled. The one stubbed
 * response is the step-up trigger: the first `POST /orgs/:orgId/grants` is
 * answered in the browser with the API's own 403 `step_up_required` body, as
 * the server would after 30 minutes, so the real dialog opens and starts a
 * real challenge against the stub API.
 */
import { test, expect } from '@playwright/test';
import { WORKSPACE_URL, pick, shot } from './shots';

const HR_ADMIN_EMAIL = 'user_ivana@example.com';
const FIXED_OTP = '123456';
const EMPLOYEE_NAME = 'Ana Nikolić';
const MANAGER_NAME = 'Stefan Marković';

test.describe.configure({ mode: 'serial' });

test('workspace sign-in, access screen, dialogs and step-up', async ({ page }) => {
  // Sign-in, identifier step.
  await page.goto(`${WORKSPACE_URL}/sign-in`);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email address').fill(HR_ADMIN_EMAIL);
  await shot(page, 'workspace-sign-in-identifier');

  // Email-code step.
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible({ timeout: 10_000 });
  await shot(page, 'workspace-sign-in-code');
  await page.getByLabel('Verification code').fill(FIXED_OTP);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).not.toHaveURL(/\/sign-in/, { timeout: 15_000 });

  // Access screen.
  await page.goto(`${WORKSPACE_URL}/hr/access`);
  await expect(page.getByRole('heading', { level: 1, name: 'Access management' })).toBeVisible({ timeout: 15_000 });
  const table = page.getByRole('table', { name: 'Grants in your organization' });
  await expect(
    table.getByRole('row').filter({ hasText: 'Employer owner' }).filter({ hasText: 'Ivana Jovanović' }),
  ).toHaveCount(1, { timeout: 15_000 });
  await shot(page, 'workspace-access');

  // Effective-access panel for an employee.
  const panel = page.getByRole('region', { name: 'Effective access' });
  await pick(page, panel, 'Member', EMPLOYEE_NAME);
  await expect(panel.getByText('content.read', { exact: true })).toBeVisible({ timeout: 10_000 });
  await panel.scrollIntoViewIfNeeded();
  await panel.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await shot(page, 'workspace-effective-access');
  await page.evaluate(() => window.scrollTo(0, 0));

  // Assign dialog, filled in and cancelled.
  await page.getByRole('button', { name: 'Assign template' }).click();
  const assign = page.getByRole('dialog', { name: 'Assign a permission template' });
  await expect(assign).toBeVisible();
  await pick(page, assign, 'Member', EMPLOYEE_NAME);
  await pick(page, assign, 'Template', 'Team manager');
  await pick(page, assign, 'Org unit', 'Product');
  await assign.getByLabel('Amount').fill('500');
  await assign.getByLabel('Currency').fill('EUR');
  await shot(page, 'workspace-assign-template');

  // Step-up: the next create answers step_up_required once (see the header).
  let stubbed = false;
  await page.route(/\/api\/orgs\/[^/]+\/grants$/, async (route) => {
    if (stubbed || route.request().method() !== 'POST') return route.fallback();
    stubbed = true;
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'step_up_required',
        message: 'Re-authentication required for this action',
        details: { stepUpClass: 'administration', maxAge: 1800, method: 'email_otp' },
      }),
    });
  });
  const challenge = page.waitForResponse(
    (res) => res.request().method() === 'POST' && new URL(res.url()).pathname.endsWith('/auth/step-up/start'),
  );
  await assign.getByRole('button', { name: 'Assign', exact: true }).click();
  const stepUp = page.getByRole('dialog', { name: 'Verify your identity' });
  await expect(stepUp).toBeVisible({ timeout: 10_000 });
  expect((await challenge).status()).toBe(200);
  await shot(page, 'step-up-dialog');
  // Cancel: nothing is assigned (the create is not retried).
  await stepUp.getByRole('button', { name: 'Cancel' }).click();
  await expect(stepUp).toBeHidden();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  // The assign dialog stays open (Cancel disabled while the call settles); close it.
  await expect(async () => {
    if (await assign.isVisible()) await assign.getByRole('button', { name: 'Cancel' }).click({ timeout: 1_000 });
    await expect(assign).toBeHidden({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });

  // Transfer-ownership dialog with a new owner chosen, cancelled.
  await page.getByRole('button', { name: 'Transfer ownership' }).click();
  const transfer = page.getByRole('dialog', { name: 'Transfer ownership' });
  await expect(transfer).toBeVisible();
  await pick(page, transfer, 'New owner', MANAGER_NAME);
  await shot(page, 'workspace-transfer-ownership');
  await transfer.getByRole('button', { name: 'Cancel' }).click();
  await expect(transfer).toBeHidden();

  // Ivana is still the owner.
  await expect(
    table.getByRole('row').filter({ hasText: 'Employer owner' }).filter({ hasText: 'Ivana Jovanović' }),
  ).toHaveCount(1);
});
