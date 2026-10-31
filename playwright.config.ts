import { defineConfig } from '@playwright/test';
import { ADMIN_PORT, ADMIN_URL, API_URL, MARKETING_PORT, MARKETING_URL, WORKSPACE_PORT, WORKSPACE_URL } from './e2e/ports';

const CI = !!process.env.CI;
export default defineConfig({
  testDir: './e2e',
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 2 : undefined,
  reporter: CI ? 'github' : [['list'], ['html', { open: 'never', outputFolder: 'e2e/playwright-report' }]],
  outputDir: 'e2e/test-results',
  timeout: 60_000,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled' } },
  use: { baseURL: MARKETING_URL, locale: 'en-GB', timezoneId: 'Europe/Belgrade', reducedMotion: 'reduce', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'mobile-390',
      use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
      testIgnore: /reflow\.spec\.ts/,
    },
    {
      name: 'desktop-1440',
      use: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
      testIgnore: /reflow\.spec\.ts/,
    },
    {
      name: 'reflow-320',
      use: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
      testMatch: /reflow\.spec\.ts/,
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @nestself/marketing dev',
      url: MARKETING_URL,
      reuseExistingServer: !CI,
      timeout: 180_000,
      env: { PORT: String(MARKETING_PORT) },
    },
    {
      command: 'pnpm --filter @nestself/workspace dev',
      url: WORKSPACE_URL,
      reuseExistingServer: !CI,
      timeout: 180_000,
      env: { VITE_PORT: String(WORKSPACE_PORT), VITE_API_PROXY_TARGET: API_URL },
    },
    {
      command: 'pnpm --filter @nestself/admin dev',
      url: ADMIN_URL,
      reuseExistingServer: !CI,
      timeout: 180_000,
      env: { VITE_PORT: String(ADMIN_PORT), VITE_API_PROXY_TARGET: API_URL },
    },
  ],
});
