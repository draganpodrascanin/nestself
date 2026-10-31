/**
 * Admin screenshots for the auth guides: password sign-in, authenticator
 * enrolment, platform access, the user access lookup and an organization's
 * access tab. Signs in as the sample operations user (user_nikola).
 *
 * The seeded sample data has no platform owner, and Nikola's own templates
 * (client_operations, support_operator) do not hold `access.preview`, so the
 * access pages would show the permission state. Before signing in, this file
 * adds one `platform_owner` grant for Nikola to the disposable e2e database
 * (`grant_user_nikola_platform_owner_screenshots`); global setup removes it
 * with the next reset. The grant shows up in the platform screenshot.
 *
 * Enrolment appears on the first password sign-in against a fresh API
 * process (the fake identity provider keeps authenticator state in memory).
 * If the authenticator screen appears instead, an API was reused: stop it and
 * run again. The secret is persisted like admin-sign-in.spec.ts does, so a
 * later `pnpm e2e:auth` against the same process still signs in. In the
 * capture the manual key is masked and the QR code blurred: both are that
 * secret.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { computeTotp } from '../auth/totp';
import { removeDeveloperAccount, stagePlatformGrant } from '../auth/support';
import { ADMIN_URL, MASK, maskText, shot } from './shots';

const STAFF_EMAIL = 'user_nikola@example.com';
const STAFF_PASSWORD = 'Nestself-dev-1234!';
const STAFF_USER_ID = 'user_nikola';
const LOOKUP_USER_ID = 'user_ivana';
const SAMPLE_ORG_ID = 'org_sample';

const TOTP_SECRET_FILE = path.resolve(import.meta.dirname, '..', '.auth-state', 'nikola-totp-secret.txt');

test.describe.configure({ mode: 'serial' });

test('admin sign-in, enrolment and access pages', async ({ page }) => {
  await removeDeveloperAccount();
  await stagePlatformGrant(`grant_${STAFF_USER_ID}_platform_owner_screenshots`, STAFF_USER_ID, 'platform_owner');

  // Identifier, then password.
  await page.goto(`${ADMIN_URL}/sign-in`);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email address').fill(STAFF_EMAIL);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Enter your password' })).toBeVisible({ timeout: 10_000 });
  await page.locator('#password-input').fill(STAFF_PASSWORD);
  await shot(page, 'admin-sign-in-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Authenticator enrolment (first sign-in against this API process).
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
  // The key and the QR code that carries it are the authenticator secret: masked
  // and blurred in the capture (shots.ts), as the guide's caption says.
  await maskText(manualKey, new RegExp(secret, 'g'), MASK);
  await qrCode.evaluate((img) => {
    (img as HTMLElement).style.filter = 'blur(12px)';
  });
  await shot(page, 'admin-totp-enrol');
  await page.getByLabel('Verification code').fill(computeTotp(secret));
  await page.getByRole('button', { name: 'Confirm setup' }).click();
  fs.mkdirSync(path.dirname(TOTP_SECRET_FILE), { recursive: true });
  fs.writeFileSync(TOTP_SECRET_FILE, secret, 'utf-8');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 15_000 });

  // Platform access.
  await page.goto(`${ADMIN_URL}/access`);
  await expect(page.getByRole('heading', { level: 1, name: 'Platform access' })).toBeVisible({ timeout: 15_000 });
  const platformTable = page.getByRole('table', { name: 'Platform grants' });
  await expect(platformTable.getByRole('row').filter({ hasText: 'Platform owner' }).first()).toBeVisible({
    timeout: 15_000,
  });
  await shot(page, 'admin-platform-access');

  // User access lookup for the sample HR admin.
  const lookup = page.getByRole('region', { name: 'User access' });
  await lookup.getByLabel('User ID').fill(LOOKUP_USER_ID);
  await lookup.getByRole('button', { name: 'Look up' }).click();
  await expect(lookup.getByRole('heading', { name: `Organisation ${SAMPLE_ORG_ID}` })).toBeVisible({
    timeout: 15_000,
  });
  await lookup.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await shot(page, 'admin-user-access-lookup');

  // An organization's access tab.
  await page.goto(`${ADMIN_URL}/organizations/${SAMPLE_ORG_ID}/access`);
  const orgTable = page.getByRole('table', { name: 'Grants in this organisation' });
  await expect(orgTable.getByRole('row').filter({ hasText: 'Employer owner' }).first()).toBeVisible({
    timeout: 15_000,
  });
  await shot(page, 'admin-org-access');
});
