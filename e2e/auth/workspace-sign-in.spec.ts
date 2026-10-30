/**
 * Workspace sign-in e2e journeys.
 *
 * Run with: pnpm e2e:auth
 *
 * These tests exercise the real API in stub mode (AUTH_MODE=stub,
 * FAKE_IDP_FIXED_OTP=123456) so that the entire cookie-based session
 * flow is covered without AWS.
 */
import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants -- labels come from packages/i18n/locales/en/auth.json
// ---------------------------------------------------------------------------

const WORKSPACE_URL = 'http://localhost:5173';
const EMPLOYEE_EMAIL = 'user_jovan@example.com';
const FIXED_OTP = '123456';

test.describe('Workspace email-code sign-in', () => {
  test.describe.configure({ mode: 'serial' });

  test('employee can sign in with email + OTP code', async ({ page }) => {
    await page.goto(`${WORKSPACE_URL}/sign-in`);

    // Step 1 -- Identifier screen
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.getByLabel('Email address').fill(EMPLOYEE_EMAIL);
    await page.getByRole('button', { name: 'Continue' }).click();

    // Step 2 -- OTP screen (the discover + OTP-start API calls may take a moment)
    await expect(
      page.getByRole('heading', { name: 'Check your email' }),
    ).toBeVisible({ timeout: 10_000 });
    await page.getByLabel('Verification code').fill(FIXED_OTP);
    await page.getByRole('button', { name: 'Verify' }).click();

    // Authenticated home -- greeting contains the user's display name.
    // The workspace home renders: "Hello, Jovan Petrovic" (the displayName
    // from sample data). Wait for navigation to complete and the heading to
    // appear.
    await expect(
      page.getByRole('heading', { name: /Jovan/i }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('sign out redirects to sign-in', async ({ page }) => {
    // Sign in first (repeated per-test because contexts are isolated).
    await page.goto(`${WORKSPACE_URL}/sign-in`);
    await page.getByLabel('Email address').fill(EMPLOYEE_EMAIL);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(
      page.getByRole('heading', { name: 'Check your email' }),
    ).toBeVisible({ timeout: 10_000 });
    await page.getByLabel('Verification code').fill(FIXED_OTP);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(
      page.getByRole('heading', { name: /Jovan/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Sign out through the user menu in the app shell header.
    await page.getByRole('button', { name: /^Account menu for / }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();

    await expect(page).toHaveURL(/\/sign-in(\?|$)/, { timeout: 10_000 });
    // The sign-in page appears, and the session is gone: a protected route
    // sends the user back to sign-in.
    await expect(
      page.getByRole('heading', { name: 'Sign in' }),
    ).toBeVisible({ timeout: 10_000 });
    await page.goto(`${WORKSPACE_URL}/settings`);
    await expect(page).toHaveURL(/\/sign-in\?return=/, { timeout: 10_000 });
  });
});

test.describe('Workspace auth guards', () => {
  test('unauthenticated access to an authenticated route redirects to /sign-in', async ({
    page,
  }) => {
    // Go straight to an authenticated route without signing in.
    await page.goto(`${WORKSPACE_URL}/support`);

    // The _authenticated layout redirects to /sign-in with a ?return param.
    await expect(
      page.getByRole('heading', { name: 'Sign in' }),
    ).toBeVisible({ timeout: 10_000 });

    // URL should contain /sign-in and a return parameter.
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

test.describe('Workspace sign-in error handling', () => {
  test('wrong email code stays on the OTP step and does not authenticate', async ({ page }) => {
    await page.goto(`${WORKSPACE_URL}/sign-in`);

    // Submit identifier
    await page.getByLabel('Email address').fill(EMPLOYEE_EMAIL);
    await page.getByRole('button', { name: 'Continue' }).click();

    // Wait for OTP screen (the discover + OTP-start API calls may take a moment)
    await expect(
      page.getByRole('heading', { name: 'Check your email' }),
    ).toBeVisible({ timeout: 10_000 });

    // Enter a wrong code
    await page.getByLabel('Verification code').fill('000000');
    await page.getByRole('button', { name: 'Verify' }).click();

    // The API rejects the code (invalid_code).  The error is handled by the
    // parent SignInPage's handleApiError which sets its own error state, but
    // the OtpScreen component does not currently receive or display the parent
    // error for API errors.  This is a known UX gap (the OtpScreen only shows
    // client-side validation errors).
    //
    // What IS observable: the Verify button returns to its enabled state
    // (submitting=false after the catch block) and the OTP step stays visible.
    // The user is NOT redirected to the authenticated home.
    await expect(
      page.getByRole('button', { name: 'Verify' }),
    ).toBeEnabled({ timeout: 10_000 });

    // The OTP step heading is still visible -- the user was not authenticated.
    await expect(
      page.getByRole('heading', { name: 'Check your email' }),
    ).toBeVisible();

    // The URL has not changed to the authenticated home.
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
