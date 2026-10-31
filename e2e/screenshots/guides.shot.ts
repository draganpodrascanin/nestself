/**
 * Screenshots for the per-role tutorial guides (docs/auth/guides/): the
 * screens the other shot files do not capture. Fictional sample people only:
 * Jovan (employee), Ivana (HR administrator and employer owner), Milica
 * (expert, password and authenticator) and Nikola (staff).
 *
 * Runs after admin.shot.ts (files run in name order), which enrolled Nikola's
 * authenticator against this API process; `signInWithPassword` answers the
 * authenticator screen with the persisted secret, or enrols when this file
 * runs alone. Milica's first password sign-in against the process happens
 * here: her enrolment screen is captured (key masked, QR code blurred, as in
 * admin.shot.ts) and her secret persisted where `signInWithPassword` reads
 * it, so the later files sign her in with it. The enrolment needs a fresh API
 * process: stop any API on port 4000 first.
 *
 * Every dialog is cancelled, and nothing a later file captures changes: the
 * one thing staged here is removed again at the end of its test. That is the
 * SAML connection `org-acmehq-saml` for the sample organisation (from the
 * test-only metadata fixture) with the domain `hq.acme.example`, created,
 * verified (`FAKE_DNS_TXT_AUTOVERIFY` on the stub API) and tested through the
 * API; the completed test sign-in is staged (`last_tested_at` set in SQL) so
 * that Activate can be pressed and captured. The real test sign-in is covered
 * by sso.shot.ts and e2e/auth/sso-sign-in.spec.ts.
 *
 * Answered in the browser: the expert's intake read is answered once with the
 * API's 403 `step_up_required` body, as the server would 15 minutes after the
 * sign-in, so the real dialog opens and starts a real challenge against the
 * stub API (the dialog names the masked address); the capture is cancelled.
 */
import { test, expect } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SAMPLE_SAML_METADATA } from '../../apps/api/src/identity/saml-metadata.fixture.ts';
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
import { ADMIN_URL, MASK, WORKSPACE_URL, maskText, pick, shot } from './shots';

const ORG = 'org_sample';
const EXPERT_EMAIL = 'user_milica@example.com';
/** Where `signInWithPassword` (e2e/auth/support.ts) reads Milica's authenticator secret. */
const EXPERT_SECRET_FILE = path.resolve(import.meta.dirname, '..', '.auth-state', 'milica-totp-secret.txt');
const SSO_SLUG = 'acmehq';
const SSO_PROVIDER = `org-${SSO_SLUG}-saml`;
const SSO_DOMAIN = 'hq.acme.example';

test.describe.configure({ mode: 'serial' });

/** Identifier and password on a sign-in page, up to the screen after Sign in. */
async function passwordStep(page: Page, baseUrl: string, email: string): Promise<void> {
  await page.goto(`${baseUrl}/sign-in`);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Enter your password' })).toBeVisible({ timeout: 10_000 });
  // The show/hide toggle also carries "password" in its label.
  await page.locator('#password-input').fill(STAFF_PASSWORD);
}

/** The authenticator screen of a later sign-in, in a browser of its own; left without a code. */
async function authenticatorScreen(browser: Browser, baseUrl: string, email: string, name: string): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await passwordStep(page, baseUrl, email);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Two-factor authentication' })).toBeVisible({ timeout: 15_000 });
  await shot(page, name);
  await context.close();
}

/** A row's button scrolled the page to open a dialog: back to the top, behind the dialog. */
async function scrollToTop(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
}

test('employee: the account menu and Sign out everywhere', async ({ page }) => {
  await removeDeveloperAccount();
  await signInWithEmailCode(page, WORKSPACE_URL, 'user_jovan@example.com');

  // The account menu, opened on Settings (the page it leads to).
  await page.goto(`${WORKSPACE_URL}/settings`);
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /^Account menu for Jovan/ }).click();
  const signOut = page.getByRole('menuitem', { name: 'Sign out' });
  await expect(signOut).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
  await shot(page, 'workspace-account-menu');
  await page.keyboard.press('Escape');
  await expect(signOut).toBeHidden();

  // Sign out everywhere: the confirmation over the sessions list, cancelled.
  await expect(page.getByRole('table', { name: 'Signed-in sessions' }).getByText('This browser')).toBeVisible({
    timeout: 15_000,
  });
  const everywhereButton = page.getByRole('button', { name: 'Sign out everywhere' });
  await everywhereButton.evaluate((el) => el.scrollIntoView({ block: 'end' }));
  await page.evaluate(() => window.scrollBy(0, 24));
  await everywhereButton.click();
  const everywhere = page.getByRole('alertdialog', { name: 'Sign out everywhere?' });
  await expect(everywhere).toBeVisible();
  await shot(page, 'workspace-sign-out-everywhere');
  await everywhere.getByRole('button', { name: 'Cancel' }).click();
  await expect(everywhere).toBeHidden();
});

test('HR administrator and owner: people, org-unit and access dialogs', async ({ page }) => {
  await signInWithEmailCode(page, WORKSPACE_URL, 'user_ivana@example.com');

  // End membership, a reason chosen, cancelled.
  await page.goto(`${WORKSPACE_URL}/hr/people`);
  const members = page.getByRole('table', { name: 'Members' });
  await expect(members.getByRole('row').filter({ hasText: 'Ana Nikolić' })).toHaveCount(1, { timeout: 15_000 });
  await members.getByRole('button', { name: 'End the membership of Ana Nikolić' }).click();
  const end = page.getByRole('alertdialog', { name: 'End membership' });
  await expect(end).toBeVisible();
  await pick(page, end, 'Reason', 'Contract ended');
  await scrollToTop(page);
  await shot(page, 'workspace-people-end');
  await end.getByRole('button', { name: 'Cancel' }).click();
  await expect(end).toBeHidden();
  await expect(members.getByRole('row').filter({ hasText: 'Ana Nikolić' })).toContainText('Active');

  // Invitations: Invite and Import, each filled in and cancelled.
  await scrollToTop(page);
  await page.getByRole('tab', { name: 'Invitations' }).click();
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  const invite = page.getByRole('dialog', { name: 'Invite a person' });
  await expect(invite).toBeVisible();
  await invite.getByLabel('Email address').fill('new.colleague.three@example.com');
  await pick(page, invite, 'Permission template', 'Employee');
  await pick(page, invite, 'Org unit', 'Product');
  await shot(page, 'workspace-people-invite');
  await invite.getByRole('button', { name: 'Cancel' }).click();
  await expect(invite).toBeHidden();

  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const importDialog = page.getByRole('dialog', { name: 'Import invitations' });
  await expect(importDialog).toBeVisible();
  await importDialog
    .getByLabel('Rows')
    .fill(
      [
        'new.colleague.four@example.com,employee,Product',
        'new.colleague.five@example.com,employee,Sales',
        'new.colleague.six@example.com,employee,Operations',
      ].join('\n'),
    );
  await expect(importDialog.getByText('3 rows ready to import')).toBeVisible();
  await shot(page, 'workspace-people-import');
  await importDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(importDialog).toBeHidden();
  await expect(page.getByText('There are no pending invitations.')).toBeVisible();

  // Org units: Add child, filled in and cancelled.
  await page.goto(`${WORKSPACE_URL}/hr/org-units`);
  const tree = page.getByRole('list', { name: 'Org unit tree' });
  await expect(tree.getByText('Engineering', { exact: true })).toBeVisible({ timeout: 15_000 });
  await tree.getByRole('button', { name: 'Add a unit under Example d.o.o.' }).click();
  const add = page.getByRole('dialog', { name: 'Add org unit' });
  await expect(add).toBeVisible();
  await add.getByLabel('Name').fill('Research');
  await pick(page, add, 'Kind', 'Department');
  await shot(page, 'workspace-org-unit-add');
  await add.getByRole('button', { name: 'Cancel' }).click();
  await expect(add).toBeHidden();
  await expect(tree.getByText('Research', { exact: true })).toHaveCount(0);

  // Access: Delegate and Revoke, each filled in and cancelled (Ivana is also the owner).
  await page.goto(`${WORKSPACE_URL}/hr/access`);
  const grants = page.getByRole('table', { name: 'Grants in your organization' });
  await expect(
    grants.getByRole('row').filter({ hasText: 'Employer owner' }).filter({ hasText: 'Ivana Jovanović' }),
  ).toHaveCount(1, { timeout: 15_000 });

  await page.getByRole('button', { name: 'Delegate part of HR administrator' }).click();
  const delegate = page.getByRole('dialog', { name: 'Delegate part of your access' });
  await expect(delegate).toBeVisible();
  await pick(page, delegate, 'Member', 'Stefan Marković');
  const invitePeople = delegate.getByRole('checkbox', { name: 'people.invite', exact: true });
  await invitePeople.click();
  await expect(invitePeople).toBeChecked();
  await scrollToTop(page);
  await shot(page, 'workspace-access-delegate');
  await delegate.getByRole('button', { name: 'Cancel' }).click();
  await expect(delegate).toBeHidden();

  await grants.getByRole('button', { name: 'Revoke Team manager from Stefan Marković' }).click();
  const revoke = page.getByRole('alertdialog', { name: 'Revoke this grant?' });
  await expect(revoke).toBeVisible();
  await revoke.getByLabel('Reason').fill('Moved to another team.');
  await scrollToTop(page);
  await shot(page, 'workspace-access-revoke');
  await revoke.getByRole('button', { name: 'Keep grant' }).click();
  await expect(revoke).toBeHidden();
  await expect(
    grants.getByRole('row').filter({ hasText: 'Team manager' }).filter({ hasText: 'Stefan Marković' }).first(),
  ).toContainText('Active');
});

test('expert: password and authenticator sign-in, the intake record and verify your identity', async ({
  page,
  browser,
}) => {
  // Password, then the enrolment of her first sign-in against this API process.
  await passwordStep(page, WORKSPACE_URL, EXPERT_EMAIL);
  await shot(page, 'workspace-sign-in-password');
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
  await shot(page, 'workspace-totp-enrol');
  await page.getByLabel('Verification code').fill(computeTotp(secret));
  await page.getByRole('button', { name: 'Confirm setup' }).click();
  fs.mkdirSync(path.dirname(EXPERT_SECRET_FILE), { recursive: true });
  fs.writeFileSync(EXPERT_SECRET_FILE, secret, 'utf-8');
  await expect(page).not.toHaveURL(/\/sign-in/, { timeout: 15_000 });

  // A later sign-in asks for the authenticator code.
  await authenticatorScreen(browser, WORKSPACE_URL, EXPERT_EMAIL, 'workspace-sign-in-authenticator');

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
  await intake.evaluate((el) => el.scrollIntoView({ block: 'end' }));
  await shot(page, 'workspace-expert-intake');

  // Verify your identity: the next intake read answers step_up_required once (see the header).
  await page.reload();
  await expect(messages.getByText('Sample reply (fixture)')).toBeVisible({ timeout: 15_000 });
  let stubbed = false;
  await page.route(/\/api\/professional\/intake\/[^/]+$/, async (route) => {
    if (stubbed || route.request().method() !== 'GET') return route.fallback();
    stubbed = true;
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'step_up_required',
        message: 'Re-authentication required for this action',
        details: { stepUpClass: 'restricted', maxAge: 900, method: 'email_otp' },
      }),
    });
  });
  const challenge = page.waitForResponse(
    (res) => res.request().method() === 'POST' && new URL(res.url()).pathname.endsWith('/auth/step-up/start'),
  );
  await intake.getByLabel('Intake record ID').fill('intake_sample');
  await intake.getByRole('button', { name: 'Open intake' }).click();
  const stepUp = page.getByRole('dialog', { name: 'Verify your identity' });
  await expect(stepUp).toBeVisible({ timeout: 10_000 });
  expect((await challenge).status()).toBe(200);
  await expect(stepUp.getByText(/^We sent a verification code to \S+@\S+\. Enter it to continue\.$/)).toBeVisible({
    timeout: 10_000,
  });
  await shot(page, 'workspace-expert-step-up');
  // Cancel: nothing is opened, and the section says so.
  await stepUp.getByRole('button', { name: 'Cancel' }).click();
  await expect(stepUp).toBeHidden();
  await expect(intake.getByText('Verification cancelled')).toBeVisible();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('platform staff: the emergency access request and an SSO connection activated', async ({ page }) => {
  await stagePlatformGrant('grant_user_nikola_platform_owner_screenshots', 'user_nikola', 'platform_owner');
  await signInWithPassword(page, ADMIN_URL, 'user_nikola');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 15_000 });

  // Emergency access: the request dialog filled in and cancelled.
  await page.goto(`${ADMIN_URL}/emergency`);
  await expect(page.getByRole('heading', { level: 1, name: 'Emergency access' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Request access' }).click();
  const request = page.getByRole('dialog', { name: 'Request emergency access' });
  await expect(request).toBeVisible();
  await request.getByLabel('Purpose').fill('Welfare follow-up on the sample case after an urgent report.');
  await request.getByRole('radio', { name: 'Case' }).check();
  await request.getByLabel('Case ID').fill('case_sample');
  await pick(page, request, 'Duration', '60 min');
  await shot(page, 'admin-emergency-request');
  await request.getByRole('button', { name: 'Cancel' }).click();
  await expect(request).toBeHidden();
  await expect(page.getByText('No emergency access has been requested.')).toBeVisible();

  // SSO: a tested connection (staged, see the header), activated from the page.
  let connectionId: string | null = null;
  try {
    const created = await pageApi(page, 'POST', '/api/ops/sso-connections', {
      orgId: ORG,
      slug: SSO_SLUG,
      protocol: 'SAML',
      metadataXml: SAMPLE_SAML_METADATA,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    connectionId = created.body.id as string;
    const domain = await pageApi(page, 'POST', `/api/ops/sso-connections/${connectionId}/domains`, {
      domain: SSO_DOMAIN,
    });
    expect(domain.status, JSON.stringify(domain.body)).toBe(201);
    const verified = await pageApi(
      page,
      'POST',
      `/api/ops/sso-connections/${connectionId}/domains/${domain.body.id as string}/verify`,
    );
    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    const tested = await pageApi(page, 'POST', `/api/ops/sso-connections/${connectionId}/test`);
    expect(tested.status, JSON.stringify(tested.body)).toBe(200);
    await e2eSql([{ text: 'update sso_connections set last_tested_at = now() where id = $1', values: [connectionId] }]);

    await page.goto(`${ADMIN_URL}/sso`);
    const row = page.getByTestId(`sso-row-${connectionId}`);
    await expect(row).toContainText('Testing', { timeout: 15_000 });
    await row.getByRole('button', { name: 'Details' }).click();
    const detail = page.getByRole('region', { name: `Connection ${SSO_PROVIDER}` });
    await expect(detail).toBeVisible();
    await detail.getByRole('button', { name: 'Activate' }).click();
    await expect(page.getByText('Connection activated.').first()).toBeVisible({ timeout: 10_000 });
    await expect(detail.getByRole('button', { name: 'Suspend' })).toBeVisible();
    await detail.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await shot(page, 'admin-sso-activated');
  } finally {
    // Nothing staged here reaches the later files' captures.
    if (connectionId) {
      await e2eSql([
        { text: 'delete from sso_domains where connection_id = $1', values: [connectionId] },
        { text: 'delete from sso_connections where id = $1', values: [connectionId] },
      ]);
    }
  }
});
