/**
 * Playwright config for **content e2e journeys** (T-C1.15, M1 demo).
 *
 * Exercises the CMS content lifecycle: authoring, review, publish, employee
 * discovery, audience isolation and context switching.
 *
 * Runs against a dedicated `nestself_e2e_<prefix>_content` database that the
 * API webServer command drops, migrates and seeds before the API starts
 * (`e2e/content/database.ts`).
 *
 * Run with:
 *
 *   pnpm e2e:content
 *
 * Prerequisites:
 *   - PostgreSQL reachable on 54329 (or as configured)
 *   - Redis reachable on localhost:6379
 *   - Chromium installed: `pnpm exec playwright install chromium`
 *   - TEST_DATABASE_URL or E2E_DATABASE_URL set (see e2e/README.md)
 */
import { defineConfig } from '@playwright/test';
import {
  contentE2eDatabaseUrl,
  MISSING_DATABASE_MESSAGE,
} from './e2e/content/database.ts';

const E2E_DATABASE_URL = contentE2eDatabaseUrl();
if (!E2E_DATABASE_URL) throw new Error(MISSING_DATABASE_MESSAGE);

// Ports: read from env vars, with content-suite defaults
function port(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (raw === undefined || raw === '') return fallback;
  return Number(raw);
}

const API_PORT = port('E2E_API_PORT', 4130);
const WORKSPACE_PORT = port('E2E_WORKSPACE_PORT', 5303);
const ADMIN_PORT = port('E2E_ADMIN_PORT', 5304);

const API_URL = `http://localhost:${API_PORT}`;
const WORKSPACE_URL = `http://localhost:${WORKSPACE_PORT}`;
const ADMIN_URL = `http://localhost:${ADMIN_PORT}`;

const CI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e/content',
  fullyParallel: false,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: 1,
  reporter: CI
    ? 'github'
    : [['list'], ['html', { open: 'never', outputFolder: 'e2e/content-report' }]],
  outputDir: 'e2e/content-results',
  timeout: 90_000,
  use: {
    locale: 'en-GB',
    timezoneId: 'Europe/Belgrade',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'content-desktop',
      use: {
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: 'content-mobile',
      grep: /@mobile/,
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
      },
    },
  ],
  webServer: [
    {
      // Fresh database on every run; never reuse an API bound to stale data.
      command:
        'pnpm --filter @nestself/api exec tsx ../../e2e/content/database.ts && pnpm --filter @nestself/api dev',
      url: `${API_URL}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        PORT: String(API_PORT),
        DATABASE_URL: E2E_DATABASE_URL,
        WORKSPACE_URL,
        ADMIN_URL,
        AUTH_MODE: 'stub',
        FAKE_IDP_FIXED_OTP: '123456',
        MEDIA_STORAGE: 'local',
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
