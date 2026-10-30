/**
 * HR people and org units journey (workspace `/hr/people`, `/hr/org-units`).
 *
 * Ivana (sample HR admin and employer owner, email code, fresh session so no
 * step-up dialog fires) invites a new fictional address with the employee
 * template and sees it pending, revokes it, moves Ana to another org unit and
 * back, and adds an org unit under the company and renames it.
 *
 * Ending a membership is not run: it would remove a seeded member that later
 * runs and journeys rely on. The test opens the End dialog and cancels it.
 *
 * Re-runs: the invited address and the unit names carry the run's timestamp,
 * so they never collide even if the database were not reseeded. Created
 * invitations end revoked; the new org unit stays (there is no delete route)
 * until global setup reseeds the database on the next run.
 *
 * Labels come from packages/i18n/locales/en/workspace.json (`people`, `orgUnits`).
 */
import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { WORKSPACE_URL, signInWithEmailCode } from './support';

const EMAIL = 'user_ivana@example.com';
const EMPLOYEE_NAME = 'Ana Nikolić';
const COMPANY_UNIT = 'Example d.o.o.';
const OTHER_UNIT = 'Sales';

async function pick(page: Page, scope: Locator, label: string, option: string) {
  const combobox = scope.getByRole('combobox', { name: label });
  await combobox.click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(combobox).toHaveText(option);
}

async function moveAna(page: Page, members: Locator, unit: string) {
  await members.getByRole('button', { name: `Move ${EMPLOYEE_NAME}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Move member' });
  await expect(dialog).toBeVisible();
  await pick(page, dialog, 'Org unit', unit);
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText(`${EMPLOYEE_NAME} was moved.`).first()).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toBeHidden();
  await expect(members.getByRole('row').filter({ hasText: EMPLOYEE_NAME })).toContainText(unit, { timeout: 10_000 });
}

test.describe('Workspace HR people and org units', () => {
  test('invite and revoke, move a member and back, add and rename an org unit', async ({ page }) => {
    const run = Date.now().toString(36);
    const invitee = `new.colleague.${run}@example.com`;

    await signInWithEmailCode(page, WORKSPACE_URL, EMAIL);
    await expect(page.getByRole('link', { name: 'People', exact: true })).toBeVisible({ timeout: 15_000 });
    await page.goto(`${WORKSPACE_URL}/hr/people`);
    await expect(page.getByRole('heading', { level: 1, name: 'People' })).toBeVisible({ timeout: 15_000 });

    // Members: Ana is listed; remember her org unit to move her back later.
    const members = page.getByRole('table', { name: 'Members' });
    const anaRow = members.getByRole('row').filter({ hasText: EMPLOYEE_NAME });
    await expect(anaRow).toHaveCount(1, { timeout: 15_000 });
    // The org-unit cell, found by its column header rather than its position.
    const headers = await members.getByRole('columnheader').allTextContents();
    const unitColumn = headers.findIndex((h) => h.trim() === 'Org unit');
    expect(unitColumn, 'the members table has an Org unit column').toBeGreaterThanOrEqual(0);
    const originalUnit = ((await anaRow.getByRole('cell').nth(unitColumn).textContent()) ?? '').trim();
    expect(originalUnit.length).toBeGreaterThan(0);
    expect(originalUnit).not.toBe(OTHER_UNIT);

    // End membership: the dialog opens and is cancelled (nothing ends).
    await anaRow.getByRole('button', { name: `End the membership of ${EMPLOYEE_NAME}` }).click();
    const end = page.getByRole('alertdialog', { name: 'End membership' });
    await expect(end).toBeVisible();
    await expect(end).toContainText(`End the membership of ${EMPLOYEE_NAME}?`);
    await end.getByRole('button', { name: 'Cancel' }).click();
    await expect(end).toBeHidden();
    await expect(anaRow).toContainText('Active');

    // Move Ana to another unit, then back.
    await moveAna(page, members, OTHER_UNIT);
    await moveAna(page, members, originalUnit);

    // Invite a new fictional address with the employee template.
    await page.getByRole('tab', { name: 'Invitations' }).click();
    await page.getByRole('button', { name: 'Invite', exact: true }).click();
    const invite = page.getByRole('dialog', { name: 'Invite a person' });
    await expect(invite).toBeVisible();
    await invite.getByLabel('Email address').fill(invitee);
    await pick(page, invite, 'Permission template', 'Employee');
    await invite.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText(`An invitation was created for ${invitee}.`).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(invite).toBeHidden();

    const pending = page.getByRole('table', { name: 'Pending invitations' });
    const inviteRow = pending.getByRole('row').filter({ hasText: invitee });
    await expect(inviteRow).toHaveCount(1, { timeout: 10_000 });
    await expect(inviteRow).toContainText('Employee');

    // Revoke it: the row leaves the pending list.
    await inviteRow.getByRole('button', { name: `Revoke the invitation for ${invitee}` }).click();
    const revoke = page.getByRole('alertdialog', { name: 'Revoke invitation' });
    await expect(revoke).toBeVisible();
    await revoke.getByRole('button', { name: 'Revoke invitation' }).click();
    await expect(page.getByText(`The invitation for ${invitee} was revoked.`).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(pending.getByRole('row').filter({ hasText: invitee })).toHaveCount(0, { timeout: 10_000 });

    // Org units: add a department under the company, then rename it.
    const unitName = `Research ${run}`;
    const renamed = `Research and development ${run}`;
    await page.getByRole('link', { name: 'Org units', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Org units' })).toBeVisible({ timeout: 15_000 });
    const tree = page.getByRole('list', { name: 'Org unit tree' });
    await expect(tree.getByText(COMPANY_UNIT, { exact: true })).toBeVisible({ timeout: 15_000 });

    await tree.getByRole('button', { name: `Add a unit under ${COMPANY_UNIT}` }).click();
    const add = page.getByRole('dialog', { name: 'Add org unit' });
    await expect(add).toBeVisible();
    await add.getByLabel('Name').fill(unitName);
    await pick(page, add, 'Kind', 'Department');
    await add.getByRole('button', { name: 'Add unit' }).click();
    await expect(page.getByText(`${unitName} was added.`).first()).toBeVisible({ timeout: 10_000 });
    await expect(add).toBeHidden();
    await expect(tree.getByText(unitName, { exact: true })).toBeVisible({ timeout: 10_000 });

    await tree.getByRole('button', { name: `Rename ${unitName}` }).click();
    const rename = page.getByRole('dialog', { name: 'Rename org unit' });
    await expect(rename).toBeVisible();
    await rename.getByLabel('Name').fill(renamed);
    await rename.getByRole('button', { name: 'Save name' }).click();
    await expect(page.getByText(`The org unit is now called ${renamed}.`).first()).toBeVisible({ timeout: 10_000 });
    await expect(tree.getByText(renamed, { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(tree.getByText(unitName, { exact: true })).toHaveCount(0);

    // No step-up dialog fired during the run (fresh session).
    await expect(page.getByRole('dialog', { name: 'Verify your identity' })).toHaveCount(0);
  });
});
