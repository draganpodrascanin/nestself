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
 *   - PostgreSQL reachable (54329 or as configured in apps/api/.env)
 *   - Redis reachable (localhost:6379)
 *   - `apps/api/.env` present with a valid DATABASE_URL
 *   - DB migrated and seeded (`pnpm --filter @nestself/api db:migrate`,
 *     `pnpm --filter @nestself/api db:seed`)
 *   - Chromium installed: `pnpm exec playwright install chromium`
 */
import { defineConfig } from '@playwright/test';
import { ADMIN_PORT, ADMIN_URL, API_PORT, API_URL, MARKETING_URL, WORKSPACE_PORT, WORKSPACE_URL } from './e2e/ports';

const CI = !!process.env.CI;

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
      command: 'pnpm --filter @nestself/api dev',
      url: `${API_URL}/api/health`,
      reuseExistingServer: !CI,
      timeout: 180_000,
      env: {
        PORT: String(API_PORT),
        WORKSPACE_URL,
        ADMIN_URL,
        MARKETING_URL,
        AUTH_MODE: 'stub',
        FAKE_IDP_FIXED_OTP: '123456',
        SESSION_COOKIE_INSECURE_DEV: 'true',
        NODE_ENV: 'development',
      },
    },
    {
      command: 'pnpm --filter @nestself/workspace dev',
      url: WORKSPACE_URL,
      reuseExistingServer: !CI,
      timeout: 180_000,
      env: {
        VITE_DATA_SOURCE: 'api',
        VITE_PORT: String(WORKSPACE_PORT),
        VITE_API_PROXY_TARGET: API_URL,
      },
    },
    {
      command: 'pnpm --filter @nestself/admin dev',
      url: ADMIN_URL,
      reuseExistingServer: !CI,
      timeout: 180_000,
      env: {
        VITE_DATA_SOURCE: 'api',
        VITE_PORT: String(ADMIN_PORT),
        VITE_API_PROXY_TARGET: API_URL,
      },
    },
  ],
});
