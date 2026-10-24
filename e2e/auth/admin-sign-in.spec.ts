/**
 * Admin sign-in journey: password, then authenticator (TOTP).
 *
 * Run with `pnpm e2e:auth`. The fake identity provider keeps authenticator
 * enrolment in memory for the API process lifetime, so the journey has two
 * shapes:
 *
 * - first run against an API process: the enrolment screen appears; the test
 *   reads the manual key, computes a code, confirms, and persists the secret
 *   in `e2e/.auth-state/` (git-ignored) for later runs;
 * - later runs: the plain authenticator screen appears and the persisted
 *   secret produces the code.
 *
 * If the API was restarted after a secret was persisted, the enrolment screen
 * comes back and the test re-enrols and overwrites the file.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { computeTotp } from './totp';
import { ADMIN_URL } from '../ports';

const STAFF_EMAIL = 'user_nikola@example.com';
const STAFF_PASSWORD = 'Nestself-dev-1234!';

const AUTH_STATE_DIR = path.resolve(import.meta.dirname, '..', '.auth-state');
const TOTP_SECRET_FILE = path.join(AUTH_STATE_DIR, 'nikola-totp-secret.txt');

function readPersistedSecret(): string | null {
  try {
    return fs.readFileSync(TOTP_SECRET_FILE, 'utf-8').trim() || null;
  } catch {
    return null;
  }
}

function persistSecret(secret: string): void {
  fs.mkdirSync(AUTH_STATE_DIR, { recursive: true });
  fs.writeFileSync(TOTP_SECRET_FILE, secret, 'utf-8');
}

test.describe('Admin password + authenticator sign-in', () => {
  test.describe.configure({ mode: 'serial' });

  test('staff user signs in with password and an authenticator code', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/sign-in`);

    // Identifier
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.getByLabel('Email address').fill(STAFF_EMAIL);
    await page.getByRole('button', { name: 'Continue' }).click();

    // Password. The show/hide toggle also carries "password" in its label,
    // so the input is addressed by id.
    await expect(page.getByRole('heading', { name: 'Enter your password' })).toBeVisible({
      timeout: 10_000,
    });
    await page.locator('#password-input').fill(STAFF_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Either the enrolment screen (first sign-in) or the authenticator screen.
    const enrolHeading = page.getByRole('heading', { name: 'Set up two-factor authentication' });
    const totpHeading = page.getByRole('heading', { name: 'Two-factor authentication' });
    await expect(enrolHeading.or(totpHeading)).toBeVisible({ timeout: 15_000 });

    if (await enrolHeading.isVisible()) {
      // Manual key text: "Or enter this key manually: <BASE32>"
      const manualKey = page.getByText(/Or enter this key manually:/);
      await expect(manualKey).toBeVisible({ timeout: 10_000 });
      const secret = (await manualKey.textContent())!.split(':').pop()!.trim();
      expect(secret.length).toBeGreaterThan(10);

      await page.getByLabel('Verification code').fill(computeTotp(secret));
      await page.getByRole('button', { name: 'Confirm setup' }).click();
      persistSecret(secret);
    } else {
      const secret = readPersistedSecret();
      expect(
        secret,
        'authenticator screen shown but no persisted secret; delete e2e/.auth-state and restart the API',
      ).toBeTruthy();
      await page.getByLabel('Authentication code').fill(computeTotp(secret!));
      await page.getByRole('button', { name: 'Verify' }).click();
    }

    // Authenticated admin home
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('NestSelf Admin')).toBeVisible();
  });
});
