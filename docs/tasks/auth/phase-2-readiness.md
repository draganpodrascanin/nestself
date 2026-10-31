# Phase 2 readiness: authorization administration

## Status on 2026-10-24

Phase 2 was carried out on `feat/auth-foundation` following `docs/superpowers/plans/2026-10-24-auth-phase-2.md` (plan commit `3391a27`, last code commit `c2d2863`). The plan's "Decisions taken" table records what it decided beyond this document; `docs/auth/implementation.md` describes what shipped, and its section 21 lists every remaining gap.

| Task | Status | What shipped or why not | Commits |
| --- | --- | --- | --- |
| T-2.0 Operations routes for assigned clients | Done | `operationsOrgResource`; `/ops/orgs/:orgId/members` (`client.configure`, end with `people.deactivate`) and `/ops/orgs/:orgId/invitations` (`people.onboard`, import with `people.import`) | `3814139` |
| T-2.6 Step-up re-authentication | Done, with a deviation | `/auth/step-up/start` and `/verify`; enforced by the guard and by `AuthorizationService.require()`; web dialog and `withStepUp` in both apps. Every class uses an email code, the `emergency` class included (owner decision pending). Another user's challenge is refused and audited. Mobile step-up screen deferred | `f98228a`, `ccd6c94`, `851f406`, `807cd66`, `39402da` |
| T-2.1 Grant administration endpoints | Done | `/orgs/:orgId/grants` (list, create, patch, revoke, delegate, preview), `/orgs/:orgId/approval-authorities`, `/ops/grants` (with `POST /ops/grants/:grantId/revoke` for platform grants), `/ops/orgs/:orgId/grants`, `/ops/users/:userId/access`; delegation bounded by the parent grant and loaded with its ancestors at runtime; invitations accept organization and employee templates only. Throttle is per route and IP, not per session | `6953a9a`, `82eac50`, `1af4632`, `a430220`, `1a3b3bb`, `a748d73`, `efc8400`, `707dc2b`, `b11bb53`, `ede6c64`, `4d02ee0`, `c2d2863`, `37a2333`, `898bd65` |
| T-2.2 Template and grant administration UI | Done | Workspace `/hr/access`; admin organization Access tab and `/access`; `createOrgAdminApi`, `SAMPLE_GRANTS`; `effectiveActions` now filled by the API; route guards wait for the session; platform grants revocable from `/access`; 4xx answers are not retried | `53a036c`, `94cc6d0`, `f0a4da7`, `5b0b0bf`, `65685f8`, `abbbdfe`, `72f7745`, `f72d89e`, `6eac71d`, `898bd65`, `b6b5583` |
| T-2.4 and T-2.3 Confidential domain and its RLS | Done, placeholder tables | `conversations`, `conversation_messages`, `intake_records` under forced RLS (sixteen tenant tables); read routes under `/professional/*`; `expert` template gained `conversation.read.assigned`. No write routes; a `cases(id, org_id)` table is a blocker before the first one. `professional_notes` deferred | `3c97d23`, `2680dd4`, `7a71da7` |
| T-2.5 Emergency access | Done | Request, approve (second person, four-hour cap), deny, revoke, record reads, `emergency.sweep-expired` every 15 minutes, metric filter on the approval log line. Approver policy is the default below until the owner decides | `c3e20bb`, `ac454ed`, `fb00396`, `807cd66` |
| T-2.7 Role backfill and legacy removal | Done for the role columns | `db:backfill-grants`; migration `0005` drops `users.platform_role` and `memberships.role` behind a guard; seed defect fixed; a `MANAGER` without an org unit is backfilled at organization scope and reported as `widened`; the backfill runs before `db:migrate` reaches `0005`. `memberships.team_id`, `legacy_teams`, the community tables and the contracts' legacy role types stay for the community retirement and sample mode | `57bfd4f`, `853874a`, `0c04832`, `f3f4bc1`, `176c363`, `ed0bbbe` |
| T-2.10 Nightly jobs | Partly done | `sessions.reconcile-ttl` and `emergency.sweep-expired` added; Redis in the health check; `worker:dev` and `job:run` run through the Nest compiler. Weekly Cognito export (T-2.12), retention sweeper, audit export and SSO certificate check deferred | `68545ae`, `f12e5ea`, `06742bf` |
| Review gaps from `implementation.md` section 21 | Done | Email code retypable three times per challenge, lock checked on verify, code emails in the screen's language | `bfce0f6`, `df83b8c` |
| Browser journey | Done | `pnpm e2e:auth` runs ten tests since the UI-completeness plan (six in phase 2, including `hr-access.spec.ts`) | `be65cf3` |
| Organization owner model (2026-10-24) | Done | One `employer_owner` per organization with `access.grant` and `access.revoke`; `POST /orgs/:orgId/grants/transfer-ownership` (owner) and `/ops/orgs/:orgId/grants/transfer-ownership` (staff), delegations re-parented in the same transaction; owner invitations refused while an owner exists; transfer dialogs in both web apps; `hr-access.spec.ts` assigns and revokes; dedicated e2e database and per-worktree test database names; screenshots in the guides | `002c7d6`, `1172c72`, `f08d958`, `0c22c68`, `6e9b297`, `aeea027`, `f08c865`, `4ec3bb0`, `1876e87` |
| T-2.8 Security baseline, SCPs, production account | Deferred | Waits for staging | |
| T-2.9, T-2.11 File delivery and export authorization | Deferred | No files or exports exist to authorize | |
| T-2.12 Weekly Cognito user export | Deferred | Needs the S3 archive bucket (staging) | |
| Compliance track (T-C.x) | Owner decision | Unchanged; must land before the first real employee signs in | |
| Phase 3 SSO | Done locally; live IdP test pending | See "Phase 3 status" below | |
| Phase 4 pilot readiness and auth debts | Done locally; deployment and the live IdP test pending | See "Phase 4 status" below | |

### UI coverage (2026-10-25)

The UI-completeness plan (`docs/superpowers/plans/2026-10-25-auth-ui-completeness.md`, branch `feat/auth-ui`) gave the API's auth capabilities screens in the web apps. Every row of the gap map is listed; mobile is out of scope by decision (administration is web only; the app keeps sign-in, settings and sign-out). Routes, gates and screenshots per screen: `docs/auth/implementation.md` section 3.1.

| Capability (API) | Screen | Status |
| --- | --- | --- |
| Display name and language (`PATCH /auth/me/display-name`, `/auth/me/locale`) | Workspace and admin `/settings`, Account | Covered |
| Sessions list, end one, sign out everywhere (`/auth/sessions`, `/auth/sign-out-all`) | `/settings`, Security | Covered; journey `account.spec.ts` |
| Authenticator for a signed-in user (`POST /auth/me/totp/enrol`, `/auth/totp/confirm`) | `/settings`, Security (password users) | Covered |
| Sign out (`POST /auth/sign-out`) | Header account menu, both apps | Covered; journey `workspace-sign-in.spec.ts` |
| Context switch (`POST /auth/context`) | Header context picker, both apps | Covered |
| Members list, move, end (`/orgs/:orgId/members`) | Workspace `/hr/people`, Members | Covered; journey `hr-people.spec.ts` (end is opened and cancelled) |
| Invitations list, create, import, revoke (`/orgs/:orgId/invitations`) | Workspace `/hr/people`, Invitations | Covered; journey `hr-people.spec.ts` (invite, revoke) |
| Org units create, rename, move (`/orgs/:orgId/org-units`) | Workspace `/hr/org-units` | Covered; journey `hr-people.spec.ts` (add, rename) |
| Grants, delegation, preview, ownership transfer (`/orgs/:orgId/grants`) | Workspace `/hr/access` | Covered (phase 2); journey `hr-access.spec.ts` |
| Grant update of conditions or validity (`PATCH /orgs/:orgId/grants/:id`) | None | Deferred |
| Approval authorities (`/orgs/:orgId/approval-authorities`) | None | Deferred |
| Organizations list and detail (`GET /ops/organizations`, `/:orgId`) | Admin `/organizations`, `/organizations/:orgId` | Covered; journey `admin-ops.spec.ts` |
| Ownership by staff (`/ops/orgs/:orgId/grants/transfer-ownership`) | Admin organization Overview and Access tab | Covered |
| Members and invitations of assigned clients (`/ops/orgs/:orgId/members`, `/invitations`) | Admin `/organizations/:orgId/people` | Covered; journey `admin-ops.spec.ts` (members) |
| Platform and organization grants, user access (`/ops/grants`, `/ops/orgs/:orgId/grants`, `/ops/users/:userId/access`) | Admin `/access`, organization Access tab | Covered (phase 2) |
| Suspend and reinstate (`/ops/users/:userId/suspend`, `/reinstate`) | Admin user lookup result | Covered; journey `admin-ops.spec.ts` (Suspend offered, cancelled); own account refused (409 `cannot_suspend_self`) |
| Emergency access request, approve, deny, revoke (`/ops/emergency-access`) | Admin `/emergency` | Covered; journey `admin-ops.spec.ts` (request, own-request rule, approval by a second platform owner) |
| Emergency record read (`/ops/emergency-access/:id/records/*`) | Admin `/emergency`, Open record (audited notice) | Covered; journey `admin-ops.spec.ts` |
| Assigned conversations and intake (`/professional/conversations`, `/professional/intake/:id`) | Workspace `/cases`, `/cases/:id` | Covered; journey `expert-cases.spec.ts`. Intake id typed by hand until conversations carry it |
| Participant conversations (`/professional/me/conversations`) | Workspace `/conversations`, `/conversations/:id` | Covered |
| Step-up (`/auth/step-up/*`) | Step-up dialog, both web apps | Covered (phase 2); mobile deferred |
| Any of the above on mobile | None | Out of scope |
| Enterprise SSO (`/ops/sso-connections/*`, `/auth/sso/*`) | Admin `/sso`; workspace and admin `/sign-in` | Covered (phase 3); journey `sso-sign-in.spec.ts` |

### Phase 3 status (2026-10-25)

Enterprise SSO (`docs/superpowers/plans/2026-10-25-auth-phase-3-sso.md`, branch `feat/auth-sso`). Everything runs against the fake identity provider; details in `docs/auth/implementation.md` section 22.

| Task | Status | What shipped | Commits |
| --- | --- | --- | --- |
| T1 Contracts, schema, constants, audit actions | Done | SSO request and response schemas, error codes, `PUBLIC_EMAIL_DOMAINS`, `sso_domains` RLS (migration `0006`), SSO audit actions (plan: `97460b0`) | `1c633ba` |
| T2 Identity provider SSO methods | Done | Cognito provider CRUD, app-client updates preserving fields, token exchange with timeout, ID-token verification; the fake provider's SSO store; CDK task-role IAM actions | `6e2732b`, `707ed45`, `11ac4e8` |
| T3 SSO connections module | Done | `/ops/sso-connections` lifecycle, DNS TXT verification, tenant-scoped writes, `lastTestedAt` reset on any change | `604aff0`, `b5ec811`, `7815717` |
| T4 Discovery, start and callback | Done | Home-realm discovery, PKCE start and callback, the four resolution paths, verified-domain rule for new bindings, browser-bound state, single-use test links, stub-only fake authorize, web `reason` messages | `6c3cc15`, `f35226a`, `bb41e40` |
| T5 Admin SSO page | Done | `/sso` list, detail, create, edit, domains, test, activate, suspend; sample fixture; four locales | `4aa0293`, `d19573a`, `c76349a` |
| T6 Certificate-expiry job, docs | Done | `sso.certificate-expiry` (03:00), screenshots, guides, runbook amendment | `f4d7e06` and the `docs(auth): enterprise SSO` commit |
| T-3.4 Live IdP test | Pending pilot | Needs a pilot employer's IdP, domains and a test account (`implementation.md` section 22.13) | |

### Phase 4 status (2026-10-31)

Pilot readiness and auth debts (design `docs/superpowers/specs/2026-10-30-auth-phase-4-pilot-readiness-design.md`, plan `docs/superpowers/plans/2026-10-30-auth-phase-4-pilot-readiness.md`, branch `feat/auth-p2`). Everything runs locally and against the fake identity provider; nothing was deployed. What shipped is in `docs/auth/implementation.md` (section 21 lists what closed and what is left, with a reason each; section 23 is the new mailer). Commit ranges are `base..head`, the head included.

| Task | Title | Status | Commits |
| --- | --- | --- | --- |
| 1 | Contracts, schema and migrations | Done | `f78d658..031061f` |
| 2 | Email module: `Mailer` port, templates, SES and logging adapters | Done | `031061f..588f1f2` |
| 3 | NestSelf-issued one-time codes | Done | `588f1f2..91d13b0` |
| 4 | Audit rows in the caller's transaction; sweepers continue past failures | Done | `91d13b0..8f80b00` |
| 5 | Throttling: trackers, Redis storage, redirect on 429, trust proxy | Done | `8f80b00..268c494` |
| 6 | Step-up for federated users, `step_up_unavailable`, locale, resend, lockout; the web dialog | Done | `268c494..84e9e93` |
| 7 | Binding connection on the identity; `cognito:username` | Done | `84e9e93..93e0aff` |
| 8 | Pending binding after an unverified OIDC email (API and web) | Done | `93e0aff..f44048a` |
| 9 | Federated users on mobile: `bind-token` and bearer resolution | Done | `f44048a..4f833b1` |
| 10 | Certificates: metadata fetcher with SSRF guard, refresh points, ops alert, `SUSPENDED → TESTING` | Done | `4f833b1..c2b8fd5` |
| 11 | Admin SSO screen | Done | `c2b8fd5..6c4d12d` |
| 12 | Invitation import buckets, `@Authorize` any-of, member search escaping | Done | `6c4d12d..70794e4` |
| 13 | Confidential reads without an existence oracle; health indicator | Done | `70794e4..30e5e01` |
| 14 | Web: access route gate, `/auth/me` resilience, import reasons, member search | Done | `30e5e01..e4828c1`, fix `8141da3` |
| 15 | CDK: Cognito custom domain, environment, ALB restricted to CloudFront | Done (synthesized and tested, not deployed) | `e4828c1..c5a9c4c` |
| 16 | Documentation, screenshots and PDFs | Done | the `docs(auth): phase 4 documented; screenshots and PDFs rebuilt` commit, fix `docs(auth): CDK setup no longer claims the invitation link is logged` |
| 17 | User guides: one tutorial PDF per role | Done | the commits `docs(auth): per-role tutorial guides with screenshots, as PDFs`, `docs(auth): guide pictures legible, every step pictured, SSO onboarding on one connection` and `docs(auth): a guide step and its picture stay on one page` |
| Final review | Fixes from the whole-branch review | Done | the commits `fix(auth): invitation links open the accept screen, SSO reads behind step-up, picker keeps its choice, address-free logs, example domains`, `fix(auth): step-up codes bound to their session, invitation audit inside its transaction, cheaper native bearer path, unthrottled health checks`, `docs(auth): guides corrected, stale sentences fixed, PDFs rebuilt` and `test(infra,web): certificate region checked at synth, alias target and cdk.json flag asserted, web parity check` |

Owner confirmations after this phase (`implementation.md` section 17.2): `cdk diff NestSelf-dev-Auth -c stage=dev -c account=$AWS_ACCOUNT_DEV` shows no differences before the next dev deploy (phase 4 left the dev template unchanged); after the first staging and production deploys, the load balancer refuses traffic that does not come through CloudFront (`CDK-setup.md` 8.6 step 2); the Cognito custom domain is deployed before the first employer configures its identity provider. The live IdP test (T-3.4) waits for the pilot organisation (`implementation.md` section 22.13).

New owner decisions raised by phase 2 are in section 4 below. The rest of this document is the work list as it stood on 2026-10-23 and is kept for its reasoning.

Status as of 2026-10-23, after the phase 1 review and gap fixes on `feat/auth-foundation`. This document turns section 9.5 of `auth-strategy.md` into an ordered, concrete work list with the preconditions checked off, so the next engineer (or agent) can start a task without re-reading the whole strategy. The strategy remains the specification; task ids (`T-2.x`) refer to its tables.

## 1. Where phase 1 ended

Done and covered by tests:

- Identity and sessions: Cognito adapter and fake provider, identifier-first sign-in (email code, password, authenticator enrolment), BFF sessions in Redis, CSRF, mobile bearer verification with family tracking, context switching, profile endpoints, sessions list and revocation.
- Authorization: the pure `authorize()` engine with its golden table, guards, resolvers, default-deny CI test, principal and grant caches with invalidation, access revocation fan-out, WebSocket authentication and invalidation.
- Administration: invitations (single, import, revoke, accept), org units (create, update, move with closure maintenance), members (list, update, end with cascade revocation), platform suspension and reinstatement, SES invitation mailer.
- Data layer: Drizzle schema with thirteen tenant tables under forced row-level security (including the join-based policies for the legacy community tables and the closure table), partitioned append-only audit log, `nestself_app` role, migrations `0000` to `0002`.
- Background work: `JobAuthorization` for principal-bound jobs, `MaintenanceJobsService` with the audit-partition, grant-reconciliation and stale-mobile-family jobs, the BullMQ scheduler and the worker entrypoint, `job:run` for one-off execution.
- Infrastructure: the auth stack deploys alone by default; platform stacks are opt-in; GitHub Actions ci and deploy workflows; `CDK-setup.md` for the account setup.
- Documentation: `docs/auth/implementation.md`, `docs/auth/quick-guide.md`, `apps/api/docs/auth-core.md`, `docs/environment.md`.

Entry conditions from 9.5: "Phase 1 exit criteria met. Staging is operational." The first holds. Staging is deliberately not deployed yet (rollout order: Cognito first, web applications after the first features, mobile last), so phase 2 development continues locally and the infrastructure tasks (T-2.8) wait for the web rollout.

## 2. Decisions already taken that phase 2 builds on

| Decision | Where |
| --- | --- |
| Drizzle ORM with PostgreSQL row-level security instead of Prisma (D-37) | strategy 4.6.3, Appendix A; `apps/api/src/db/schema/_shared.ts` |
| `people.deactivate` belongs to `hr_admin` (organization), `platform_owner` (platform) and `client_operations` (assigned clients). Only `platform_owner` reaches `/ops/users/:id/suspend`; `client_operations` needs the operations routes of T-2.0 below | strategy 4.4; `packages/contracts/src/templates.ts` |
| Step-up classes and maximum ages are fixed (emergency 5 min, restricted 15, export 15, financial 15, administration 30); the guard already stamps `req.stepUpClass` | `packages/contracts/src/authorization.ts`; `apps/api/src/authz/authorization.guard.ts` |
| Stale mobile families are denylisted for 90 days rather than revoked at Cognito, because the API never holds the device's refresh token | `apps/api/src/jobs/maintenance-jobs.service.ts` |
| Maintenance jobs are system jobs (`actorKind: 'JOB'`, `actorUserId: null`) and run only in the worker process | `apps/api/src/jobs/job-scheduler.service.ts`, `apps/api/src/worker/main.ts` |

## 3. Work list in recommended order

Each item names the files to create or extend, what already exists to build on, and the acceptance test. Sizes follow the strategy (S, M, L).

### T-2.0 Operations routes for assigned clients (new, S)

Why first: without it `client_operations` has actions it cannot exercise, and T-2.1's grant administration for staff needs the same resolver.

- Add `operationsOrgResource(type)` to `apps/api/src/authz/resolvers.ts`: requires `context.kind === 'operations'` and a web session (as `operationsResource`), reads `:orgId` from the route and returns `{ type, orgId }` so `authorize()` applies the `assigned_clients` scope through the CLIENT assignment (golden cases OPS-01, OPS-05, OPS-06).
- Mount the needed handlers under `/ops/orgs/:orgId/...` (members end, invitations create and import) by reusing the existing services; the services already take `orgId` and run in `withOrgScope`.
- Tests: resolver unit tests; an e2e case where `user_nikola` (seeded `client_operations` with a CLIENT assignment to `org_sample`) ends a membership through the ops route and is denied for an unassigned organization. Update `apps/api/docs/auth-core.md` and `docs/auth/implementation.md` section 11.

### T-2.6 Step-up re-authentication (M)

- `apps/api/src/auth/step-up.service.ts`: `POST /auth/step-up/start` returns the challenge appropriate to the session's method (email code for `email_otp`, password or authenticator for `password_totp`; federated users are phase 3), `POST /auth/step-up/verify` consumes it, sets `lastStepUpAt`, regenerates the session id (`SessionService.regenerate()` already rotates the CSRF token) and audits `auth.step_up.completed` or `auth.step_up.failed` (both actions already exist).
- Enforcement in `AuthorizationGuard`: after `authorize()` allows, compare `max(auth.time, lastStepUpAt)` with `STEP_UP_MAX_AGE_SECONDS[req.stepUpClass]`; on failure return 403 `step_up_required` with the class so the clients can open the step-up screen (`auth.json` already has the `stepUp` strings).
- Clients: `packages/api-client/src/auth.ts` (`stepUpStart`, `stepUpVerify`), a modal in `apps/workspace/src/auth/` and `apps/admin/src/auth/` triggered by the 403 code.
- Tests: unit tests per class; e2e: `people.deactivate` after a 31-minute-old authentication is refused until step-up; mobile bearer requests get `step_up_required` and complete step-up through the API (mobile has no session; the result is a short-lived step-up assertion stored under `stepUpKey(originJti)`, already defined in `redis-keys.ts`).

### T-2.1 Grant administration endpoints (L)

- `apps/api/src/grants/`: list, create from template, patch, revoke, delegate, preview under `/orgs/:orgId/grants` (organization context) and the same under `/ops/orgs/:orgId/grants` for staff (T-2.0 resolver). Approval authorities under `/orgs/:orgId/approval-authorities`.
- Validation: template `requiredConditionTypes` must be present; delegation never exceeds the delegator's effective access or envelope; depth limit 3; self-approval refused unless `organizations.self_approval_allowed`.
- Reuse: `AuthorizationRepository.createGrant/revokeGrants/findActiveChildGrants`, `effectiveAccess()` and `explain()` in `apps/api/src/authz/`, `PrincipalLoader.invalidateUser`, audit actions `grant.*` and `approval_authority.changed`.
- Throttle: 10 writes per minute per session (API-R-22) with a route-specific `ThrottlerGuard` configuration.
- Tests: integration suite with delegation depth, envelope and self-approval cases; golden-table additions for new condition combinations.

### T-2.2 Template and grant administration UI (L)

- `apps/admin/src/routes/_authenticated/orgs/$orgId/grants/` and the workspace equivalent for HR: grant list, assign template with scope and conditions, effective-access preview, revoke with reason. Gate with `can('access.delegate')` or `can('access.grant')`.
- Use `packages/ui` components; add stories and colocated tests; translations in `packages/i18n/locales/*/admin.json` with the Cyrillic build.

### T-2.4 and T-2.3 Confidential domain and its RLS (L, M)

- `apps/api/src/db/schema/professional.ts`: `conversations`, `conversation_messages`, `intake_records`, `professional_notes`, each with `org_id` and a `pgPolicy` from `tenantPredicate()`, plus the `isConfidential` marker the engine already honours (step 3 of `evaluate()`).
- `apps/api/src/professional/`: controllers using `conversation.read.assigned`, `notes.read.supervision`, `records.read.emergency`; `CONFIDENTIAL_ACTIONS` is already in the contracts.
- Migration via `db:generate`; extend `test/db/schema.spec.ts` with cross-tenant cases for the new tables (the pattern is the `posts` test).

### T-2.5 Emergency access (M)

- `apps/api/src/emergency/`: request, approve, deny, use. The `emergency_access` table and `findActiveEmergencyAccess()` exist; `authorize()` already evaluates `expiresAt` from the record. Audit actions `emergency_access.*` exist. The observability stack already alarms on `EmergencyAccessActivations`.

### T-2.7 Role backfill and legacy removal (M)

- `apps/api/scripts/backfill-grants.ts` converts `users.platform_role` and `memberships.role` to grants (the seed's `legacyRole` mapping in `seed-lib.ts` is the reference), then migrations drop `platform_role`, `memberships.role`, `memberships.team_id`, `legacy_teams`, and the community tables (`posts`, `polls`, `poll_options`, `poll_votes`) move to org units or are retired. Remove `LegacySessionSchema`, `OrgRole`, `PlatformRole`, `canAccessHr`, `canManageTeam` from the contracts and the sample-data roles that feed only the seed.

### T-2.9, T-2.11 File delivery and export authorization (M, M)

- Presigned S3 URLs only after `authorize()`; exports call `report.export` or `data.export.own`, then apply cohort rules. Both are plain services with unit tests; they need the S3 bucket from the data stack, so the real test waits for staging.

### T-2.10 and the remaining nightly jobs (S each)

The scheduler and worker exist; each job is a method on `MaintenanceJobsService` plus an entry in `MAINTENANCE_SCHEDULES` and a unit test:

- session TTL-drift reconciliation (SESS-R-16): scan `session:*`, delete records whose `absoluteExpiresAt` passed, revoke their refresh tokens;
- weekly Cognito user export (T-2.12): `ListUsers` pagination, attributes only, to the audit archive bucket;
- retention sweeper once counsel resolves L-02 and L-03;
- audit export to S3 with Object Lock (AUDIT-R-06), then partition detachment;
- SSO certificate expiry check (SSO-R-14) with phase 3.

### T-2.8 Security baseline, SCPs, production account (M)

Waits for the web rollout (step 2 of `infra/cdk/README.md`). SCPs per D-23, Security Hub and AWS Config conformance pack, production account bootstrap. `cdk-nag` already gates the platform stacks in CI with `-c platform=true`.

### Compliance track (T-C.x)

Privacy notices, the processing agreement, the breach procedure and the data-subject-rights endpoint stubs (`POST /me/data-export`, `POST /me/erasure-request`, audit actions exist) must land before the first real employee signs in. These are owner decisions as much as engineering tasks; the open questions are in strategy section 11.

## 4. Open decisions for the product owner

Resolved on 2026-10-24: who administers grants inside an organization. Exactly one `employer_owner` per organization holds `access.grant` and `access.revoke` and can transfer the role; NestSelf staff can change anything, including the owner (`docs/auth/implementation.md` section 11.1, strategy 4.4 amendment; plan `docs/superpowers/plans/2026-10-24-auth-owner-model.md`).

| Question | Why it blocks | Default if undecided |
| --- | --- | --- |
| Does webinar delivery need a `presenter` template (GAP-H02)? | Affects the template table and the golden cases in T-2.1 | `content_publisher` keeps replay review; presenters use `expert` |
| Retention periods per domain (L-02, L-03) | The retention sweeper cannot be written without them | Current defaults in `audit-writer.ts` (1 to 10 years) stay |
| Who may approve emergency access, and is a second approver required? | T-2.5 request and approval flow | `platform_owner` approves; one approver |
| Staging deployment date | T-2.8, T-2.9, T-2.11 and the real SES, S3 and WAF behaviour | Local development continues; use `cdk synth -c platform=true` to keep the stacks reviewed |
| Step-up method for the `emergency` class (raised 2026-10-24) | The strategy asks for an authenticator; Cognito cannot issue one without a password first | Email code for every class |
| A `cases(id, org_id)` table before conversation writes (raised 2026-10-24) | Resolved by phase 4, Task 1: migration `0017` (`0007` on the branch) adds the table with composite foreign keys from `conversations` and `intake_records` | |

## 5. Definition of done for phase 2

Pilot exit criterion 4 (no employer or generic admin view reveals private content) demonstrated with tests; grants administered from the admin and workspace apps without database access; step-up enforced for every action in `STEP_UP_CLASS_BY_ACTION`; `platform_role`, `OrgRole` and `PlatformRole` removed after backfill; every tenant table, including the confidential domain, under forced RLS; the nightly job list above running in the worker with audit evidence; `pnpm verify` green and `docs/auth/implementation.md` updated.
