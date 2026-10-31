/**
 * Playwright config for the **motion suite**: every component that pops out,
 * slides or expands is opened and closed in real Chromium, against the
 * @nestself/ui Storybook, and its animations are read back through the Web
 * Animations API (properties, duration, easing, exit before unmount,
 * reduced motion). See the Motion rule in CLAUDE.md.
 *
 * Separate from the visual suite (`pnpm e2e`, which forces reduced motion
 * and disables animations for stable screenshots). Run with:
 *
 *   pnpm e2e:motion
 *
 * Storybook is started on port 6106 so a Storybook already open on 6006
 * (possibly from another checkout) is never reused by mistake.
 */
import { defineConfig } from '@playwright/test';
import { STORYBOOK_PORT } from './e2e/ports';

const CI = !!process.env.CI;
const PORT = process.env.MOTION_STORYBOOK_PORT ? Number(process.env.MOTION_STORYBOOK_PORT) : STORYBOOK_PORT;

export default defineConfig({
  testDir: './e2e/motion',
  testMatch: /.*\.motion\.ts/,
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 2 : 4,
  reporter: CI ? 'github' : [['list'], ['html', { open: 'never', outputFolder: 'e2e/motion-report' }]],
  outputDir: 'e2e/motion-results',
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'en-GB',
    reducedMotion: 'no-preference',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 900 } } },
    {
      name: 'mobile-390',
      use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: `pnpm --filter @nestself/ui exec storybook dev -p ${PORT} --no-open --ci`,
    url: `http://localhost:${PORT}/index.json`,
    reuseExistingServer: !CI,
    timeout: 180_000,
  },
});
