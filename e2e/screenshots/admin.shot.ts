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
 * later `pnpm e2e:auth` against the same process still signs in.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { PERMISSION_TEMPLATES } from '../../packages/contracts/src/templates.ts';
import { e2eDatabaseUrl } from '../e2e-database.ts';
import { computeTotp } from '../auth/totp';
import { ADMIN_URL, shot } from './shots';

const STAFF_EMAIL = 'user_nikola@example.com';
const STAFF_PASSWORD = 'Nestself-dev-1234!';
const STAFF_USER_ID = 'user_nikola';
const LOOKUP_USER_ID = 'user_ivana';
const SAMPLE_ORG_ID = 'org_sample';

const TOTP_SECRET_FILE = path.resolve(import.meta.dirname, '..', '.auth-state', 'nikola-totp-secret.txt');

/** The slice of `pg` used here; `pg` is a dependency of the API, not of the repository root. */
interface PgClient {
  connect(): Promise<void>;
  query(text: string, values: unknown[]): Promise<unknown>;
  end(): Promise<void>;
}
const requireFromApi = createRequire(path.resolve(import.meta.dirname, '..', '..', 'apps', 'api', 'package.json'));

async function grantPlatformOwner(): Promise<void> {
  const url = e2eDatabaseUrl();
  if (!url) throw new Error('TEST_DATABASE_URL or E2E_DATABASE_URL is required');
  const template = PERMISSION_TEMPLATES.find((tpl) => tpl.key === 'platform_owner');
  if (!template) throw new Error('platform_owner template missing');
  const { Client } = requireFromApi('pg') as { Client: new (config: { connectionString: string }) => PgClient };
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      `insert into grants (id, subject_user_id, template_key, actions, scope_type, conditions, valid_from, granted_by_user_id)
       values ($1, $2, 'platform_owner', $3, 'platform', '[]'::jsonb, now() - interval '1 minute', $2)
       on conflict (id) do nothing`,
      [`grant_${STAFF_USER_ID}_platform_owner_screenshots`, STAFF_USER_ID, [...template.actions]],
    );
  } finally {
    await client.end();
  }
}

test.describe.configure({ mode: 'serial' });

test('admin sign-in, enrolment and access pages', async ({ page }) => {
  await grantPlatformOwner();

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
  await expect(page.locator('img, svg[role="img"], canvas').first()).toBeVisible();
  await shot(page, 'admin-totp-enrol');
  const secret = (await manualKey.textContent())!.split(':').pop()!.trim();
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
