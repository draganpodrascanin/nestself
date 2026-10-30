/**
 * Workspace screenshots of the account, people, org units, context picker,
 * expert and participant screens.
 *
 * People in the shots are the fictional sample people only: Ivana (HR admin
 * and owner), Milica (expert, password + authenticator) and Jovan (employee,
 * the participant of `conv_sample`).
 *
 * Created in the disposable e2e database (global setup removes it with the
 * next reset): the import shot imports two invitations for fictional
 * `new.colleague.*@example.com` addresses, plus one row for an existing
 * member that the server refuses, so the result shows both outcomes; the
 * invitations shot then lists the two pending invitations. Every other
 * screen is only looked at.
 */
import { test, expect } from '@playwright/test';
import { removeDeveloperAccount, signInWithEmailCode, signInWithPassword } from '../auth/support';
import { WORKSPACE_URL, shot } from './shots';

const IMPORT_ROWS = [
  'email,templateKey,orgUnit',
  'new.colleague.one@example.com,employee,Product',
  'new.colleague.two@example.com,employee,Sales',
  'user_ana@example.com,employee,Product',
].join('\n');

test.describe.configure({ mode: 'serial' });

test('HR admin: settings, sessions, context picker, people and org units', async ({ page }) => {
  await removeDeveloperAccount();
  await signInWithEmailCode(page, WORKSPACE_URL, 'user_ivana@example.com');

  // Settings: account section, then the sessions list.
  await page.goto(`${WORKSPACE_URL}/settings`);
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible({ timeout: 15_000 });
  const sessions = page.getByRole('table', { name: 'Signed-in sessions' });
  await expect(sessions.getByText('This browser')).toBeVisible({ timeout: 15_000 });
  await shot(page, 'workspace-settings-account');
  await page.getByRole('heading', { level: 2, name: 'Security' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await shot(page, 'workspace-settings-sessions');
  await page.evaluate(() => window.scrollTo(0, 0));

  // Context picker, menu open.
  await page.getByRole('button', { name: /^Working as / }).click();
  await expect(page.getByRole('menu', { name: 'Work as' })).toBeVisible();
  await shot(page, 'workspace-context-picker');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Work as' })).toBeHidden();

  // People: members.
  await page.goto(`${WORKSPACE_URL}/hr/people`);
  const members = page.getByRole('table', { name: 'Members' });
  await expect(members.getByRole('row').filter({ hasText: 'Ana Nikolić' })).toHaveCount(1, { timeout: 15_000 });
  await shot(page, 'workspace-people-members');

  // People: import result (two created, one refused).
  await page.getByRole('tab', { name: 'Invitations' }).click();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const importDialog = page.getByRole('dialog', { name: 'Import invitations' });
  await expect(importDialog).toBeVisible();
  await importDialog.getByLabel('Rows').fill(IMPORT_ROWS);
  await expect(importDialog.getByText('3 rows ready to import')).toBeVisible();
  await importDialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(importDialog.getByText('Import finished')).toBeVisible({ timeout: 15_000 });
  await expect(importDialog.getByText('Created: 2.', { exact: false })).toBeVisible();
  await shot(page, 'workspace-people-import-result');
  await importDialog.getByRole('button', { name: 'Done' }).click();
  await expect(importDialog).toBeHidden();

  // People: pending invitations.
  const pending = page.getByRole('table', { name: 'Pending invitations' });
  await expect(pending.getByRole('row').filter({ hasText: 'new.colleague.two@example.com' })).toHaveCount(1, {
    timeout: 10_000,
  });
  await shot(page, 'workspace-people-invitations');

  // Org units tree.
  await page.goto(`${WORKSPACE_URL}/hr/org-units`);
  const tree = page.getByRole('list', { name: 'Org unit tree' });
  await expect(tree.getByText('Engineering', { exact: true })).toBeVisible({ timeout: 15_000 });
  await shot(page, 'workspace-org-units');
});

test('expert: assigned cases and a case conversation', async ({ page }) => {
  await signInWithPassword(page, WORKSPACE_URL, 'user_milica');
  await page.goto(`${WORKSPACE_URL}/cases`);
  const table = page.getByRole('table', { name: 'Conversations of your assigned cases' });
  await expect(table.getByRole('row').filter({ hasText: 'case_sample' })).toHaveCount(1, { timeout: 15_000 });
  await shot(page, 'workspace-expert-cases');

  await table.getByRole('link', { name: 'Open the conversation of case case_sample' }).first().click();
  await expect(page.getByRole('list', { name: 'Messages, oldest first' }).getByText('Sample reply (fixture)')).toBeVisible({
    timeout: 15_000,
  });
  await shot(page, 'workspace-expert-conversation');
});

test('employee: my conversation with an expert', async ({ page }) => {
  await signInWithEmailCode(page, WORKSPACE_URL, 'user_jovan@example.com');
  await page.goto(`${WORKSPACE_URL}/conversations/conv_sample`);
  await expect(page.getByRole('list', { name: 'Messages, oldest first' }).getByText('Sample message (fixture)')).toBeVisible({
    timeout: 15_000,
  });
  await shot(page, 'workspace-my-conversation');
});
