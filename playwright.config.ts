import { defineConfig } from '@playwright/test';

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
  use: { baseURL: 'http://localhost:3000', locale: 'en-GB', timezoneId: 'Europe/Belgrade', reducedMotion: 'reduce', trace: 'retain-on-failure' },
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
    { command: 'pnpm --filter @nestself/marketing dev', url: 'http://localhost:3000', reuseExistingServer: !CI, timeout: 180_000 },
    { command: 'pnpm --filter @nestself/workspace dev', url: 'http://localhost:5173', reuseExistingServer: !CI, timeout: 180_000 },
    { command: 'pnpm --filter @nestself/admin dev', url: 'http://localhost:5174', reuseExistingServer: !CI, timeout: 180_000 },
  ],
});
