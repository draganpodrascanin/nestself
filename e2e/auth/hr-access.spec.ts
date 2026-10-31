/**
 * HR grant administration journey (workspace `/hr/access`).
 *
 * Run with `pnpm e2e:auth` against the seeded database: the seed gives the
 * sample HR admin (user_ivana) the employer_owner template on top of her
 * hr_admin and employee grants, which is what makes `access.preview` and
 * `access.delegate` reachable here.
 *
 * Covered: the grant table, the effective-access preview, delegating part
 * of her own hr_admin grant, and (since the owner model of 2026-10-24 gave
 * employer_owner `access.grant` and `access.revoke`) assigning team_manager
 * to Ana and revoking it again with a reason. The member fields of the
 * effective-access panel and the assign dialog search through the API
 * (`GET /orgs/:orgId/members?search=`, a prefix of the name or the email).
 *
 * The second journey is the employer owner who holds no HR template: Ivana
 * hands the ownership to Stefan, who has `access.preview` (owner template)
 * but not `program.overview`. He sees Access in the navigation and no HR area,
 * opens `/hr/access` and the page reads the organization's members, org units
 * and grants with his session. He then hands the ownership back, so the rest
 * of the run (and the seed's single owner) is as it was. The component tests
 * in `apps/workspace/src/features/access/access-screen.test.tsx` cover the
 * transfer dialog itself and the API e2e the authorization.
 *
 * The session is fresh, so no step-up dialog fires in these journeys.
 *
 * The screen is opened with a full page load (a deep link): the guards wait
 * for the session before deciding, and the Access nav item appears because
 * `/auth/me` carries the effective actions.
 *
 * Re-runs: the API accepts duplicate delegations, so every run adds one more
 * delegated grant for Stefan; the assertions only require at least one such
 * row. The team_manager grant for Ana is found by the id in the create
 * response and revoked in the same run; revoked rows accumulate, and the
 * assertions count them relative to the start of the run.
 *
 * Labels come from packages/i18n/locales/en/auth.json and workspace.json
 * (`access`).
 */
import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

const WORKSPACE_URL = 'http://localhost:5173';
const HR_ADMIN_EMAIL = 'user_ivana@example.com';
const MANAGER_EMAIL = 'user_stefan@example.com';
const FIXED_OTP = '123456';

const HR_ADMIN_NAME = 'Ivana Jovanović';
const EMPLOYEE_NAME = 'Ana Nikolić';
const MANAGER_NAME = 'Stefan Marković';
/** A seeded org unit of org_sample (packages/sample-data, org-units.ts). */
const ORG_UNIT_NAME = 'Product';

async function signIn(page: Page, email = HR_ADMIN_EMAIL) {
  await page.goto(`${WORKSPACE_URL}/sign-in`);
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible({
    timeout: 10_000,
  });
  await page.getByLabel('Verification code').fill(FIXED_OTP);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).not.toHaveURL(/\/sign-in/, { timeout: 15_000 });
}

/** Opens a select inside a dialog and picks an option (the popup is portalled). */
async function pick(page: Page, scope: Locator, label: string, option: string) {
  const combobox = scope.getByRole('combobox', { name: label });
  await combobox.click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(combobox).toHaveText(option);
}

/**
 * Types `term` into the "Search members" field inside `scope` and waits for the
 * API to answer that search (`GET /orgs/:orgId/members?search=<term>`, sent
 * once the typing pauses).
 */
async function searchMembers(page: Page, scope: Locator, term: string) {
  const answered = page.waitForResponse((res) => {
    const url = new URL(res.url());
    return (
      res.request().method() === 'GET' &&
      /\/api\/orgs\/[^/]+\/members$/.test(url.pathname) &&
      url.searchParams.get('search') === term
    );
  });
  await scope.getByRole('searchbox', { name: 'Search members' }).fill(term);
  expect((await answered).status()).toBe(200);
}

/**
 * Searches for a member in the effective-access preview, picks them and returns the panel.
 * `stillChosen` is who the preview showed before: a new search rebuilds the list under
 * that choice, and the choice has to survive until the new pick replaces it. After the
 * pick, the list is rebuilt again (the previous member drops out); Base UI's Select then
 * reports `null` by itself in Chromium, which must neither clear the field nor the preview.
 */
async function previewFor(page: Page, memberName: string, stillChosen?: string) {
  const panel = page.getByRole('region', { name: 'Effective access' });
  const member = panel.getByRole('combobox', { name: 'Member' });
  await searchMembers(page, panel, memberName.split(' ')[0]!);
  if (stillChosen) await expect(member).toHaveText(stillChosen);
  await member.click();
  await page.getByRole('option', { name: memberName }).click();
  await expect(member).toHaveText(memberName);
  // The pick reached the preview: its actions (or "no actions") are shown, not an empty panel.
  await expect(
    panel.getByRole('list').first().or(panel.getByText('This member has no actions in this organization.')),
  ).toBeVisible({ timeout: 10_000 });
  return panel;
}

/** Ends the session through the account menu and waits for the sign-in page. */
async function signOut(page: Page) {
  await page.getByRole('button', { name: /^Account menu for / }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in(\?|$)/, { timeout: 10_000 });
}

/** The owner, on the Access page, hands the ownership to `memberName` (a fresh session needs no step-up). */
async function transferOwnershipTo(page: Page, memberName: string) {
  await page.getByRole('button', { name: 'Transfer ownership', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Transfer ownership' });
  await expect(dialog).toBeVisible();
  await pick(page, dialog, 'New owner', memberName);
  await dialog.getByRole('button', { name: 'Transfer ownership', exact: true }).click();
  await expect(page.getByText('Ownership transferred.')).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toBeHidden();
}

test.describe('Workspace HR grant administration', () => {
  test('HR admin reviews grants, previews access, delegates, assigns and revokes', async ({
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

    // Effective access for an employee: the employee template's actions. The
    // member is found by searching (the API matches the start of the name or
    // the email), so only the matches are offered.
    const anaPanel = page.getByRole('region', { name: 'Effective access' });
    await searchMembers(page, anaPanel, 'Ana');
    await anaPanel.getByRole('combobox', { name: 'Member' }).click();
    await expect(page.getByRole('option', { name: EMPLOYEE_NAME })).toBeVisible();
    await expect(page.getByRole('option', { name: MANAGER_NAME })).toHaveCount(0);
    await page.getByRole('option', { name: EMPLOYEE_NAME }).click();
    await expect(anaPanel.getByRole('combobox', { name: 'Member' })).toHaveText(EMPLOYEE_NAME);
    await expect(
      anaPanel.getByRole('list', { name: 'content' }).getByText('content.read', { exact: true }),
    ).toBeVisible({ timeout: 10_000 });

    // Delegate people.invite from Ivana's own hr_admin grant to Stefan.
    await page.getByRole('button', { name: 'Delegate part of HR administrator' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delegate part of your access' });
    await expect(dialog).toBeVisible();
    // A pointer click on the option: the select's popup layers above the
    // dialog (--z-popup, set on the dialog's portal element).
    const member = dialog.getByRole('combobox', { name: 'Member' });
    await member.click();
    await page.getByRole('option', { name: MANAGER_NAME }).click();
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

    // The delegation takes effect for Stefan: his effective access now lists
    // people.invite (the context carries the delegated grant's parent chain).
    const stefanPanel = await previewFor(page, MANAGER_NAME, EMPLOYEE_NAME);
    await expect(stefanPanel.getByText('people.invite', { exact: true })).toBeVisible({ timeout: 10_000 });

    // Owner-driven assignment: team_manager for Ana on one org unit, with the
    // spending ceiling the template requires. The grant id comes from the
    // create response, so the run revokes exactly the grant it created.
    const anaManagerRows = table.getByRole('row').filter({ hasText: 'Team manager' }).filter({ hasText: EMPLOYEE_NAME });
    const revokedBefore = await anaManagerRows.filter({ hasText: 'Revoked' }).count();

    await page.getByRole('button', { name: 'Assign template' }).click();
    const assign = page.getByRole('dialog', { name: 'Assign a permission template' });
    await expect(assign).toBeVisible();
    // The dialog's member field searches too (here by the start of the email,
    // underscore included: the API takes it literally); the delegation above
    // picked from the plain list. A repeated search would be answered from the
    // query cache without a request, hence not "Ana" again.
    await searchMembers(page, assign, 'user_ana');
    await pick(page, assign, 'Member', EMPLOYEE_NAME);
    await pick(page, assign, 'Template', 'Team manager');
    await pick(page, assign, 'Org unit', ORG_UNIT_NAME);
    await assign.getByLabel('Amount').fill('500');
    await assign.getByLabel('Currency').fill('EUR');
    const created = page.waitForResponse(
      (res) => res.request().method() === 'POST' && /\/api\/orgs\/[^/]+\/grants$/.test(new URL(res.url()).pathname),
    );
    await assign.getByRole('button', { name: 'Assign', exact: true }).click();
    const createdResponse = await created;
    expect(createdResponse.status()).toBe(201);
    const { id: createdId } = (await createdResponse.json()) as { id: string };

    await expect(page.getByText('Template assigned.')).toBeVisible({ timeout: 10_000 });
    await expect(assign).toBeHidden();
    const createdRow = table.locator(`tr[data-grant-id="${createdId}"]`);
    await expect(createdRow).toContainText('Team manager');
    await expect(createdRow).toContainText(EMPLOYEE_NAME);
    await expect(createdRow).toContainText('Active');

    // Revoke that grant with a reason; the row stays, marked Revoked.
    await createdRow.getByRole('button', { name: `Revoke Team manager from ${EMPLOYEE_NAME}` }).click();
    const revoke = page.getByRole('alertdialog', { name: 'Revoke this grant?' });
    await expect(revoke).toBeVisible();
    await revoke.getByLabel('Reason').fill('End-to-end run clean-up');
    await revoke.getByRole('button', { name: 'Revoke grant' }).click();

    await expect(page.getByText('Grant revoked.')).toBeVisible({ timeout: 10_000 });
    await expect(revoke).toBeHidden();
    await expect(createdRow).toContainText('Revoked', { timeout: 10_000 });
    await expect(createdRow.getByRole('button', { name: /^Revoke/ })).toHaveCount(0);
    await expect(anaManagerRows.filter({ hasText: 'Revoked' })).toHaveCount(revokedBefore + 1);
  });

  test('an employer owner without HR rights reaches Access and the page reads the organization with that session', async ({
    page,
  }) => {
    // Ivana hands the ownership to Stefan, the team manager.
    await signIn(page);
    await page.goto(`${WORKSPACE_URL}/hr/access`);
    await expect(page.getByRole('heading', { level: 1, name: 'Access management' })).toBeVisible({
      timeout: 15_000,
    });
    await transferOwnershipTo(page, MANAGER_NAME);
    await signOut(page);

    // Stefan owns the organization but holds no HR template: the navigation
    // offers Access (access.preview) and not the HR area (program.overview).
    await signIn(page, MANAGER_EMAIL);
    await expect(page.getByRole('link', { name: 'Access', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: 'Employer space' })).toHaveCount(0);

    // A full page load on the deep link, the guards waiting for his session.
    await page.goto(`${WORKSPACE_URL}/hr/access`);
    await expect(page).toHaveURL(/\/hr\/access$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Access management' })).toBeVisible({
      timeout: 15_000,
    });

    // The page read the grants, the members and the org units with his session:
    // the rows name people (members) and the org unit of his own manager grant.
    const table = page.getByRole('table', { name: 'Grants in your organization' });
    await expect(table).toBeVisible({ timeout: 15_000 });
    await expect(
      table.getByRole('row').filter({ hasText: 'Employer owner' }).filter({ hasText: MANAGER_NAME }).filter({ hasText: 'Active' }),
    ).toHaveCount(1);
    await expect(
      table.getByRole('row').filter({ hasText: 'HR administrator' }).filter({ hasText: HR_ADMIN_NAME }).first(),
    ).toBeVisible();
    await expect(
      table.getByRole('row').filter({ hasText: 'Team manager' }).filter({ hasText: MANAGER_NAME }).first(),
    ).toContainText(ORG_UNIT_NAME);
    await expect(page.getByText('Members could not be loaded')).toHaveCount(0);
    await expect(page.getByText('Org units could not be loaded')).toHaveCount(0);
    await expect(page.getByText('Access could not be loaded')).toHaveCount(0);

    // The effective-access preview lists the members and reads one's access.
    const anaPanel = await previewFor(page, EMPLOYEE_NAME);
    await expect(
      anaPanel.getByRole('list', { name: 'content' }).getByText('content.read', { exact: true }),
    ).toBeVisible({ timeout: 10_000 });

    // Stefan hands the ownership back: the run ends as it began, and the
    // navigation follows his new effective actions.
    await transferOwnershipTo(page, HR_ADMIN_NAME);
    await expect(page.getByRole('link', { name: 'Access', exact: true })).toHaveCount(0, { timeout: 10_000 });
  });
});
