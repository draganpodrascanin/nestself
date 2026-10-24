/**
 * Playwright config for the **consultation journeys** (T-CW-1.7): the
 * employee and the expert go through the appointment pages, the pre-join
 * check, the call and the post-call screens of the workspace and admin
 * apps, against the real API with the in-process `FakeVideoProvider`
 * (D-CW-05, D-CW-33, guidelines 17.3). The browser gets Chromium's fake
 * camera and microphone (OPS-32); joined meetings get the in-page media
 * session of `e2e/calls/fake-chime.ts`.
 *
 *   pnpm exec playwright test -c playwright.calls.config.ts
 *
 * Servers (all on their own ports, see e2e/calls/servers.mjs): the API
 * (stub auth, fixed email code 123456, `VIDEO_PROVIDER=none`, the
 * `nestself_test_e2e17` database and Redis index 7, prepared and seeded by
 * e2e/calls/start-api.mjs) and both web apps in API mode. Outside CI an
 * already running server on those ports is reused.
 *
 * The nightly real-provider smoke test (`video-smoke.spec.ts`) lives in the
 * same directory and skips itself unless VIDEO_SMOKE_ENABLED=true
 * (.github/workflows/video-smoke.yml).
 *
 * Prerequisites: PostgreSQL on 54329 (role nestself), Redis on 6379, `psql`
 * and `redis-cli` on the PATH, Chromium installed for Playwright.
 */
import { defineConfig, devices } from '@playwright/test';
import { ADMIN_PORT, ADMIN_URL, API_URL, WORKSPACE_PORT, WORKSPACE_URL } from './e2e/calls/servers.mjs';

const CI = !!process.env.CI;
const SMOKE = process.env.VIDEO_SMOKE_ENABLED === 'true';

/** OPS-32: Chromium's fake devices, and no permission prompt. */
const FAKE_MEDIA = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];

export default defineConfig({
  testDir: './e2e/calls',
  fullyParallel: false,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // At most two: more starves the three dev servers on a laptop.
  workers: 2,
  reporter: CI ? 'github' : [['list'], ['html', { open: 'never', outputFolder: 'e2e/playwright-report/calls' }]],
  outputDir: 'e2e/test-results/calls',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    locale: 'en-GB',
    timezoneId: 'Europe/Belgrade',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    permissions: ['camera', 'microphone'],
    launchOptions: { args: FAKE_MEDIA },
  },
  projects: [
    { name: 'calls-setup', testMatch: /auth\.setup\.ts/, teardown: 'calls-index' },
    // After the journeys: rewrites the manual's screenshot index (manual-index.teardown.ts).
    { name: 'calls-index', testMatch: /manual-index\.teardown\.ts/ },
    {
      name: 'calls-desktop',
      testMatch: /consultation\.spec\.ts/,
      dependencies: ['calls-setup'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 },
    },
    {
      name: 'calls-mobile',
      testMatch: /consultation\.spec\.ts/,
      dependencies: ['calls-setup'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    },
    ...(SMOKE
      ? [
          {
            name: 'video-smoke',
            testMatch: /video-smoke\.spec\.ts/,
            dependencies: ['calls-setup'],
            use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
          },
        ]
      : []),
  ],
  webServer: [
    {
      command: 'node e2e/calls/start-api.mjs',
      url: `${API_URL}/api/health`,
      reuseExistingServer: !CI,
      timeout: 300_000,
      stdout: 'pipe',
    },
    {
      command: `pnpm --filter @nestself/workspace exec vite --config ../../e2e/calls/vite-workspace.config.mjs --port ${WORKSPACE_PORT}`,
      url: WORKSPACE_URL,
      reuseExistingServer: !CI,
      timeout: 180_000,
      env: { VITE_DATA_SOURCE: 'api' },
    },
    {
      command: `pnpm --filter @nestself/admin exec vite --config ../../e2e/calls/vite-admin.config.mjs --port ${ADMIN_PORT}`,
      url: ADMIN_URL,
      reuseExistingServer: !CI,
      timeout: 180_000,
      env: { VITE_DATA_SOURCE: 'api' },
    },
  ],
});
