/**
 * Admin screenshots of the operations screens: organizations, an
 * organization's people, emergency access (list and the audited record view)
 * and the suspend dialog of the user lookup. Signs in as the sample
 * operations user (user_nikola) after admin.shot.ts has enrolled him (files
 * run in name order; the persisted secret answers the authenticator screen).
 *
 * Staged in the disposable e2e database before signing in (global setup
 * removes everything with the next reset):
 * - the `platform_owner` grant for Nikola that admin.shot.ts also stages
 *   (`grant_user_nikola_platform_owner_screenshots`, idempotent);
 * - two emergency access rows whose purposes start with "Staged for the
 *   guide screenshots": one pending request by user_milica (so Approve and
 *   Deny show) and one approved request by Nikola for `case_sample`,
 *   approved by user_milica, so "Open record" shows. The approval is staged
 *   in SQL; the real two-person flow is covered by e2e/auth/admin-ops.spec.ts.
 *
 * Nothing else is created or changed: the suspend dialog is captured open and
 * cancelled, the record read is a read.
 */
import { test, expect } from '@playwright/test';
import { e2eSql, removeDeveloperAccount, signInWithPassword, stagePlatformGrant } from '../auth/support';
import { ADMIN_URL, shot } from './shots';

const SAMPLE_ORG_ID = 'org_sample';

async function stageEmergencyRows(): Promise<void> {
  await e2eSql([
    {
      text: `insert into emergency_access
               (id, user_id, approved_by_user_id, approved_at, purpose, scope_kind, scope_id,
                requested_duration_minutes, granted_at, expires_at)
             values ($1, 'user_nikola', 'user_milica', now() - interval '5 minutes', $2, 'CASE', 'case_sample',
                     60, now() - interval '5 minutes', now() + interval '55 minutes')
             on conflict (id) do nothing`,
      values: [
        'emergency_screenshots_active',
        'Staged for the guide screenshots: welfare follow-up on the sample case after an urgent report.',
      ],
    },
    {
      text: `insert into emergency_access
               (id, user_id, purpose, scope_kind, scope_id, requested_duration_minutes, granted_at, expires_at)
             values ($1, 'user_milica', $2, 'USER_RECORDS', 'user_ana', 120, now(), now() + interval '120 minutes')
             on conflict (id) do nothing`,
      values: [
        'emergency_screenshots_pending',
        'Staged for the guide screenshots: records needed to answer a formal request about the sample employee.',
      ],
    },
  ]);
}

test.describe.configure({ mode: 'serial' });

test('admin organizations, people, emergency access and user suspension', async ({ page }) => {
  await removeDeveloperAccount();
  await stagePlatformGrant('grant_user_nikola_platform_owner_screenshots', 'user_nikola', 'platform_owner');
  await stageEmergencyRows();

  await signInWithPassword(page, ADMIN_URL, 'user_nikola');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 15_000 });

  // Organizations list.
  await page.goto(`${ADMIN_URL}/organizations`);
  const orgs = page.getByRole('table', { name: 'Organisations' });
  await expect(orgs.getByRole('link', { name: 'Example d.o.o.' })).toBeVisible({ timeout: 15_000 });
  await shot(page, 'admin-organizations');

  // An organization's People tab.
  await page.goto(`${ADMIN_URL}/organizations/${SAMPLE_ORG_ID}/people`);
  const members = page.getByRole('table', { name: 'Members' });
  await expect(members.getByRole('row').filter({ hasText: 'Ana Nikolić' })).toHaveCount(1, { timeout: 15_000 });
  await shot(page, 'admin-org-people');

  // Emergency access list: one pending request by someone else, one active of his own.
  await page.goto(`${ADMIN_URL}/emergency`);
  const table = page.getByRole('table', { name: 'Emergency access' });
  const active = page.getByTestId('emergency-row-emergency_screenshots_active');
  await expect(active).toContainText('Active', { timeout: 15_000 });
  await expect(page.getByTestId('emergency-row-emergency_screenshots_pending').getByRole('button', { name: 'Approve' })).toBeVisible();
  await expect(table).toBeVisible();
  await shot(page, 'admin-emergency-list');

  // The audited record view after reading the sample conversation.
  await active.getByRole('button', { name: 'Open record' }).click();
  const viewer = page.getByRole('dialog', { name: 'Read a record under emergency access' });
  await expect(viewer.getByText('This access is audited')).toBeVisible();
  await viewer.getByLabel('Record ID').fill('conv_sample');
  await viewer.getByRole('button', { name: 'Read record' }).click();
  await expect(viewer.getByRole('region', { name: 'Record content' }).getByText('Sample message (fixture)')).toBeVisible({
    timeout: 10_000,
  });
  await shot(page, 'admin-emergency-record');
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();

  // User lookup: the suspend dialog, open and not confirmed.
  await page.goto(`${ADMIN_URL}/access`);
  const lookup = page.getByRole('region', { name: 'User access' });
  await lookup.getByLabel('User ID').fill('user_jovan');
  await lookup.getByRole('button', { name: 'Look up' }).click();
  const account = page.getByRole('region', { name: 'Account' });
  await expect(account).toContainText('Active', { timeout: 15_000 });
  await account.getByRole('button', { name: 'Suspend user' }).click();
  const suspend = page.getByRole('alertdialog', { name: 'Suspend this user?' });
  await expect(suspend).toBeVisible();
  await suspend.getByLabel('Reason').fill('Account reported as compromised; suspend until the owner confirms.');
  await shot(page, 'admin-user-suspend');
  await suspend.getByRole('button', { name: 'Cancel' }).click();
  await expect(suspend).toBeHidden();
  await expect(account).toContainText('Active');
});
