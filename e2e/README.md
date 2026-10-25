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

The suite expects the apps in sample mode. If `apps/workspace/.env.local` sets `VITE_DATA_SOURCE=api` (as it does for the auth journeys), run the suite with `VITE_DATA_SOURCE=sample pnpm e2e` (Vite lets the shell override `.env.local`), and stop a workspace dev server that already runs in api mode on port 5173 first, because Playwright reuses it. The account menu and the context picker in the app headers (2026-10-25) touch every authenticated workspace and admin page; after a header fix for 320px only the settings baselines changed and the sign-in baselines were added. Update only the entries whose diffs you inspected, for example `VITE_DATA_SOURCE=sample pnpm exec playwright test e2e/screenshots.spec.ts --update-snapshots -g "screenshot: (workspace|admin)-settings"`. Known failures outside the workspace and admin entries (marketing `document-title`, marketing screenshots and reflow, and `e2e/auth/*.spec.ts` being collected by this config) are listed in `docs/auth/implementation.md` section 21.

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

1. **PostgreSQL and Redis** running (`pnpm db:up` starts both via Docker Compose).

2. **`TEST_DATABASE_URL`** (or `E2E_DATABASE_URL`) in your shell. The stub API never uses the developer database in `apps/api/.env`: it gets its own, `nestself_e2e_<prefix>` on the `TEST_DATABASE_URL` server, or exactly `E2E_DATABASE_URL` when that is set, which must name a `nestself_e2e_*` or `nestself_test_*` database (anything else, including `nestself`, `postgres` and the templates, is refused before a server starts). `<prefix>` is `TEST_DATABASE_PREFIX` or the first eight hex characters of the SHA-1 of the repository root, the same rule as the API integration suites, so two git worktrees never share the database. Without either variable the run stops at once with a message saying so.

   ```bash
   export TEST_DATABASE_URL=postgresql://nestself:nestself_dev@localhost:54329/nestself_test
   ```

   Every run resets that database. `e2e/global-setup.ts` drops and recreates it, applies the migrations and runs the sample seed through the API's own scripts (`scripts/reset-database.ts`, which drops `WITH (FORCE)` and accepts only `nestself_e2e_*` / `nestself_test_*`; `scripts/migrate.ts`; `scripts/seed.ts`) with `DATABASE_URL` overridden; dotenv never overrides a variable that is already set, so `.env` cannot redirect them. Playwright starts web servers before global setup and the API pings its database on boot, so the API web server command first runs the same file with `--ensure` (create if missing, migrate). The journeys need the seeded sample people: `hr-access.spec.ts` signs in as the sample HR admin (`user_ivana`), whom the seed also makes the employer owner (`grant_user_ivana_employer_owner`).

3. **Redis** reachable at the `REDIS_URL` in `apps/api/.env` (the API still reads everything except `DATABASE_URL` from there).

4. **Chromium** installed for Playwright:

   ```bash
   pnpm exec playwright install chromium
   ```

### Running

```bash
pnpm e2e:auth
```

This starts the API (stub mode, fixed OTP `123456`, insecure-dev cookies), the workspace app (`VITE_DATA_SOURCE=api`) and the admin app (`VITE_DATA_SOURCE=api`), then runs all specs under `e2e/auth/` with a single worker (project `auth-desktop`; the `screenshots` project below runs only when asked for).

### TOTP enrolment state caveat

The fake identity provider keeps TOTP enrolment in memory. On the **first** password sign-in of a user against an API process, the journey hits the enrolment screen, reads the manual key, computes a code, confirms setup, and persists the secret to `e2e/.auth-state/<user>-totp-secret.txt` (`nikola-totp-secret.txt`, `milica-totp-secret.txt`). Later sign-ins in the same process read that secret and enter a computed code on the plain challenge screen. `signInWithPassword` in `e2e/auth/support.ts` handles both shapes; `admin-sign-in.spec.ts` does the same for Nikola.

If the API process is restarted but the secret file still exists the test will fail because the API no longer knows that secret. Delete `e2e/.auth-state/` and re-run to trigger a fresh enrolment.

### Reused dev servers

Outside CI, Playwright reuses whatever already listens on ports 4000, 5173 and 5174. An API started with `pnpm --filter @nestself/api dev` reads `AUTH_MODE` from `apps/api/.env`. If that is `cognito`, the email-code journeys fail because the fixed code `123456` only works in stub mode. Stop that server before `pnpm e2e:auth`. A reused server also keeps its own `DATABASE_URL`, so global setup resets the e2e database while the tests hit whatever that server uses; if you start one yourself, give it `DATABASE_URL` set to the e2e database as well as `AUTH_MODE=stub FAKE_IDP_FIXED_OTP=123456 SESSION_COOKIE_INSECURE_DEV=true`.

### HR grant administration journey

`hr-access.spec.ts` follows the sample HR admin through `/hr/access`. It opens the screen with a deep link (which also proves the route guards wait for the session), checks the grant table, previews Ana Nikolić's effective access (`content.read`), delegates `people.invite` from her HR administrator grant to Stefan Marković by choosing options with the pointer inside the dialog, and finds `people.invite` in Stefan's effective-access preview. Since the owner model of 2026-10-24 gave `employer_owner` `access.grant` and `access.revoke`, it then assigns `team_manager` to Ana on the Product unit and revokes that same grant (found by the id in the create response) with a reason. Repeated delegations are accepted, so a run against a database that was not reset adds one more delegated row; the test only requires at least one. Ownership transfer is not run (it would move Ivana's owner grant away); component tests and the API e2e suite cover it. The session is fresh, so no step-up dialog appears; the dialog is covered by component tests and the API e2e suite.

### Journeys for the account, people, operations and expert screens

- `account.spec.ts`: Ivana opens `/settings` by deep link and sees her saved display name, changes it and sees the new name in the header's account menu, restores it, checks that the sessions list marks this browser and lists a second browser signed in at the start, then signs out everywhere: this browser lands on `/sign-in` and both browsers' sessions are gone.
- `hr-people.spec.ts`: Ivana invites `new.colleague.<run>@example.com` with the employee template and sees it pending, revokes it, moves Ana Nikolić to Sales and back to her own unit, and adds a department under Example d.o.o. and renames it. End membership is opened and cancelled (ending it would remove a seeded member), and no step-up dialog appears on the fresh session.
- `admin-ops.spec.ts`: stages `platform_owner` grants for Nikola and Milica (`grant_user_nikola_platform_owner_e2e`, `grant_user_milica_platform_owner_e2e`; the seed has none and emergency approval needs a second platform owner; the fake identity provider lives in the API process, so a new staff account cannot be created from here). Nikola opens the organizations list, the sample organization and its People tab; requests emergency access to `case_sample` and finds Approve and Deny hidden on his own request; Milica approves it in a second browser; Nikola opens the record view, sees "This access is audited" and reads `conv_sample`; the user lookup for `user_jovan` offers Suspend, whose dialog is opened and cancelled.
- `expert-cases.spec.ts`: Milica opens `/cases`, finds `case_sample`, opens `conv_sample` and reads both fixture messages; no step-up dialog and no `step_up_required` answer on the fresh session.

All four are safe to re-run: global setup reseeds the database, and the names they create carry the run's timestamp. The staging helper (`stagePlatformGrant` in `support.ts`) also deletes the user's cached principal from the Redis in `REDIS_URL`, because Redis outlives the API process and a principal cached by a previous run would hide the new grant.

`pnpm e2e:auth` runs ten tests in total: four in `workspace-sign-in.spec.ts` and one each in `account.spec.ts`, `admin-ops.spec.ts`, `admin-sign-in.spec.ts`, `expert-cases.spec.ts`, `hr-access.spec.ts` and `hr-people.spec.ts`.

### File structure

```
e2e/
  global-setup.ts               -- resets, migrates and seeds the e2e database
  e2e-database.ts               -- which database that is (E2E_DATABASE_URL / TEST_DATABASE_URL)
e2e/auth/
  totp.ts                       -- RFC 6238 TOTP helper (node:crypto only)
  support.ts                    -- sign-in helpers, persisted authenticator secrets, e2e database staging
  workspace-sign-in.spec.ts     -- employee email-code, sign-out, guards, error
  admin-sign-in.spec.ts         -- staff password + TOTP enrol / challenge
  hr-access.spec.ts             -- HR admin: grant table, access preview, delegation, assign and revoke
  account.spec.ts               -- display name, sessions, sign out everywhere
  hr-people.spec.ts             -- invite and revoke, move a member, add and rename an org unit
  admin-ops.spec.ts             -- organizations, people tab, emergency access with two staff, user lookup
  expert-cases.spec.ts          -- expert opens an assigned case conversation
e2e/screenshots/
  shots.ts                      -- shot() and pick() helpers, output directory
  admin.shot.ts                 -- admin sign-in, enrolment, platform and organization access
  operations.shot.ts            -- admin organizations, people, emergency list and record, suspend dialog
  workspace-screens.shot.ts     -- settings, sessions, context picker, people, import, org units, expert and participant views
  workspace.shot.ts             -- workspace sign-in, access screen, dialogs, step-up
  README section                -- this section
```

Reports and results are written to `e2e/auth-report/` and `e2e/auth-results/` (both git-ignored).

### Screenshots for the auth guides (`e2e/screenshots/`)

The PDFs in `docs/auth/` carry screenshots of the real screens. Regenerate them with the same stack and prerequisites as `pnpm e2e:auth`, then rebuild the PDFs:

```bash
export TEST_DATABASE_URL=postgresql://nestself:nestself_dev@localhost:54329/nestself_test
pnpm docs:auth:screenshots   # PNGs in docs/auth/screenshots/
pnpm docs:auth:pdf           # docs/auth/implementation.pdf and quick-guide.pdf
```

`docs:auth:screenshots` runs the `screenshots` project of `playwright.auth.config.ts`: `e2e/screenshots/*.shot.ts` (not `*.spec.ts`, so `pnpm e2e` never picks them up), 1280×800, light colour scheme, device scale factor 1, reduced motion, viewport-only PNGs well under 300 KB. Global setup resets the e2e database first, so the screens show only the fictional sample people.

- `workspace.shot.ts` signs in as Ivana and captures the sign-in steps, `/hr/access`, the effective-access panel, the assign and transfer dialogs (both cancelled, nothing is created) and the step-up dialog. To open the step-up dialog without waiting 30 minutes it answers the first `POST /orgs/:orgId/grants` in the browser with the API's own 403 `step_up_required` body; the dialog then starts a real challenge against the stub API.
- `operations.shot.ts` (runs after `admin.shot.ts`, so Nikola is enrolled) captures `admin-organizations`, `admin-org-people`, `admin-emergency-list`, `admin-emergency-record` and `admin-user-suspend` (dialog open, not confirmed). It stages the same platform owner grant and two emergency access rows whose purposes start with "Staged for the guide screenshots": a pending request by Milica and an approved access of Nikola's for `case_sample`.
- `workspace-screens.shot.ts` captures, as Ivana, `workspace-settings-account`, `workspace-settings-sessions`, `workspace-context-picker` (menu open), `workspace-people-members`, `workspace-people-import-result`, `workspace-people-invitations` and `workspace-org-units`; as Milica `workspace-expert-cases` and `workspace-expert-conversation`; as Jovan `workspace-my-conversation`. The import creates two invitations for fictional `new.colleague.*@example.com` addresses in the disposable database (and is refused for Ana, an active member), so the result and the pending list have rows.
- `admin.shot.ts` inserts `grant_user_nikola_platform_owner_screenshots` into the e2e database (the sample data has no platform owner, and the admin access pages need `access.preview`), then signs in as Nikola and captures the password step, authenticator enrolment, `/access`, the user-access lookup and the organization Access tab. Enrolment appears only on the first sign-in against a fresh API process; if an API on port 4000 is reused the test stops with a message, so stop it first. The secret is persisted to `e2e/.auth-state/` like `admin-sign-in.spec.ts` does.

Add a screenshot by adding a `shot(page, '<name>')` call (`e2e/screenshots/shots.ts`) and embedding `![alt](screenshots/<name>.png)` followed by an `*italic caption*` line in the guide; `docs/auth/pdf/build.mjs` turns that pair into a captioned figure and fails when an image is missing.

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
