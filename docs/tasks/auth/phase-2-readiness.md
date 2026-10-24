# Phase 2 readiness: authorization administration

## Status on 2026-10-24

Phase 2 was carried out on `feat/auth-foundation` following `docs/superpowers/plans/2026-10-24-auth-phase-2.md` (plan commit `3391a27`, last code commit `c2d2863`). The plan's "Decisions taken" table records what it decided beyond this document; `docs/auth/implementation.md` describes what shipped, and its section 21 lists every remaining gap.

| Task | Status | What shipped or why not | Commits |
| --- | --- | --- | --- |
| T-2.0 Operations routes for assigned clients | Done | `operationsOrgResource`; `/ops/orgs/:orgId/members` (`client.configure`, end with `people.deactivate`) and `/ops/orgs/:orgId/invitations` (`people.onboard`, import with `people.import`) | `3814139` |
| T-2.6 Step-up re-authentication | Done, with a deviation | `/auth/step-up/start` and `/verify`; enforced by the guard and by `AuthorizationService.require()`; web dialog and `withStepUp` in both apps. Every class uses an email code, the `emergency` class included (owner decision pending). Mobile step-up screen deferred | `f98228a`, `ccd6c94`, `851f406`, `807cd66` |
| T-2.1 Grant administration endpoints | Done | `/orgs/:orgId/grants` (list, create, patch, revoke, delegate, preview), `/orgs/:orgId/approval-authorities`, `/ops/grants`, `/ops/orgs/:orgId/grants`, `/ops/users/:userId/access`; delegation bounded by the parent grant and loaded with its ancestors at runtime. Throttle is per route and IP, not per session | `6953a9a`, `82eac50`, `1af4632`, `a430220`, `1a3b3bb`, `a748d73`, `efc8400`, `707dc2b`, `b11bb53`, `ede6c64`, `4d02ee0`, `c2d2863` |
| T-2.2 Template and grant administration UI | Done | Workspace `/hr/access`; admin organization Access tab and `/access`; `createOrgAdminApi`, `SAMPLE_GRANTS`; `effectiveActions` now filled by the API; route guards wait for the session | `53a036c`, `94cc6d0`, `f0a4da7`, `5b0b0bf`, `65685f8`, `abbbdfe`, `72f7745`, `f72d89e`, `6eac71d` |
| T-2.4 and T-2.3 Confidential domain and its RLS | Done, placeholder tables | `conversations`, `conversation_messages`, `intake_records` under forced RLS (sixteen tenant tables); read routes under `/professional/*`; `expert` template gained `conversation.read.assigned`. No write routes; a `cases(id, org_id)` table is a blocker before the first one. `professional_notes` deferred | `3c97d23`, `2680dd4`, `7a71da7` |
| T-2.5 Emergency access | Done | Request, approve (second person, four-hour cap), deny, revoke, record reads, `emergency.sweep-expired` every 15 minutes, metric filter on the approval log line. Approver policy is the default below until the owner decides | `c3e20bb`, `ac454ed`, `fb00396`, `807cd66` |
| T-2.7 Role backfill and legacy removal | Done for the role columns | `db:backfill-grants`; migration `0005` drops `users.platform_role` and `memberships.role` behind a guard; seed defect fixed. `memberships.team_id`, `legacy_teams`, the community tables and the contracts' legacy role types stay for the community retirement and sample mode | `57bfd4f`, `853874a`, `0c04832`, `f3f4bc1` |
| T-2.10 Nightly jobs | Partly done | `sessions.reconcile-ttl` and `emergency.sweep-expired` added; Redis in the health check. Weekly Cognito export (T-2.12), retention sweeper, audit export and SSO certificate check deferred | `68545ae`, `f12e5ea` |
| Review gaps from `implementation.md` section 21 | Done | Email code retypable three times per challenge, lock checked on verify, code emails in the screen's language | `bfce0f6`, `df83b8c` |
| Browser journey | Done | `pnpm e2e:auth` runs six tests, including `hr-access.spec.ts` | `be65cf3` |
| T-2.8 Security baseline, SCPs, production account | Deferred | Waits for staging | |
| T-2.9, T-2.11 File delivery and export authorization | Deferred | No files or exports exist to authorize | |
| T-2.12 Weekly Cognito user export | Deferred | Needs the S3 archive bucket (staging) | |
| Compliance track (T-C.x) | Owner decision | Unchanged; must land before the first real employee signs in | |
| Phase 3 SSO | Not started | Separate plan | |

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

| Question | Why it blocks | Default if undecided |
| --- | --- | --- |
| Does webinar delivery need a `presenter` template (GAP-H02)? | Affects the template table and the golden cases in T-2.1 | `content_publisher` keeps replay review; presenters use `expert` |
| Retention periods per domain (L-02, L-03) | The retention sweeper cannot be written without them | Current defaults in `audit-writer.ts` (1 to 10 years) stay |
| Who may approve emergency access, and is a second approver required? | T-2.5 request and approval flow | `platform_owner` approves; one approver |
| Staging deployment date | T-2.8, T-2.9, T-2.11 and the real SES, S3 and WAF behaviour | Local development continues; use `cdk synth -c platform=true` to keep the stacks reviewed |
| Should `employer_owner` or `hr_admin` hold `access.grant` and `access.revoke`? (raised 2026-10-24) | No organization template holds them, so inside an organization only staff (`platform_owner`, through `/ops/orgs/:orgId/grants`) assign and revoke; owners preview and delegate | Staff administer organization grants |
| Step-up method for the `emergency` class (raised 2026-10-24) | The strategy asks for an authenticator; Cognito cannot issue one without a password first | Email code for every class |
| A `cases(id, org_id)` table before conversation writes (raised 2026-10-24) | `case_id` has no organization binding; blocks any route that creates conversations or intakes | No write routes |

## 5. Definition of done for phase 2

Pilot exit criterion 4 (no employer or generic admin view reveals private content) demonstrated with tests; grants administered from the admin and workspace apps without database access; step-up enforced for every action in `STEP_UP_CLASS_BY_ACTION`; `platform_role`, `OrgRole` and `PlatformRole` removed after backfill; every tenant table, including the confidential domain, under forced RLS; the nightly job list above running in the worker with audit evidence; `pnpm verify` green and `docs/auth/implementation.md` updated.
