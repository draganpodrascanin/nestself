# NestSelf End-to-End Tests

This directory contains Playwright-based end-to-end tests for all three NestSelf web applications (marketing, workspace, admin).

## Prerequisites

Chromium must be installed for Playwright:

```bash
pnpm exec playwright install chromium
```

All three apps must be running (or the test runner starts them via `webServer` config):

- Marketing: `http://localhost:3000`
- Workspace: `http://localhost:5173`
- Admin: `http://localhost:5174`

## Commands

### Run all e2e tests

```bash
pnpm e2e
```

This runs all specs across three Playwright projects:

- **mobile-390** (390x844, 2x DPR, touch) -- screenshots and a11y
- **desktop-1440** (1440x900, 1x DPR) -- screenshots and a11y
- **reflow-320** (320x568, 2x DPR, touch) -- reflow checks only

### Update screenshot baselines

```bash
pnpm e2e:update
```

Regenerates the expected screenshot PNGs under `e2e/__screenshots__/`. Run this after intentional visual changes.

### Ad-hoc screenshots with snap.mjs

```bash
node e2e/snap.mjs <url> [options]
```

Options:

| Flag              | Description                                    | Default        |
| ----------------- | ---------------------------------------------- | -------------- |
| `--out <dir>`     | Output directory                               | `./e2e/snaps`  |
| `--name <base>`   | Base filename                                  | `snap`         |
| `--palette <p>`   | Theme palette (forest, ink, plum, azure)        | --             |
| `--mode <m>`      | Theme mode (light, dark)                        | --             |
| `--locale <l>`    | Locale (en, sr-Latn, sr-Cyrl, hu)                | --             |
| `--viewport <v>`  | Viewport: mobile, desktop, or both              | `both`         |
| `--selector <s>`  | Screenshot only this CSS selector               | --             |
| `--no-full`       | Capture viewport only, not full page            | full page      |

Example:

```bash
node e2e/snap.mjs http://localhost:3000/en --name marketing-home --palette forest --mode dark
```

Outputs `marketing-home-mobile.png` and `marketing-home-desktop.png` into `./e2e/snaps/`.

Exit code is 1 when the response status is >= 400 or any console error occurred.

## File structure

```
e2e/
  helpers.ts           -- applyTheme, applyLocale, settle, collectConsoleErrors, prepareActions
  pages.ts             -- page registry iterated by all specs
  screenshots.spec.ts  -- full-page screenshot comparison per page entry
  a11y.spec.ts         -- axe-core WCAG checks and keyboard navigation
  reflow.spec.ts       -- 320px reflow (no horizontal scroll)
  snap.mjs             -- ad-hoc screenshot CLI tool
  tsconfig.json        -- TypeScript config for the e2e directory
  eslint.config.js     -- ESLint config for the e2e directory
  README.md            -- this file
```

## Notes

- Screenshot baselines live under `e2e/__screenshots__/{projectName}/`.
- The `e2e/snaps/` directory (snap.mjs output) is git-ignored.
- Test results and HTML reports are written to `e2e/test-results/` and `e2e/playwright-report/` (both git-ignored).
