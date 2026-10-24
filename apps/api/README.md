# @nestself/api

NestJS 12 API server with Drizzle ORM, PostgreSQL row-level security and grant-based authorization.

## Run instructions

```bash
# Start the database (Postgres 17 + Redis 7)
pnpm db:up

# Run migrations
pnpm --filter @nestself/api db:migrate

# Seed the database with sample data
pnpm --filter @nestself/api db:seed

# Start in development mode
pnpm --filter @nestself/api dev

# Start the worker (maintenance jobs; needs REDIS_URL and the same configuration as the API)
pnpm --filter @nestself/api worker:dev

# Run one maintenance job immediately and print its report
pnpm --filter @nestself/api job:run grants.reconcile

# Convert legacy role columns into grants (only on a database at migration 0004)
pnpm --filter @nestself/api db:backfill-grants

# Build for production
pnpm --filter @nestself/api build

# Run tests (the database suites need TEST_DATABASE_URL, otherwise they skip)
TEST_DATABASE_URL=postgresql://nestself@localhost:54329/nestself_test pnpm --filter @nestself/api test
```

The server listens on port 4000 by default. Copy `.env.example` to `.env` and adjust values.

### Maintenance jobs

`job:run <name>` and the worker share these jobs (`src/jobs/maintenance-jobs.service.ts`, schedules in `job-scheduler.service.ts`, timezone `JOBS_TIMEZONE`):

| Job | Schedule | Purpose |
|---|---|---|
| `audit.ensure-partitions` | 01:00 | Keeps three months of audit partitions ahead |
| `grants.reconcile` | 02:15 | Closes expired grants, orphaned delegations and grants of ended memberships; invalidates subjects and delegatees |
| `mobile.prune-stale-families` | 02:30 | Denylists mobile token families unseen for 30 days |
| `sessions.reconcile-ttl` | 02:45 | Destroys session records past their absolute expiry and revokes their refresh tokens |
| `emergency.sweep-expired` | every 15 minutes | Closes approved emergency access whose window has passed |

The worker (`src/worker/main.ts`) boots the same `AppModule` as the API, so it needs the API's configuration (identity provider, session encryption key, database) plus `REDIS_URL`; without Redis it exits with an error.

`worker:dev` and `job:run` currently fail at boot: they run the sources through `tsx`, which emits no decorator metadata, so Nest cannot resolve constructor dependencies. The compiled worker works (`pnpm --filter @nestself/api build && pnpm --filter @nestself/api worker`). See `docs/auth/implementation.md` section 14.

### Tests

Unit tests sit next to the code. The integration suites in `test/` boot the application against a disposable database per suite (`TEST_DATABASE_URL`): `auth`, `ops-clients`, `grants`, `ops-grants`, `professional`, `emergency`, `members`, `invitations`, `org-admin`, `ws`, `health`, `jobs` (`*.e2e.spec.ts`), and `db/schema.spec.ts`, `db/authorization-repository.spec.ts`, `db/backfill-grants.spec.ts`. `src/authz/default-deny.test.ts` fails on any undecorated route; `src/authz/golden-table.test.ts` pins the decision engine. `docs/auth/implementation.md` section 19 says what each suite covers.

### Schema changes

When the Drizzle schema files under `src/db/schema/` change:

```bash
# Generate a migration from the schema diff
pnpm --filter @nestself/api db:generate

# Create a custom (hand-written) migration
pnpm --filter @nestself/api db:generate -- --custom --name=<name>
```

Migrations are SQL files in `drizzle/`. Apply them with `db:migrate` (never with `drizzle-kit push`).

## Database layer

The data access layer uses Drizzle ORM (drizzle-orm 0.45.4, drizzle-kit 0.31.11) with PostgreSQL and row-level security for tenant isolation.

### Schema

Table definitions live in `src/db/schema/` as `pgTable` calls with snake_case column mapping. Enum types use `pgEnum`. The entry point is `src/db/schema/index.ts`; the Drizzle config is `drizzle.config.ts`.

### DbService and repositories

`DbService` (`src/db/db.service.ts`) wraps a `pg` Pool and exposes the typed Drizzle database handle. It provides:

- `db`: the Drizzle database instance for queries.
- `withOrgScope(orgId, fn)`: runs a transaction with `set_config('app.current_org_id', orgId, true)` so that row-level security policies scope reads and writes to one organization.
- `withTransaction(fn)`: a plain transaction without the setting (system context), for platform rows such as platform grants and emergency access.
- `ping()`: connectivity probe for the health check.

Repositories under `src/db/repositories/` (identity, authorization, approval-authorities, professional, audit, leads, invitations, memberships, org-units) encapsulate table queries. Services depend on repositories; tests mock repository methods or override `DbService`.

### Row-level security

Tenant tables (`org_units`, `memberships`, `grants`, `approval_authorities`, `invitations`, `sso_connections`, `channels`, `event_requests`, `conversations`, `intake_records`) carry RLS policies declared in the schema with `pgPolicy`. Tables that reach their organization through a join (`posts`, `polls`, `poll_options`, `poll_votes`, `org_unit_closure`, `conversation_messages`) use `tenantPredicateVia()` with a correlated `EXISTS` on the joined organization column. The policy predicate for an `org_id` column is:

```
coalesce(current_setting('app.current_org_id', true), '') = '' OR org_id = current_setting('app.current_org_id', true)
```

An unset setting (empty string) means system context: principal loading, seeding and background jobs bypass RLS filtering. The API connects as `nestself_api`, a login role that is a member of the `nestself_app` group role. RLS is enabled and forced (`FORCE ROW LEVEL SECURITY`) so that even the table owner is subject to policies. The `nestself_app` role has no `UPDATE` or `DELETE` on `audit_events`.

Two database roles are involved:

| Role | Purpose |
|------|---------|
| `nestself` (owner) | Runs migrations; has full DDL privileges; superuser in local dev bypasses RLS |
| `nestself_api` (login) | Member of `nestself_app`; the API connects as this role; RLS is enforced |

The integration test (`test/db/schema.spec.ts`) creates a non-superuser login and verifies that cross-tenant reads return no rows and cross-tenant writes are rejected.

### Migrations

Migrations live in `drizzle/` and are tracked in the `drizzle.__drizzle_migrations` table. Six migrations exist:

- `0000_init.sql`: generated by `drizzle-kit generate` from the schema.
- `0001_audit_partitions_rls_roles.sql`: hand-written custom migration containing audit_events monthly range partitions, the `audit_events_ensure_partitions()` function, append-only triggers, `nestself_app` role grants and `FORCE ROW LEVEL SECURITY` on tenant tables.
- `0002_rls_legacy_content_closure.sql`: generated policies for the join-based tenant tables plus hand-written `FORCE ROW LEVEL SECURITY` and the `SECURITY DEFINER` grant that lets the application role call `audit_events_ensure_partitions()`.
- `0003_professional_domain.sql`: the confidential professional domain (`conversations`, `conversation_messages`, `intake_records`) with tenant policies and forced RLS. There is no `cases` table yet; `case_id` is free text until one exists.
- `0004_emergency_access_request.sql`: the emergency access request lifecycle (nullable approver, approval time, requested duration).
- `0005_drop_legacy_roles.sql`: drops `users.platform_role`, `memberships.role` and the `org_role` / `platform_role` enum types (D-36). **Run `db:backfill-grants` before `db:migrate` reaches it** on a database that still holds legacy roles; see below. A guard at the top of the migration raises, naming the first user, when a non-employee legacy role has no matching grant.

### Legacy role backfill

`pnpm --filter @nestself/api db:backfill-grants` turns every `users.platform_role` and every active `memberships.role` into grants from the templates mapped to that role (`templatesForLegacyRoles` in `src/db/seed/seed-lib.ts`; every org member also receives `employee`). Grant ids are `grant_{userId}_{templateKey}`; a user active in a second organization gets `grant_{userId}_{orgId}_{templateKey}` for it. A second run skips what exists and overwrites nothing. A legacy `MANAGER` whose membership has no org unit cannot get a working `team_manager` grant (an `org_unit` scope without a unit never matches), so that grant is scoped to the whole organization instead: the run logs one warning per case naming the user id, and the script lists the grant under `widened` so you can review it and narrow or revoke it. Org grants are granted by the organization's first active HR admin, platform grants by the user themself. It reads the legacy columns with raw SQL, so it only works while they exist, that is before `db:migrate` applies `0005`. Drizzle's migrator has no stop-at option and always applies every pending migration, so the order is: run `db:backfill-grants` first, from whatever migration state the database is in (any state at or after `0001`), then `db:migrate`. If anything is left unbackfilled, the guard at the top of `0005` refuses the drop and names the first user, and the migration stops before it changes anything. A fresh database needs no backfill: `db:seed` creates the same grants from the fixtures.

### Audit partitions

`audit_events` is range-partitioned by `occurred_at` (monthly). The `audit_events_ensure_partitions()` function creates partitions ahead of time; the nightly `audit.ensure-partitions` job (`src/jobs/maintenance-jobs.service.ts`, run by `src/worker/main.ts`) keeps three months ahead. Append-only triggers reject `UPDATE` and `DELETE` on the table.

## Authentication and authorization

The legacy `AuthGuard` and `RolesGuard` no longer exist. See `apps/api/docs/auth-core.md` for the current authentication and authorization layer.

Four global guards are registered via `APP_GUARD` in `app.module.ts`:

1. **AuthenticationGuard**: session cookie or bearer token; attaches `request.principal`.
2. **CsrfGuard**: double-submit CSRF check on session-cookie requests.
3. **AuthorizationGuard**: evaluates `@Authorize(action, resolver)` metadata.
4. **ThrottlerGuard**: rate limiting (default 60 req/min).

Routes use `@Public()`, `@Authenticated()` or `@Authorize(action, resolver)` decorators. A CI test fails on any undecorated route.

Step-up is enforced by `AuthorizationGuard` and by `AuthorizationService.require()` for every action with a step-up class; clients complete it through `POST /auth/step-up/start` and `/verify`.

## What is still missing

- SSO/SAML integration (routes stubbed as `ssoStartUrl: null`; phase 3)
- Remaining nightly jobs: weekly Cognito user export, retention sweeper, audit export to S3
- File delivery and export authorization (T-2.9, T-2.11)
- Write routes for the confidential domain (they need a `cases` table first) and professional notes
- Push notifications
- Payment and booking endpoints

`docs/tasks/auth/phase-2-readiness.md` has the status of every phase 2 task; `docs/auth/implementation.md` section 21 lists the open gaps and owner decisions.
