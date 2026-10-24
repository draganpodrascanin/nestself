/**
 * Playwright config for **auth e2e journeys** -- sign-in / sign-out / guards.
 *
 * Runs against the API in stub mode (AUTH_MODE=stub) with a fixed OTP so
 * email-code sign-ins are deterministic. TOTP codes are computed from the
 * secret shown on the enrolment screen.
 *
 * Completely separate from the visual/a11y suite in `playwright.config.ts`
 * (`pnpm e2e`). Run with:
 *
 *   pnpm e2e:auth
 *
 * Prerequisites:
 *   - TEST_DATABASE_URL (or E2E_DATABASE_URL) in the environment. The stub
 *     API runs against its own database, `nestself_e2e_<prefix>` on the
 *     TEST_DATABASE_URL server (see e2e/e2e-database.ts), which
 *     e2e/global-setup.ts drops, recreates, migrates and seeds on every run.
 *     The developer database in apps/api/.env is never touched.
 *   - Redis reachable (localhost:6379)
 *   - Chromium installed: `pnpm exec playwright install chromium`
 */
import { defineConfig } from '@playwright/test';
import { e2eDatabaseUrl } from './e2e/e2e-database.ts';

const CI = !!process.env.CI;

/** null when neither variable is set: the API command then fails fast. */
const E2E_DATABASE_URL = e2eDatabaseUrl();

export default defineConfig({
  testDir: './e2e/auth',
  fullyParallel: false,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  /**
   * Single worker: the fake IdP has shared lockout state per address and
   * TOTP enrolment state in memory, so parallel tests against the same
   * user would race.
   */
  workers: 1,
  reporter: CI
    ? 'github'
    : [['list'], ['html', { open: 'never', outputFolder: 'e2e/auth-report' }]],
  outputDir: 'e2e/auth-results',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  use: {
    locale: 'en-GB',
    timezoneId: 'Europe/Belgrade',
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'auth-desktop',
      use: {
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer: [
    {
      /**
       * Global setup runs after the web servers start, but the API pings its
       * database on boot: create and migrate the e2e database first. Global
       * setup then resets and seeds it before the first test.
       */
      command:
        'pnpm --filter @nestself/api exec tsx ../../e2e/global-setup.ts --ensure && pnpm --filter @nestself/api dev',
      url: 'http://localhost:4000/api/health',
      reuseExistingServer: !CI,
      timeout: 180_000,
      env: {
        ...(E2E_DATABASE_URL ? { DATABASE_URL: E2E_DATABASE_URL } : {}),
        AUTH_MODE: 'stub',
        FAKE_IDP_FIXED_OTP: '123456',
        SESSION_COOKIE_INSECURE_DEV: 'true',
        NODE_ENV: 'development',
      },
    },
    {
      command: 'pnpm --filter @nestself/workspace dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !CI,
      timeout: 180_000,
      env: {
        VITE_DATA_SOURCE: 'api',
      },
    },
    {
      command: 'pnpm --filter @nestself/admin dev',
      url: 'http://localhost:5174',
      reuseExistingServer: !CI,
      timeout: 180_000,
      env: {
        VITE_DATA_SOURCE: 'api',
      },
    },
  ],
});
