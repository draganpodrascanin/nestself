# NestSelf End-to-End Tests

This directory contains Playwright-based end-to-end tests for all three NestSelf web applications (marketing, workspace, admin).

## Prerequisites

Chromium must be installed for Playwright:

```bash
pnpm exec playwright install chromium
```

All three apps must be running (or the test runner starts them via `webServer` config). Default ports are below; override them with `E2E_*_PORT` (see `docs/environment.md`, "Running a second worktree"):

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

## Auth sign-in journeys (`e2e/auth/`)

A separate Playwright config (`playwright.auth.config.ts`) exercises the real sign-in flows against the API in stub mode.

### Prerequisites

1. **PostgreSQL** running on the port in `apps/api/.env` (default 54329):

   ```bash
   pnpm db:up          # starts Postgres + Redis via Docker Compose
   ```

2. **Database migrated and seeded**:

   ```bash
   pnpm --filter @nestself/api db:migrate
   pnpm --filter @nestself/api db:seed
   ```

3. **`apps/api/.env`** present with a valid `DATABASE_URL` and `REDIS_URL`.

4. **Chromium** installed for Playwright:

   ```bash
   pnpm exec playwright install chromium
   ```

### Running

```bash
pnpm e2e:auth
```

This starts the API (stub mode, fixed OTP `123456`, insecure-dev cookies), the workspace app (`VITE_DATA_SOURCE=api`) and the admin app (`VITE_DATA_SOURCE=api`), then runs all specs under `e2e/auth/` with a single worker.

### TOTP enrolment state caveat

The fake identity provider keeps TOTP enrolment in memory. On the **first** run (or after an API restart) the staff-user test hits the enrolment screen, reads the manual key, computes a code, confirms setup, and persists the secret to `e2e/.auth-state/nikola-totp-secret.txt`. On **subsequent** runs the test reads that persisted secret and enters a computed TOTP code on the plain challenge screen.

If the API process is restarted but the secret file still exists the test will fail because the API no longer knows that secret. Delete `e2e/.auth-state/` and re-run to trigger a fresh enrolment.

### File structure

```
e2e/auth/
  totp.ts                       -- RFC 6238 TOTP helper (node:crypto only)
  workspace-sign-in.spec.ts     -- employee email-code, sign-out, guards, error
  admin-sign-in.spec.ts         -- staff password + TOTP enrol / challenge
  README section                -- this section
```

Reports and results are written to `e2e/auth-report/` and `e2e/auth-results/` (both git-ignored).

## Motion suite (`e2e/motion/`)

Checks that everything which pops out, slides or expands is animated (the Motion rule in `CLAUDE.md`). It runs in Chromium against the `@nestself/ui` Storybook on port 6106, separate from `pnpm e2e`, which forces reduced motion and disables animations for stable screenshots.

```bash
pnpm e2e:motion
```

`recordFrames()` in `motion-helpers.ts` samples the element on every animation frame while the test opens or closes it. The specs assert:

- **popouts.motion.ts**: dialog, alert dialog, bottom sheet, left and right drawers, menu, select and toast enter and exit through the Web Animations API on `opacity` / `transform` only, with token durations (120 / 200 / 280 ms) and `cubic-bezier(0.2, 0, 0, 1)`; entry and exit both show in-between frames; opacity never flickers; the popup stays visible while it exits and then leaves; scrims fade both ways; a menu closed mid-entry turns around from where it was.
- **disclosures.motion.ts**: accordion panels transition the measured height; the tabs indicator slides and lands on the tab; the compact site navigation expands frame by frame, collapses out of the layout, and leaves the desktop navigation alone.
- **reduced.motion.ts**: with `prefers-reduced-motion: reduce`, popouts only fade (at most 50 ms, no transform) and accordion panels open instantly.

When you add a component that moves, add its story and a case to the matching spec.

## Notes

- Base page entries are Serbian Latin at unprefixed URLs (`/`, `/plans`); `-en`, `-hu` and `-sr-cyrl` are the prefixed locale variants.
- Screenshot baselines live under `e2e/__screenshots__/{projectName}/`.
- The `e2e/snaps/` directory (snap.mjs output) is git-ignored.
- Test results and HTML reports are written to `e2e/test-results/` and `e2e/playwright-report/` (both git-ignored).
