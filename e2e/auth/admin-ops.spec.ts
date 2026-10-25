/**
 * Operations journey in the admin app: organizations, people, emergency
 * access and the user lookup.
 *
 * Staged data (disposable e2e database only, removed by the next global
 * setup): the seed has no platform owner, so before anyone signs in this file
 * inserts a `platform_owner` grant for Nikola (`grant_user_nikola_platform_owner_e2e`)
 * and one for Milica (`grant_user_milica_platform_owner_e2e`). Milica is a
 * seeded password user, so she can act as the second staff member that
 * emergency access needs: the fake identity provider runs in the API process
 * and cannot be given a new user from here, so a new approver account is not
 * possible (the API e2e does that in-process).
 *
 * Covered:
 * - organizations list -> org_sample -> People tab lists the members;
 * - emergency access: Nikola requests access to `case_sample`; on his own
 *   pending request Approve and Deny are hidden; Milica approves it in a
 *   second browser; Nikola opens the record view, which shows the audited
 *   notice, and reads `conv_sample`;
 * - user lookup for user_jovan offers Suspend; the dialog is opened and
 *   cancelled, nobody is suspended.
 *
 * Re-runs: the request purpose carries the run's timestamp; the approved
 * request stays in the list until the database is reseeded.
 *
 * Labels come from packages/i18n/locales/en/admin.json.
 */
import { test, expect } from '@playwright/test';
import { ADMIN_URL, signInWithPassword, stagePlatformGrant } from './support';

const SAMPLE_ORG_NAME = 'Example d.o.o.';

test.describe('Admin operations', () => {
  test.beforeAll(async () => {
    await stagePlatformGrant('grant_user_nikola_platform_owner_e2e', 'user_nikola', 'platform_owner');
    await stagePlatformGrant('grant_user_milica_platform_owner_e2e', 'user_milica', 'platform_owner');
  });

  test('organizations, people tab, emergency access with a second approver, user lookup', async ({
    page,
    browser,
  }) => {
    const run = Date.now().toString(36);
    const purpose = `End-to-end check ${run}: urgent welfare follow-up on the sample case.`;

    await signInWithPassword(page, ADMIN_URL, 'user_nikola');
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 15_000 });

    // Organizations list -> sample organization -> People tab.
    await page.getByRole('link', { name: 'Organisations', exact: true }).click();
    const orgs = page.getByRole('table', { name: 'Organisations' });
    await expect(orgs).toBeVisible({ timeout: 15_000 });
    await orgs.getByRole('link', { name: SAMPLE_ORG_NAME }).click();
    await expect(page).toHaveURL(/\/organizations\/org_sample/);
    await page.getByRole('navigation', { name: 'Organisation sections' }).getByRole('link', { name: 'People' }).click();
    await expect(page).toHaveURL(/\/organizations\/org_sample\/people$/);
    const members = page.getByRole('table', { name: 'Members' });
    await expect(members.getByRole('row').filter({ hasText: 'Ana Nikolić' })).toHaveCount(1, { timeout: 15_000 });
    await expect(members.getByRole('row').filter({ hasText: 'Ivana Jovanović' })).toHaveCount(1);

    // Emergency access: request for the sample case.
    await page.getByRole('link', { name: 'Emergency access', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Emergency access' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Request access' }).click();
    const request = page.getByRole('dialog', { name: 'Request emergency access' });
    await expect(request).toBeVisible();
    await request.getByLabel('Purpose').fill(purpose);
    await request.getByRole('radio', { name: 'Case' }).check();
    await request.getByLabel('Case ID').fill('case_sample');
    await request.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText('Emergency access requested.').first()).toBeVisible({ timeout: 10_000 });
    await expect(request).toBeHidden();

    const table = page.getByRole('table', { name: 'Emergency access' });
    const row = table.getByRole('row').filter({ hasText: purpose });
    await expect(row).toHaveCount(1, { timeout: 10_000 });
    await expect(row).toContainText('Pending');
    await expect(row).toContainText('user_nikola (you)');
    // The own-request rule: no Approve or Deny on one's own request.
    await expect(row).toContainText('Waiting for another staff member to approve.');
    await expect(row.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Deny' })).toHaveCount(0);

    // A second staff member approves it.
    const approverContext = await browser.newContext();
    const approver = await approverContext.newPage();
    await signInWithPassword(approver, ADMIN_URL, 'user_milica');
    await approver.goto(`${ADMIN_URL}/emergency`);
    const approverRow = approver
      .getByRole('table', { name: 'Emergency access' })
      .getByRole('row')
      .filter({ hasText: purpose });
    await expect(approverRow).toHaveCount(1, { timeout: 15_000 });
    await expect(approverRow.getByRole('button', { name: 'Deny' })).toBeVisible();
    await approverRow.getByRole('button', { name: 'Approve' }).click();
    const approve = approver.getByRole('alertdialog', { name: 'Approve this emergency access?' });
    await expect(approve).toBeVisible();
    await approve.getByRole('button', { name: 'Approve' }).click();
    await expect(approver.getByText('Emergency access approved.').first()).toBeVisible({ timeout: 10_000 });
    await expect(approverRow).toContainText('Active', { timeout: 10_000 });
    await approverContext.close();

    // The requester opens the audited record view and reads the conversation.
    await page.reload();
    await expect(row).toContainText('Active', { timeout: 15_000 });
    await expect(row).toContainText('user_milica');
    await row.getByRole('button', { name: 'Open record' }).click();
    const viewer = page.getByRole('dialog', { name: 'Read a record under emergency access' });
    await expect(viewer).toBeVisible();
    await expect(viewer.getByText('This access is audited')).toBeVisible();
    await expect(viewer.getByText('Every read here is audited and attributed to you.')).toBeVisible();
    await viewer.getByLabel('Record ID').fill('conv_sample');
    await viewer.getByRole('button', { name: 'Read record' }).click();
    const content = viewer.getByRole('region', { name: 'Record content' });
    await expect(content.getByText('Sample message (fixture)')).toBeVisible({ timeout: 10_000 });
    await expect(viewer.getByText('This access is audited')).toBeVisible();
    await viewer.getByRole('button', { name: 'Close' }).first().click();
    await expect(viewer).toBeHidden();

    // User lookup: Suspend is offered for another user; cancelled.
    await page.goto(`${ADMIN_URL}/access`);
    const lookup = page.getByRole('region', { name: 'User access' });
    await lookup.getByLabel('User ID').fill('user_jovan');
    await lookup.getByRole('button', { name: 'Look up' }).click();
    const account = page.getByRole('region', { name: 'Account' });
    await expect(account).toContainText('Active', { timeout: 15_000 });
    await account.getByRole('button', { name: 'Suspend user' }).click();
    const suspend = page.getByRole('alertdialog', { name: 'Suspend this user?' });
    await expect(suspend).toBeVisible();
    await suspend.getByRole('button', { name: 'Cancel' }).click();
    await expect(suspend).toBeHidden();
    await expect(account).toContainText('Active');

    // No step-up dialog fired (fresh session).
    await expect(page.getByRole('dialog', { name: 'Verify your identity' })).toHaveCount(0);
  });
});
