# Auth Owner Model and Close-out Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Implement the product owner's decision of 2026-10-24 on organization ownership, remove the test-database collisions between worktrees, fix the parked retry bug, and close phase 2 with a pull request.

**Architecture:** Builds on the phase 2 grants module (`apps/api/src/grants/`), templates in `@nestself/contracts`, the seed and the access screens. Ownership is a grant from the `employer_owner` template; uniqueness per organization is a service rule, transfer is one transaction.

**Spec:** Owner decision (verbatim intent): "employer_owner grants hr_admin access to grant and revoke, and we always have access to change anything to support them. There can only be one superadmin of organization and that's employer_owner; he can create, move that role to another, or we as support can help org to do that." Plus `docs/tasks/auth/auth-strategy.md` §4.4 (template table, to be amended) and `docs/auth/implementation.md` §11.

## Global Constraints

Same as `2026-10-24-auth-phase-2.md`: no installs; every route `@Authorize`; every failure visible in the UI with translated copy; four locales with generated `sr-Cyrl`; audit details sanitised; commit trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; DB suites with `TEST_DATABASE_URL`.

---

### Task 1: Organization ownership model (API, contracts, seed)

**Files:**
- Modify: `packages/contracts/src/templates.ts` (`employer_owner.actions` += `access.grant`, `access.revoke`; `stepUpActions` += both), `templates.test.ts`
- Modify: `apps/api/src/grants/grants.service.ts`, `grant-rules.ts`, `grants.controller.ts`, `ops-grants.controller.ts`, `grants.service.test.ts`
- Modify: `packages/contracts/src/org-admin.ts` (`OwnershipTransferRequestSchema = { newOwnerUserId: string min 1 }`, `OwnershipTransferResponseSchema = { revokedGrantId, createdGrant: GrantResponse }`), `auth.ts` `AUTH_ERROR_CODES` += `owner_exists`
- Modify: `apps/api/src/authz/golden-table.json` (one row: `employer_owner` grant allows `access.grant` in its org; one row: it does not allow `access.grant` in another org), `golden-table.md`
- Modify: `docs/tasks/auth/auth-strategy.md` §4.4 employer_owner row (amendment note), `apps/api/docs/auth-core.md`
- Test: `apps/api/test/grants.e2e.spec.ts` (replace the ad hoc `grant_test_ivana_access_admin` with Ivana's seeded `employer_owner` grant; new cases below), `apps/api/test/ops-grants.e2e.spec.ts`

**Interfaces:**
- Rule (service, `create` and `createPlatform` paths that target an organization): at most one active (unrevoked, within validity) `employer_owner` grant per `scopeOrgId`; a second → 409 `owner_exists` with `details.currentOwnerUserId`.
- `POST /orgs/:orgId/grants/transfer-ownership` (`@Authorize(ACTIONS['access.grant'], orgResourceFromContext('grant'))`, `WRITE_THROTTLE`): caller must be the current owner (their own active `employer_owner` grant in this org) else 403 `forbidden`; `newOwnerUserId` must be an ACTIVE member else 409 `subject_not_member`; in one `withOrgScope` transaction revoke the caller's owner grant (reason `ownership_transferred`, children stay — they are delegations the new owner inherits nothing from; keep them) and create the new owner's grant from the template (`grantedByUserId` = caller); audit `grant.revoked` + `grant.created` with `details.transfer = true`; invalidate both subjects.
- `POST /ops/orgs/:orgId/grants/transfer-ownership` (`operationsOrgResource('grant')`, `access.grant`): staff variant; no current-owner requirement (support path); if the org has no owner yet, it simply creates one. Same body, response and audit (`details.transfer = true, byStaff = true`).
- Seed: Ivana keeps `employer_owner`; nobody else in `org_sample` has it (assert in `seed-lib.test.ts`).

- [ ] Step 1: contracts + templates tests (RED → GREEN), commit `feat(contracts): employer_owner holds access.grant and access.revoke; ownership transfer schemas`.
- [ ] Step 2: service unit tests for the uniqueness rule and both transfer paths (owner check, member check, atomic revoke+create, audits, invalidation) → implement → GREEN.
- [ ] Step 3: e2e: Ivana (seeded owner) creates a `team_manager` grant for Ana without any test-inserted admin grant → 201; a second `employer_owner` for Stefan → 409 `owner_exists`; Ivana transfers ownership to Stefan → 200, her grant revoked, Stefan's `/auth/me` lists `access.grant`, Ivana's no longer does; Stefan (new owner) revokes Ana's grant → 200; staff (nikola with the test-inserted `platform_owner`) transfers ownership of `org_sample` back to Ivana via the ops route → 200. Golden rows green. Full API suite.
- [ ] Step 4: commit `feat(api): single employer owner per organization and ownership transfer`.

### Task 2: Web: owner actions and transfer dialog

**Files:**
- Modify: `apps/workspace/src/features/access/` (`access-screen.tsx`: "Transfer ownership" button visible when the principal holds the owner grant; new `transfer-ownership-dialog.tsx` with member `Select`, confirmation copy, `withStepUp`, error mapping incl. `owner_exists`, `subject_not_member`), `use-org-admin.ts`, `access-errors.ts`, tests
- Modify: `apps/admin/src/features/access/` (org page: "Transfer ownership" for staff via the ops route; error mapping), tests
- Modify: `packages/api-client/src/org-admin.ts` (`transferOwnership(orgId, body)` on both kinds), test
- Modify: `packages/i18n/locales/{en,sr-Latn,hu}/{workspace,admin}.json` + `build:cyrillic`
- Modify: `e2e/auth/hr-access.spec.ts`: now that Ivana holds `access.grant`/`access.revoke`, extend the journey with assign `team_manager` to Ana and revoke it (re-run safe: revoke what was created in the same run)

- [ ] Step 1: tests RED → implement → GREEN per app; `pnpm e2e:auth` 6/6 with the extended journey.
- [ ] Step 2: commit `feat(web): ownership transfer and owner-driven grant assignment`.

### Task 3: Per-worktree test databases, a dedicated Playwright database, and the retry predicate

**Files:**
- Modify: `playwright.auth.config.ts` — the stub API web server runs with `DATABASE_URL` pointing at a dedicated database (`nestself_e2e` on the same server as `TEST_DATABASE_URL`, derived from it, or `E2E_DATABASE_URL` when set); add a `globalSetup` (`e2e/global-setup.ts`) that drops/recreates that database, runs the migrations and the seed (reuse `apps/api/test/db/test-database.ts` `resetTestDatabase` and `apps/api/src/db/seed` programmatically through `tsx`, or shell out to `pnpm --filter @nestself/api db:migrate` / `db:seed` with the env overridden); `e2e/README.md` documents it; `pnpm e2e:auth` therefore never depends on the developer database
- Modify: `apps/api/test/db/test-database.ts` (`resetTestDatabase(baseUrl, suffix)` derives the database name as `<base>_<prefix>_<suffix>` where `prefix` = `TEST_DATABASE_PREFIX` env if set, else a short stable hash of the worktree root path (`git rev-parse --show-toplevel` equivalent: use `process.cwd()` walked up to the nearest `pnpm-workspace.yaml`)), every e2e/DB spec unchanged (they pass only the suffix), `docs/environment.md` + `apps/api/README.md` (one paragraph)
- Modify: `apps/workspace/src/query-retry.ts`, `apps/admin/src/query-retry.ts` (+ tests): retry only when the error is not an `ApiError` with `400 <= status < 500`; status 0 (network) retries; docs §11.1 wording already claims this

- [ ] Step 1: unit test for the name derivation (two different roots → different names; same root → same name; env override wins) → implement → GREEN; run two DB suites to confirm.
- [ ] Step 2: retry tests (status 0 → retry, 404 → no retry, 500 → retry up to 3) → implement → GREEN.
- [ ] Step 3: commit `fix(test): per-worktree test database names` and `fix(web): retry network failures, not 4xx`.

### Task 4: Screenshots, docs and PR

**User requirement (2026-10-25):** every auth capability must have real frontend screens, and the PDF documentation must carry screenshots of them.

**Files:**
- Create: `docs/auth/pdf/capture-screenshots.mjs` (Playwright, Chromium; starts nothing itself: it expects the stub stack from `playwright.auth.config.ts` to be running, or is invoked as a Playwright project `screenshots` in that config with its own `testDir e2e/screenshots`); writes PNGs (1280×800, light theme, `deviceScaleFactor: 1`) into `docs/auth/screenshots/`: `workspace-sign-in-identifier.png`, `workspace-sign-in-code.png`, `admin-sign-in-password.png`, `admin-totp-enrol.png`, `step-up-dialog.png` (force it by ageing the session through the API test hook or by calling the dialog's story in Storybook if simpler — prefer a real screen), `workspace-access.png`, `workspace-assign-template.png`, `workspace-transfer-ownership.png`, `workspace-effective-access.png`, `admin-org-access.png`, `admin-platform-access.png`, `admin-user-access-lookup.png`; sample mode is acceptable for screens whose API path needs grants nobody holds, but prefer `VITE_DATA_SOURCE=api` against the stub API with the seeded people (Ivana as owner)
- Modify: `docs/auth/pdf/build.mjs` so relative Markdown images resolve to `file://` paths of the source directory (verify it today; fix if not), `package.json` root script `docs:auth:screenshots` and `docs:auth:pdf`
- Modify: `docs/auth/implementation.md` (embed the screenshots in §6 sign-in, §8 step-up, §11 grants/ownership, each with a one-line caption) and `docs/auth/quick-guide.md` (sign-in and access screens); `docs/auth/implementation.md` §11 (ownership model, transfer routes), §21 (owner decision resolved; strategy amendment), `docs/tasks/auth/phase-2-readiness.md` §4, `CLAUDE.md` one line ("one employer_owner per organization; transfer via the API"); rebuild both PDFs and check the images render in them (open the PDF page count / grep the PDF for `/Image`)
- `e2e/README.md`: how to regenerate screenshots

- [ ] Capture script + builder fix; screenshots committed (PNG, under 300 KB each; no real names other than the fictional sample people).
- [ ] Docs edits; `pnpm verify` with the DB suites; `pnpm e2e:auth`.
- [ ] Commit `docs(auth): organization ownership model and screenshots in the guides`.
- [ ] Push `feat/auth-foundation` and open the PR against `main` with the phase 2 summary.

