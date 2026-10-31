/**
 * Pictures for the per-role tutorial guides (docs/auth/guides/): every
 * `guide-*.png` but one. Dialogs, forms, panels, menus and sign-in cards are
 * element crops (`shotOf`), so their labels stay legible on an A4 page; whole
 * screens the docs already capture are reused by the guides as they are.
 * Fictional sample people only: Jovan (employee), Ivana (HR administrator and
 * employer owner), Milica (expert), Nikola (staff), Stefan (team manager,
 * whose account is suspended and reinstated) and employee@hq.acme.example (an
 * employee of the employer whose sign-in the staff guide sets up).
 *
 * Runs after admin.shot.ts (files run in name order), which enrolled Nikola's
 * authenticator against this API process and wrote the crop of his enrolment
 * card (`guide-admin-totp-enrol`, the one guide picture taken there);
 * `signInWithPassword` answers the authenticator screen with the persisted
 * secret, or enrols when this file runs alone. Milica's first password
 * sign-in against the process happens here: her enrolment card is captured
 * (key masked, QR code blurred) and her secret persisted where
 * `signInWithPassword` reads it, so the later files sign her in with it. The
 * enrolment needs a fresh API process: stop any API on port 4000 first.
 *
 * Every dialog is cancelled, and nothing a later file captures changes.
 * Created or staged in the disposable e2e database, and removed again in a
 * `finally`:
 * - HR: an import of four rows through the dialog (two invitations for
 *   fictional `new.colleague.*@example.com` addresses created, one row
 *   skipped, one not imported), so its result can be pictured; the two
 *   invitations are deleted.
 * - Staff: a pending emergency access request by user_milica and an approved
 *   access of Nikola's for `case_sample` (purposes starting with "Staged for
 *   the guide screenshots"), as operations.shot.ts stages its own; Stefan's
 *   account suspended through the API so the Reinstate dialog shows, then
 *   reinstated; the SAML connection `org-acmehq-saml` created through the New
 *   connection dialog (metadata from a URL the stub's fake fetcher answers),
 *   with `hq.acme.example` added and verified through the page
 *   (`FAKE_DNS_TXT_AUTOVERIFY` on the stub API) and tested from the page. The
 *   completed test sign-in is staged (`last_tested_at` set in SQL) so that
 *   Activate can be pressed; the real test sign-in is covered by sso.shot.ts
 *   and e2e/auth/sso-sign-in.spec.ts. The connection and its domain are
 *   deleted.
 *
 * Answered in the browser:
 * - the step-up trigger, once for each of its four pictures: the end of a
 *   membership, the grant create, the expert's intake read and the emergency
 *   request answer the API's own 403 `step_up_required` body, as the server
 *   would once the sign-in is old enough, so the real dialog opens and starts
 *   a real challenge (it names the masked address); each is cancelled;
 * - the discovery answer for employee@hq.acme.example is real, but its start
 *   URL is swapped for `javascript:void(0)` so the redirect line stays on
 *   screen (as in sso.shot.ts);
 * - the confirm-email card: its start call (`POST /auth/sso/bind/start`) is
 *   answered with a challenge for a masked address, because a real pending
 *   binding needs an OIDC connection that sso.shot.ts creates later (where the
 *   real step is captured for the docs, and e2e/auth/sso-sign-in.spec.ts
 *   covers it).
 *
 * Masked before the capture: the authenticator key (and the blurred QR code),
 * the DNS verification token and the test link's single-use nonce.
 */
import { test, expect } from '@playwright/test';
import type { Browser, Locator, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { computeTotp } from '../auth/totp';
import {
  STAFF_PASSWORD,
  e2eSql,
  pageApi,
  removeDeveloperAccount,
  signInWithEmailCode,
  signInWithPassword,
  stagePlatformGrant,
} from '../auth/support';
import { ADMIN_URL, MASK, WORKSPACE_URL, maskText, pick, shot, shotOf, signInCard } from './shots';

const ORG = 'org_sample';
const ORG_NAME = 'Example d.o.o.';
const EXPERT_EMAIL = 'user_milica@example.com';
/** Where `signInWithPassword` (e2e/auth/support.ts) reads Milica's authenticator secret. */
const EXPERT_SECRET_FILE = path.resolve(import.meta.dirname, '..', '.auth-state', 'milica-totp-secret.txt');
/** The two invitations the pictured import creates (removed at the end of its test). */
const IMPORTED = ['new.colleague.four@example.com', 'new.colleague.five@example.com'];
const IMPORT_ROWS = [
  `${IMPORTED[0]},employee,Product`,
  `${IMPORTED[1]},employee,Sales`,
  'user_ana@example.com,employee,Product',
  `${IMPORTED[1]},employee,Product`,
].join('\n');
const EMERGENCY_PENDING = 'emergency_guides_pending';
const EMERGENCY_ACTIVE = 'emergency_guides_active';
const SSO_SLUG = 'acmehq';
const SSO_PROVIDER = `org-${SSO_SLUG}-saml`;
const SSO_DOMAIN = 'hq.acme.example';
const SSO_EMPLOYEE = `employee@${SSO_DOMAIN}`;
/** A well-formed pending-binding handle; the start call it is sent with is answered in the browser. */
const BIND_HANDLE = 'guide-screenshot-pending-binding-handle-0001';
const STEP_UP_TEXT = /^We sent a verification code to \S+@\S+\. Enter it to continue\.$/;

test.describe.configure({ mode: 'serial' });

/** Height for `shotOf`'s `maxHeight`: from the top of `region` (less the default margin) to 8 px below `last`. */
async function heightTo(region: Locator, last: Locator, extra = 0): Promise<number> {
  const top = (await region.boundingBox())!;
  const end = (await last.boundingBox())!;
  return Math.ceil(end.y + end.height - top.y + 24 + extra);
}

/** Waits until every toast has closed itself, so none covers the next crop. */
async function noToasts(page: Page): Promise<void> {
  await expect(page.getByRole('region', { name: 'Notifications' })).toBeEmpty({ timeout: 15_000 });
}

/** Answers the next `method` request to `url` with the API's 403 `step_up_required` body, once. */
async function stepUpOnce(page: Page, url: RegExp, method: string, stepUpClass: string, maxAge: number): Promise<void> {
  let answered = false;
  await page.route(url, async (route) => {
    if (answered || route.request().method() !== method) return route.fallback();
    answered = true;
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'step_up_required',
        message: 'Re-authentication required for this action',
        details: { stepUpClass, maxAge, method: 'email_otp' },
      }),
    });
  });
}

/** Presses `submit`, waits for the real step-up dialog to name the masked address, crops it, and cancels it. */
async function pictureStepUp(page: Page, submit: Locator, name: string): Promise<void> {
  const started = page.waitForResponse(
    (res) => res.request().method() === 'POST' && new URL(res.url()).pathname.endsWith('/auth/step-up/start'),
  );
  await submit.click();
  const stepUp = page.getByRole('dialog', { name: 'Verify your identity' });
  await expect(stepUp).toBeVisible({ timeout: 10_000 });
  expect((await started).status()).toBe(200);
  await expect(stepUp.getByText(STEP_UP_TEXT)).toBeVisible({ timeout: 10_000 });
  await shotOf(page, stepUp, name);
  await stepUp.getByRole('button', { name: 'Cancel' }).click();
  await expect(stepUp).toBeHidden();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
}

/** Closes a dialog left open behind a cancelled step-up (its Cancel waits while the call settles). */
async function closeDialog(dialog: Locator): Promise<void> {
  await expect(async () => {
    if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Cancel' }).click({ timeout: 1_000 });
    await expect(dialog).toBeHidden({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
}

/** A taller frame for a dialog whose form does not fit 800 px: the height cap is lifted for the crop. */
async function tallDialog(page: Page, dialog: Locator, height: number): Promise<void> {
  await page.setViewportSize({ width: 1280, height });
  await dialog.evaluate((el) => {
    el.style.maxHeight = 'none';
  });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

/** The authenticator screen of a later sign-in, in a browser of its own; left without a code. */
async function authenticatorCard(browser: Browser, baseUrl: string, email: string, name: string): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${baseUrl}/sign-in`);
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Enter your password' })).toBeVisible({ timeout: 10_000 });
  // The show/hide toggle also carries "password" in its label.
  await page.locator('#password-input').fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Two-factor authentication' })).toBeVisible({ timeout: 15_000 });
  await shotOf(page, signInCard(page), name);
  await context.close();
}

test('employee: sign-in cards, the account menu, settings and sessions', async ({ page, browser }) => {
  await removeDeveloperAccount();

  // Sign in with a code: the address, then the code screen (left empty).
  await page.goto(`${WORKSPACE_URL}/sign-in`);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email address').fill('user_jovan@example.com');
  await shotOf(page, signInCard(page), 'guide-workspace-sign-in');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible({ timeout: 10_000 });
  await shotOf(page, signInCard(page), 'guide-workspace-sign-in-code');
  await page.getByLabel('Verification code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: /Jovan/ })).toBeVisible({ timeout: 15_000 });

  // A second browser of Jovan's, so the sessions list offers End session.
  const other = await browser.newContext();
  await signInWithEmailCode(await other.newPage(), WORKSPACE_URL, 'user_jovan@example.com');
  await other.close();

  // Settings, and the account menu that leads there and to Sign out.
  await page.goto(`${WORKSPACE_URL}/settings`);
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible({ timeout: 15_000 });
  const sessions = page.getByRole('table', { name: 'Signed-in sessions' });
  await expect(sessions.getByText('This browser')).toBeVisible({ timeout: 15_000 });
  await shot(page, 'guide-workspace-settings');
  const trigger = page.getByRole('button', { name: /^Account menu for Jovan/ });
  for (const [item, name] of [
    ['Settings', 'guide-workspace-account-menu-settings'],
    ['Sign out', 'guide-workspace-account-menu-sign-out'],
  ] as const) {
    await trigger.click();
    const menu = page.getByRole('menu', { name: /^Account menu for Jovan/ });
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: item }).hover();
    await shotOf(page, [page.getByText('API connected'), trigger, menu], name);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  }

  // End session on the other browser, and Sign out everywhere: both confirmations, cancelled.
  const endOther = sessions.getByRole('button', { name: /^End session in / }).first();
  await endOther.scrollIntoViewIfNeeded();
  await endOther.click();
  const endSession = page.getByRole('alertdialog', { name: 'End this session?' });
  await expect(endSession).toBeVisible();
  await shotOf(page, endSession, 'guide-workspace-end-session');
  await endSession.getByRole('button', { name: 'Cancel' }).click();
  await expect(endSession).toBeHidden();
  await page.getByRole('button', { name: 'Sign out everywhere' }).click();
  const everywhere = page.getByRole('alertdialog', { name: 'Sign out everywhere?' });
  await expect(everywhere).toBeVisible();
  await shotOf(page, everywhere, 'guide-workspace-sign-out-everywhere');
  await everywhere.getByRole('button', { name: 'Cancel' }).click();
  await expect(everywhere).toBeHidden();

  // The confirm-email card, its start call answered in the browser (see the header).
  const confirm = await browser.newContext();
  await confirm.route('**/api/auth/sso/bind/start', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ challengeToken: 'guide-screenshot-challenge', emailMasked: 'e***@hq.acme.example' }),
    }),
  );
  const confirmPage = await confirm.newPage();
  await confirmPage.goto(`${WORKSPACE_URL}/sign-in?reason=sso_email_unverified&bind=${BIND_HANDLE}`);
  await expect(confirmPage.getByRole('heading', { level: 1, name: 'Confirm your email address' })).toBeVisible({
    timeout: 10_000,
  });
  await expect(confirmPage.getByText(/did not confirm e\*\*\*@hq\.acme\.example/)).toBeVisible();
  await shotOf(confirmPage, signInCard(confirmPage), 'guide-workspace-sign-in-confirm-email');
  await confirm.close();
});

test('HR administrator and owner: people, org-unit and access dialogs', async ({ page }) => {
  test.setTimeout(150_000);
  await signInWithEmailCode(page, WORKSPACE_URL, 'user_ivana@example.com');
  try {
    // Members: Move, then End membership and the step-up it can ask for; all cancelled.
    await page.goto(`${WORKSPACE_URL}/hr/people`);
    const members = page.getByRole('table', { name: 'Members' });
    const ana = members.getByRole('row').filter({ hasText: 'Ana Nikolić' });
    await expect(ana).toHaveCount(1, { timeout: 15_000 });

    await members.getByRole('button', { name: 'Move Ana Nikolić' }).click();
    const move = page.getByRole('dialog', { name: 'Move member' });
    await expect(move).toBeVisible();
    await pick(page, move, 'Org unit', 'Sales');
    await shotOf(page, move, 'guide-workspace-people-move');
    await move.getByRole('button', { name: 'Cancel' }).click();
    await expect(move).toBeHidden();

    await members.getByRole('button', { name: 'End the membership of Ana Nikolić' }).click();
    const end = page.getByRole('alertdialog', { name: 'End membership' });
    await expect(end).toBeVisible();
    await pick(page, end, 'Reason', 'Contract ended');
    await shotOf(page, end, 'guide-workspace-people-end');
    await stepUpOnce(page, /\/api\/orgs\/[^/]+\/members\/[^/]+\/end$/, 'POST', 'administration', 1800);
    await pictureStepUp(page, end.getByRole('button', { name: 'End membership' }), 'guide-workspace-people-step-up');
    await closeDialog(end);
    await expect(ana).toContainText('Active');

    // Invitations: Invite (cancelled), then an import whose result is pictured.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('tab', { name: 'Invitations' }).click();
    await page.getByRole('button', { name: 'Invite', exact: true }).click();
    const invite = page.getByRole('dialog', { name: 'Invite a person' });
    await expect(invite).toBeVisible();
    await invite.getByLabel('Email address').fill('new.colleague.three@example.com');
    await pick(page, invite, 'Permission template', 'Employee');
    await pick(page, invite, 'Org unit', 'Product');
    await shotOf(page, invite, 'guide-workspace-people-invite');
    await invite.getByRole('button', { name: 'Cancel' }).click();
    await expect(invite).toBeHidden();

    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const importDialog = page.getByRole('dialog', { name: 'Import invitations' });
    await expect(importDialog).toBeVisible();
    await importDialog.getByLabel('Rows').fill(IMPORT_ROWS);
    await expect(importDialog.getByText('4 rows ready to import')).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await shotOf(page, importDialog, 'guide-workspace-people-import');
    await importDialog.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(importDialog.getByText('Created: 2. Skipped: 1. Not imported: 1.')).toBeVisible({ timeout: 15_000 });
    await shotOf(page, importDialog, 'guide-workspace-people-import-result');
    await importDialog.getByRole('button', { name: 'Done' }).click();
    await expect(importDialog).toBeHidden();

    // Revoke one of them: the confirmation, cancelled.
    const pending = page.getByRole('table', { name: 'Pending invitations' });
    await pending.getByRole('button', { name: `Revoke the invitation for ${IMPORTED[0]}` }).click();
    const revokeInvitation = page.getByRole('alertdialog', { name: 'Revoke invitation' });
    await expect(revokeInvitation).toBeVisible();
    await shotOf(page, revokeInvitation, 'guide-workspace-people-revoke-invitation');
    await revokeInvitation.getByRole('button', { name: 'Cancel' }).click();
    await expect(revokeInvitation).toBeHidden();

    // Org units: Add child, Rename and Move, each filled in and cancelled.
    await page.goto(`${WORKSPACE_URL}/hr/org-units`);
    const tree = page.getByRole('list', { name: 'Org unit tree' });
    await expect(tree.getByText('Engineering', { exact: true })).toBeVisible({ timeout: 15_000 });
    await tree.getByRole('button', { name: `Add a unit under ${ORG_NAME}` }).click();
    const add = page.getByRole('dialog', { name: 'Add org unit' });
    await expect(add).toBeVisible();
    await add.getByLabel('Name').fill('Research');
    await pick(page, add, 'Kind', 'Department');
    await shotOf(page, add, 'guide-workspace-org-unit-add');
    await add.getByRole('button', { name: 'Cancel' }).click();
    await expect(add).toBeHidden();

    await tree.getByRole('button', { name: 'Rename Product' }).click();
    const rename = page.getByRole('dialog', { name: 'Rename org unit' });
    await expect(rename).toBeVisible();
    await rename.getByLabel('Name').fill('Product and design');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await shotOf(page, rename, 'guide-workspace-org-unit-rename');
    await rename.getByRole('button', { name: 'Cancel' }).click();
    await expect(rename).toBeHidden();

    await tree.getByRole('button', { name: 'Move Product' }).click();
    const moveUnit = page.getByRole('dialog', { name: 'Move org unit' });
    await expect(moveUnit).toBeVisible();
    await pick(page, moveUnit, 'New parent', 'Commercial');
    await shotOf(page, moveUnit, 'guide-workspace-org-unit-move');
    await moveUnit.getByRole('button', { name: 'Cancel' }).click();
    await expect(moveUnit).toBeHidden();

    // Access (Ivana is also the owner): Assign and the step-up it can ask for, Delegate,
    // the effective-access preview, Revoke and Transfer ownership; all cancelled.
    await page.goto(`${WORKSPACE_URL}/hr/access`);
    const grants = page.getByRole('table', { name: 'Grants in your organization' });
    await expect(
      grants.getByRole('row').filter({ hasText: 'Employer owner' }).filter({ hasText: 'Ivana Jovanović' }),
    ).toHaveCount(1, { timeout: 15_000 });

    await page.getByRole('button', { name: 'Assign template' }).click();
    const assign = page.getByRole('dialog', { name: 'Assign a permission template' });
    await expect(assign).toBeVisible();
    await pick(page, assign, 'Member', 'Ana Nikolić');
    await pick(page, assign, 'Template', 'Team manager');
    await pick(page, assign, 'Org unit', 'Product');
    await assign.getByLabel('Amount').fill('500');
    await assign.getByLabel('Currency').fill('EUR');
    // The whole form, conditions included, does not fit 800 px.
    await tallDialog(page, assign, 1400);
    await shotOf(page, assign, 'guide-workspace-assign-template');
    await stepUpOnce(page, /\/api\/orgs\/[^/]+\/grants$/, 'POST', 'administration', 1800);
    await pictureStepUp(page, assign.getByRole('button', { name: 'Assign', exact: true }), 'guide-workspace-step-up');
    await closeDialog(assign);
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.getByRole('button', { name: 'Delegate part of HR administrator' }).click();
    const delegate = page.getByRole('dialog', { name: 'Delegate part of your access' });
    await expect(delegate).toBeVisible();
    await pick(page, delegate, 'Member', 'Stefan Marković');
    const invitePeople = delegate.getByRole('checkbox', { name: 'people.invite', exact: true });
    await invitePeople.click();
    await expect(invitePeople).toBeChecked();
    // Every action of the grant, and Delegate under them, does not fit 800 px.
    await tallDialog(page, delegate, 1200);
    await shotOf(page, delegate, 'guide-workspace-access-delegate');
    await delegate.getByRole('button', { name: 'Cancel' }).click();
    await expect(delegate).toBeHidden();
    await page.setViewportSize({ width: 1280, height: 800 });

    const preview = page.getByRole('region', { name: 'Effective access' });
    await pick(page, preview, 'Member', 'Ana Nikolić');
    await expect(preview.getByText('content.read', { exact: true })).toBeVisible({ timeout: 10_000 });
    await preview.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await shotOf(page, preview, 'guide-workspace-effective-access', { maxWidth: 720, maxHeight: 560 });
    await page.evaluate(() => window.scrollTo(0, 0));

    await grants.getByRole('button', { name: 'Revoke Team manager from Stefan Marković' }).click();
    const revoke = page.getByRole('alertdialog', { name: 'Revoke this grant?' });
    await expect(revoke).toBeVisible();
    await revoke.getByLabel('Reason').fill('Moved to another team.');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await shotOf(page, revoke, 'guide-workspace-access-revoke');
    await revoke.getByRole('button', { name: 'Keep grant' }).click();
    await expect(revoke).toBeHidden();

    await page.getByRole('button', { name: 'Transfer ownership' }).click();
    const transfer = page.getByRole('dialog', { name: 'Transfer ownership' });
    await expect(transfer).toBeVisible();
    await pick(page, transfer, 'New owner', 'Stefan Marković');
    await shotOf(page, transfer, 'guide-workspace-transfer-ownership');
    await transfer.getByRole('button', { name: 'Cancel' }).click();
    await expect(transfer).toBeHidden();
    await expect(
      grants.getByRole('row').filter({ hasText: 'Team manager' }).filter({ hasText: 'Stefan Marković' }).first(),
    ).toContainText('Active');
  } finally {
    // The imported invitations reach no later capture.
    await e2eSql([{ text: 'delete from invitations where org_id = $1 and email = any($2)', values: [ORG, IMPORTED] }]);
  }
});

test('expert: password and authenticator sign-in, the intake record and verify your identity', async ({
  page,
  browser,
}) => {
  // The address, the password, then the enrolment of her first sign-in against this API process.
  await page.goto(`${WORKSPACE_URL}/sign-in`);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email address').fill(EXPERT_EMAIL);
  await shotOf(page, signInCard(page), 'guide-workspace-sign-in-expert');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Enter your password' })).toBeVisible({ timeout: 10_000 });
  await page.locator('#password-input').fill(STAFF_PASSWORD);
  await shotOf(page, signInCard(page), 'guide-workspace-sign-in-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  const enrolHeading = page.getByRole('heading', { name: 'Set up two-factor authentication' });
  const totpHeading = page.getByRole('heading', { name: 'Two-factor authentication' });
  await expect(enrolHeading.or(totpHeading)).toBeVisible({ timeout: 15_000 });
  expect(
    await enrolHeading.isVisible(),
    'the authenticator screen appeared instead of enrolment: an API process was reused; stop it and run again',
  ).toBe(true);
  const manualKey = page.getByText(/Or enter this key manually:/);
  await expect(manualKey).toBeVisible({ timeout: 10_000 });
  const qrCode = page.getByRole('img', { name: 'QR code for your authenticator app' });
  await expect(qrCode).toBeVisible();
  const secret = (await manualKey.textContent())!.split(':').pop()!.trim();
  // The key and the QR code that carries it are the authenticator secret.
  await maskText(manualKey, new RegExp(secret, 'g'), MASK);
  await qrCode.evaluate((img) => {
    (img as HTMLElement).style.filter = 'blur(12px)';
  });
  await shotOf(page, signInCard(page), 'guide-workspace-totp-enrol');
  await page.getByLabel('Verification code').fill(computeTotp(secret));
  await page.getByRole('button', { name: 'Confirm setup' }).click();
  fs.mkdirSync(path.dirname(EXPERT_SECRET_FILE), { recursive: true });
  fs.writeFileSync(EXPERT_SECRET_FILE, secret, 'utf-8');
  await expect(page).not.toHaveURL(/\/sign-in/, { timeout: 15_000 });

  // A later sign-in asks for the authenticator code.
  await authenticatorCard(browser, WORKSPACE_URL, EXPERT_EMAIL, 'guide-workspace-sign-in-authenticator');

  // The case conversation with its intake record opened.
  await page.goto(`${WORKSPACE_URL}/cases`);
  const cases = page.getByRole('table', { name: 'Conversations of your assigned cases' });
  await cases.getByRole('link', { name: 'Open the conversation of case case_sample' }).first().click();
  const messages = page.getByRole('list', { name: 'Messages, oldest first' });
  await expect(messages.getByText('Sample reply (fixture)')).toBeVisible({ timeout: 15_000 });
  const intake = page.getByRole('region', { name: 'Intake record' });
  await intake.getByLabel('Intake record ID').fill('intake_sample');
  await intake.getByRole('button', { name: 'Open intake' }).click();
  await expect(intake.getByText('Sample intake notes (fixture)')).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await intake.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await shotOf(page, intake, 'guide-workspace-expert-intake');

  // Verify your identity: the next intake read answers step_up_required once (see the header).
  await page.reload();
  await expect(messages.getByText('Sample reply (fixture)')).toBeVisible({ timeout: 15_000 });
  await stepUpOnce(page, /\/api\/professional\/intake\/[^/]+$/, 'GET', 'restricted', 900);
  await intake.getByLabel('Intake record ID').fill('intake_sample');
  await pictureStepUp(page, intake.getByRole('button', { name: 'Open intake' }), 'guide-workspace-expert-step-up');
  // Cancelled: nothing is opened, and the section says so.
  await expect(intake.getByText('Verification cancelled')).toBeVisible();
});

test('platform staff: sign-in cards, users, emergency access and SSO onboarding on one connection', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await stagePlatformGrant('grant_user_nikola_platform_owner_screenshots', 'user_nikola', 'platform_owner');
  await e2eSql([
    {
      text: `insert into emergency_access
               (id, user_id, purpose, scope_kind, scope_id, requested_duration_minutes, granted_at, expires_at)
             values ($1, 'user_milica', $2, 'USER_RECORDS', 'user_ana', 120, now(), now() + interval '120 minutes')
             on conflict (id) do nothing`,
      values: [
        EMERGENCY_PENDING,
        'Staged for the guide screenshots: records needed to answer a formal request about the sample employee.',
      ],
    },
    {
      text: `insert into emergency_access
               (id, user_id, approved_by_user_id, approved_at, purpose, scope_kind, scope_id,
                requested_duration_minutes, granted_at, expires_at)
             values ($1, 'user_nikola', 'user_milica', now() - interval '5 minutes', $2, 'CASE', 'case_sample',
                     60, now() - interval '5 minutes', now() + interval '55 minutes')
             on conflict (id) do nothing`,
      values: [
        EMERGENCY_ACTIVE,
        'Staged for the guide screenshots: welfare follow-up on the sample case after an urgent report.',
      ],
    },
  ]);
  let suspended = false;
  try {
    await signInWithPassword(page, ADMIN_URL, 'user_nikola');
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 15_000 });

    // The sign-in cards of a later sign-in, in a browser of its own.
    await adminSignInCards(browser);

    // User access: the lookup, Suspend (cancelled), then Reinstate on an account suspended through the API.
    await page.goto(`${ADMIN_URL}/access`);
    const lookup = page.getByRole('region', { name: 'User access' });
    const account = page.getByRole('region', { name: 'Account' });
    await lookup.getByLabel('User ID').fill('user_stefan');
    await lookup.getByRole('button', { name: 'Look up' }).click();
    await expect(account).toContainText('Active', { timeout: 15_000 });
    const firstOrganisation = lookup.getByRole('heading', { name: `Organisation ${ORG}` });
    await lookup.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await shotOf(page, lookup, 'guide-admin-user-lookup', {
      maxWidth: 720,
      maxHeight: await heightTo(lookup, firstOrganisation, 96),
    });
    await account.getByRole('button', { name: 'Suspend user' }).click();
    const suspendUser = page.getByRole('alertdialog', { name: 'Suspend this user?' });
    await expect(suspendUser).toBeVisible();
    await suspendUser.getByLabel('Reason').fill('Account reported as compromised; suspend until the owner confirms.');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await shotOf(page, suspendUser, 'guide-admin-user-suspend');
    await suspendUser.getByRole('button', { name: 'Cancel' }).click();
    await expect(suspendUser).toBeHidden();

    const staged = await pageApi(page, 'POST', '/api/ops/users/user_stefan/suspend', {
      reason: 'Staged for the guide screenshots: the Reinstate dialog.',
    });
    expect([200, 201, 204], JSON.stringify(staged.body)).toContain(staged.status);
    suspended = true;
    await page.reload();
    await lookup.getByLabel('User ID').fill('user_stefan');
    await lookup.getByRole('button', { name: 'Look up' }).click();
    await expect(account).toContainText('Suspended', { timeout: 15_000 });
    await account.getByRole('button', { name: 'Reinstate user' }).click();
    const reinstate = page.getByRole('alertdialog', { name: 'Reinstate this user?' });
    await expect(reinstate).toBeVisible();
    await shotOf(page, reinstate, 'guide-admin-user-reinstate');
    await reinstate.getByRole('button', { name: 'Cancel' }).click();
    await expect(reinstate).toBeHidden();

    // Emergency access: the request and the step-up it can ask for (cancelled), the approval
    // of the staged request by someone else (cancelled), and the record view of the staged access.
    await page.goto(`${ADMIN_URL}/emergency`);
    const pendingRow = page.getByTestId(`emergency-row-${EMERGENCY_PENDING}`);
    const activeRow = page.getByTestId(`emergency-row-${EMERGENCY_ACTIVE}`);
    await expect(activeRow).toContainText('Active', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Request access' }).click();
    const request = page.getByRole('dialog', { name: 'Request emergency access' });
    await expect(request).toBeVisible();
    await request.getByLabel('Purpose').fill('Welfare follow-up on the sample case after an urgent report.');
    await request.getByRole('radio', { name: 'Case' }).check();
    await request.getByLabel('Case ID').fill('case_sample');
    await pick(page, request, 'Duration', '60 min');
    // The whole form, Send request included, does not fit 800 px.
    await tallDialog(page, request, 1000);
    await shotOf(page, request, 'guide-admin-emergency-request');
    await stepUpOnce(page, /\/api\/ops\/emergency-access$/, 'POST', 'emergency', 300);
    await pictureStepUp(page, request.getByRole('button', { name: 'Send request' }), 'guide-admin-emergency-step-up');
    await closeDialog(request);
    await page.setViewportSize({ width: 1280, height: 800 });

    await pendingRow.getByRole('button', { name: 'Approve' }).click();
    const approve = page.getByRole('alertdialog', { name: 'Approve this emergency access?' });
    await expect(approve).toBeVisible();
    await shotOf(page, approve, 'guide-admin-emergency-approve');
    await approve.getByRole('button', { name: 'Cancel' }).click();
    await expect(approve).toBeHidden();
    await expect(pendingRow).toContainText('Pending');

    await activeRow.getByRole('button', { name: 'Open record' }).click();
    const viewer = page.getByRole('dialog', { name: 'Read a record under emergency access' });
    await expect(viewer.getByText('This access is audited')).toBeVisible();
    await viewer.getByLabel('Record ID').fill('conv_sample');
    await viewer.getByRole('button', { name: 'Read record' }).click();
    await expect(viewer.getByRole('region', { name: 'Record content' }).getByText('Sample message (fixture)')).toBeVisible({
      timeout: 10_000,
    });
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await shotOf(page, viewer, 'guide-admin-emergency-record');
    await page.keyboard.press('Escape');
    await expect(viewer).toBeHidden();

    // SSO onboarding, one connection through the screens: New connection.
    await page.goto(`${ADMIN_URL}/sso`);
    await expect(page.getByRole('heading', { level: 1, name: 'Single sign-on' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'New connection' }).click();
    const create = page.getByRole('dialog', { name: 'New SSO connection' });
    await expect(create).toBeVisible();
    const searched = page.waitForResponse((r) => r.url().includes('/api/ops/organizations') && r.url().includes('search=Exa'));
    await create.getByRole('searchbox', { name: 'Search organisations' }).fill('Exa');
    await searched;
    await pick(page, create, 'Organisation', ORG_NAME);
    await create.getByLabel('Slug').fill(SSO_SLUG);
    await create.getByLabel('Metadata URL').fill('https://idp.acme.example/metadata');
    // The whole SAML form does not fit 800 px.
    await tallDialog(page, create, 1300);
    await shotOf(page, create, 'guide-admin-sso-create-connection');
    await create.getByRole('button', { name: 'Create connection' }).click();
    await expect(create).toBeHidden({ timeout: 15_000 });
    await page.setViewportSize({ width: 1280, height: 800 });

    // The detail after Create, and Add domain with the record it asks the employer to publish.
    const row = page.getByRole('row').filter({ hasText: SSO_PROVIDER });
    await expect(row).toContainText('Draft', { timeout: 15_000 });
    await row.getByRole('button', { name: 'Details' }).click();
    const detail = page.getByRole('region', { name: `Connection ${SSO_PROVIDER}` });
    await expect(detail).toBeVisible();
    const settings = detail.locator('dl').first();
    await detail.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await shotOf(page, detail, 'guide-admin-sso-connection', { maxHeight: await heightTo(detail, settings) });

    await detail.getByRole('button', { name: 'Add domain' }).click();
    const addDomain = page.getByRole('dialog', { name: 'Add domain' });
    await expect(addDomain).toBeVisible();
    await addDomain.getByLabel('Domain').fill(SSO_DOMAIN);
    await shotOf(page, addDomain, 'guide-admin-sso-add-domain');
    await addDomain.getByRole('button', { name: 'Add domain' }).click();
    await expect(addDomain.getByText('Publish this DNS record')).toBeVisible({ timeout: 10_000 });
    // The record value carries the domain's verification token.
    await maskText(addDomain, /(nestself-domain-verification=)[0-9a-f]+/g, `$1${MASK}`);
    await shotOf(page, addDomain, 'guide-admin-sso-dns-record');
    await addDomain.getByRole('button', { name: 'Done' }).click();
    await expect(addDomain).toBeHidden();

    // The values for the employer: Entity ID, ACS URL and the pending domain's record.
    const domains = detail.locator('table');
    const domainRow = domains.getByRole('row').filter({ hasText: SSO_DOMAIN });
    await expect(domainRow.getByRole('button', { name: 'Verify' })).toBeVisible({ timeout: 10_000 });
    await noToasts(page);
    await maskText(detail, /(nestself-domain-verification=)[0-9a-f]+/g, `$1${MASK}`);
    const values = detail.getByRole('heading', { name: "Values for the employer's identity provider" });
    await values.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await shotOf(page, [values, domains], 'guide-admin-sso-values', { margin: 24 });

    // Verify.
    await domainRow.getByRole('button', { name: 'Verify' }).click();
    await expect(domainRow).toContainText('Verified', { timeout: 10_000 });
    await noToasts(page);
    const domainsHeading = detail.getByRole('heading', { level: 3, name: 'Domains' });
    await domainsHeading.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await shotOf(page, [domainsHeading, domains], 'guide-admin-sso-domain-verified', { margin: 24 });

    // Test sign-in: the single-use link (its nonce masked); then Reset to draft, cancelled.
    await detail.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await detail.getByRole('button', { name: 'Test sign-in' }).click();
    const testLink = detail.getByRole('link', { name: 'Open the test sign-in' });
    await expect(testLink).toBeVisible({ timeout: 15_000 });
    await maskText(detail, /(test=)[A-Za-z0-9_-]+/g, `$1${MASK.slice(0, 4)}`);
    const hideLink = detail.getByRole('button', { name: 'Hide the test link' });
    await detail.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await shotOf(page, detail, 'guide-admin-sso-test-link', { maxHeight: await heightTo(detail, hideLink) });
    await hideLink.click();
    await expect(testLink).toBeHidden();
    await detail.getByRole('button', { name: 'Reset to draft' }).click();
    const reset = page.getByRole('alertdialog', { name: 'Reset this connection to draft?' });
    await expect(reset).toBeVisible();
    await shotOf(page, reset, 'guide-admin-sso-reset');
    await reset.getByRole('button', { name: 'Cancel' }).click();
    await expect(reset).toBeHidden();

    // Activate, after the staged test sign-in (see the header).
    await e2eSql([
      { text: 'update sso_connections set last_tested_at = now() where cognito_provider_name = $1', values: [SSO_PROVIDER] },
    ]);
    await page.reload();
    await expect(row).toContainText('Testing', { timeout: 15_000 });
    await row.getByRole('button', { name: 'Details' }).click();
    await expect(detail).toBeVisible();
    await detail.getByRole('button', { name: 'Activate' }).click();
    await expect(detail.getByRole('button', { name: 'Suspend' })).toBeVisible({ timeout: 10_000 });
    await noToasts(page);
    await detail.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await shotOf(page, detail, 'guide-admin-sso-activated', { maxHeight: await heightTo(detail, settings) });

    // The employee guide's sign-in through the organisation, on this connection: the work
    // address, then the redirect line (the real discovery answer, its start URL swapped).
    const employee = await browser.newContext();
    await employee.route((url) => url.pathname === '/api/auth/discover', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { method?: string; ssoStartUrl?: string };
      expect(body.method).toBe('sso');
      await route.fulfill({ response, json: { ...body, ssoStartUrl: 'javascript:void(0)' } });
    });
    const employeePage = await employee.newPage();
    await employeePage.goto(`${WORKSPACE_URL}/sign-in`);
    await expect(employeePage.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await employeePage.getByLabel('Email address').fill(SSO_EMPLOYEE);
    await shotOf(employeePage, signInCard(employeePage), 'guide-workspace-sign-in-work-address');
    await employeePage.getByRole('button', { name: 'Continue' }).click();
    await expect(employeePage.getByText("Redirecting to your organisation's sign-in…")).toBeVisible({ timeout: 10_000 });
    await shotOf(employeePage, signInCard(employeePage), 'guide-workspace-sign-in-sso-redirect');
    await employee.close();

    // Suspend: the confirmation, cancelled.
    await detail.getByRole('button', { name: 'Suspend' }).click();
    const suspendConnection = page.getByRole('alertdialog', { name: 'Suspend this connection?' });
    await expect(suspendConnection).toBeVisible();
    await shotOf(page, suspendConnection, 'guide-admin-sso-suspend');
    await suspendConnection.getByRole('button', { name: 'Cancel' }).click();
    await expect(suspendConnection).toBeHidden();
    await expect(detail).toContainText('Active');
  } finally {
    // Nothing staged here reaches the later files' captures.
    if (suspended) {
      const reinstated = await pageApi(page, 'POST', '/api/ops/users/user_stefan/reinstate');
      expect([200, 201, 204], JSON.stringify(reinstated.body)).toContain(reinstated.status);
    }
    await e2eSql([
      {
        text: 'delete from sso_domains where connection_id in (select id from sso_connections where cognito_provider_name = $1)',
        values: [SSO_PROVIDER],
      },
      { text: 'delete from sso_connections where cognito_provider_name = $1', values: [SSO_PROVIDER] },
      { text: 'delete from emergency_access where id = any($1)', values: [[EMERGENCY_PENDING, EMERGENCY_ACTIVE]] },
    ]);
  }
});

/** Nikola's address, password and authenticator cards of a later sign-in, in a browser of their own; left without a code. */
async function adminSignInCards(browser: Browser): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${ADMIN_URL}/sign-in`);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email address').fill('user_nikola@example.com');
  await shotOf(page, signInCard(page), 'guide-admin-sign-in');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Enter your password' })).toBeVisible({ timeout: 10_000 });
  await page.locator('#password-input').fill(STAFF_PASSWORD);
  await shotOf(page, signInCard(page), 'guide-admin-sign-in-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Two-factor authentication' })).toBeVisible({ timeout: 15_000 });
  await shotOf(page, signInCard(page), 'guide-admin-sign-in-authenticator');
  await context.close();
}
