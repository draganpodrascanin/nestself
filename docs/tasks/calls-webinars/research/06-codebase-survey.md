# NestSelf Codebase Survey -- Chime Video Consultations & Webinars

## 1. `apps/api` -- Module Layout & Conventions

### Module directories under `src/`

| Directory | Purpose |
|-----------|---------|
| `audit/` | Append-only `AuditWriter`, event catalogue, pino redaction |
| `auth/` | `AuthenticationGuard`, `CurrentPrincipal` decorator, cookie/bearer handling |
| `authz/` | `AuthorizationGuard`, `@Authorize()` decorator, `authorize()` engine, resolvers, delegation, context loader, effective-access |
| `common/` | `ApiHttpException`, `ApiExceptionFilter`, `ZodValidationPipe`, request-fingerprint utils |
| `config/` | `env.ts` (Zod schema), `env.spec.ts` |
| `db/` | `DbService` (drizzle + org scope), `migrate.ts`, `schema/`, `repositories/`, `seed/` |
| `grants/` | Grant CRUD, delegation, approval authorities, rules engine |
| `health/` | Terminus health checks |
| `identity/` | Cognito + fake IDP, external identities, cognito error map |
| `invitations/` | Invitation CRUD, mailer abstraction + SES impl |
| `jobs/` | `JobSchedulerService` (BullMQ), `MaintenanceJobsService`, `JobAuthorization` |
| `leads/` | Marketing lead capture |
| `members/` | Membership CRUD (org + admin + ops controllers) |
| `org-units/` | Org-unit tree, closure table management |
| `principal/` | `PrincipalLoader` -- resolves full principal from session |
| `programme/` | Programme overview for HR |
| `redis/` | `KeyValueStore` interface, Redis + in-memory impls, health indicator, key catalogue |
| `session/` | Server-side session management, CSRF, session list |
| `users/` | User profile endpoints |
| `worker/` | Separate entrypoint (`main.ts`) for the background worker process |
| `ws/` | Socket.IO gateway, adapter, subscription authorizer, invalidation, connection registry |

### Convention exemplar: `grants` module

- **Controller** (`grants.controller.ts`):
  - `@Controller('orgs/:orgId/grants')` with per-route `@Authorize(ACTIONS['access.grant'], orgResourceFromContext('grant'))`.
  - Request bodies validated by `@Body(new ZodValidationPipe(GrantCreateRequestSchema))`.
  - Writes throttled with `@Throttle({ default: { limit: 10, ttl: 60_000 } })`.
  - `@CurrentPrincipal()` parameter decorator for the acting user.
  - Returns typed response DTOs from `@nestself/contracts`.
- **Service** (`grants.service.ts`):
  - `DbService.withOrgScope(orgId, tx => ...)` for tenant-scoped DB access.
  - Injects repositories, `AuditWriter`, `PrincipalLoader`, `ContextLoader`.
  - Every mutation calls `this.audit.record(...)` with a `grant.*` action.
  - Principal invalidation after writes (via `PrincipalLoader`).
- **Repository** (`db/repositories/authorization.repository.ts`):
  - Pure data-access layer with Drizzle queries.
- **Module** (`grants.module.ts`): registers controller, service; imports `DbModule`, `AuditModule`, etc.
- **Rules** (`grant-rules.ts`): pure functions for validation, boundary checking, delegation depth.
- **Mapper** (`grant-mapper.ts`): transforms DB rows to contract response types.

### Drizzle schema

- **One file per domain** in `apps/api/src/db/schema/`: `identity.ts`, `organization.ts`, `authorization.ts`, `invitations.ts`, `audit.ts`, `content.ts`, `enums.ts`, `relations.ts`, `_shared.ts`.
- **Re-exported** from `schema/index.ts` (which `drizzle.config.ts` points at).
- **Naming**: Drizzle `casing: 'snake_case'` -- TS props are camelCase, DB columns are snake_case.
- **RLS**: tenant-scoped tables call `.enableRLS()` and define `pgPolicy(...)` using `tenantPredicate(t.orgId)` from `_shared.ts`. Tables reaching their org through a join use `tenantPredicateVia(existsBody)`.
- **FORCE ROW LEVEL SECURITY**: appended manually in custom migration SQL (see tail of `0002_rls_legacy_content_closure.sql`). After `drizzle-kit generate` produces the migration, a hand-edited step adds `ALTER TABLE ... FORCE ROW LEVEL SECURITY;` for every RLS table.
- **Primary keys**: `idColumn()` = `text().primaryKey().default(sql'gen_random_uuid()::text')`.
- **Timestamps**: `ts()` = `timestamptz(3)`, `createdAt()` with `defaultNow()`, `updatedAt()` with `$onUpdate`.

#### Migration workflow

1. `apps/api/drizzle/` holds numbered SQL migrations (`0000_init.sql`, `0001_...`, `0002_...`) plus a `meta/` snapshot directory.
2. `drizzle.config.ts`: dialect `postgresql`, schema `./src/db/schema/index.ts`, out `./drizzle`, casing `snake_case`.
3. Generate: `pnpm --filter @nestself/api db:generate` diffs schema against snapshot.
4. Custom migration: `pnpm --filter @nestself/api db:generate -- --custom --name=<name>`.
5. Apply: `src/db/migrate.ts` (drizzle-orm migrator), never `drizzle-kit push`.
6. After generating, hand-edit to add `FORCE ROW LEVEL SECURITY` for new RLS tables and any role grants.

### Config module (`src/config/env.ts`)

- Single Zod schema `envSchema` validated via `validateEnv()` for NestJS `ConfigModule`.
- Discriminated by `AUTH_MODE: 'stub' | 'cognito'` with cross-field refinements.
- Existing env vars: `DATABASE_URL`, `PORT`, `AUTH_MODE`, `JWT_SECRET`, `REDIS_URL`, `COGNITO_*` (7 vars), `SESSION_ENCRYPTION_KEY[_PREVIOUS]`, `SES_FROM_EMAIL`, `JOBS_TIMEZONE`, cookie names, URL vars (`MARKETING_URL`, `WORKSPACE_URL`, `ADMIN_URL`, `API_PUBLIC_URL`), `TRUST_PROXY_HOPS`, `FAKE_IDP_FIXED_OTP`.
- **No video/Chime/media vars exist yet.** `VIDEO_PROVIDER`, `CHIME_REGION`, `MEDIA_BUCKET` etc. would be added to `envSchema` following the existing pattern (optionalString or optionalUrl with discriminated refinements).

### `KeyValueStore` (`src/redis/`)

- Abstract interface in `key-value-store.ts` with token `KEY_VALUE_STORE`.
- Methods: `get`, `set` (with TTL + NX), `del`, `getDel`, `expire`, `ttl`, `incr`, `sAdd`, `sRem`, `sMembers`, `scan`, `publish`, `subscribe`, `ping`, `close`.
- Implementations: `RedisKeyValueStore` (ioredis), `MemoryKeyValueStore` (tests/stub).
- Key naming conventions in `redis-keys.ts` (e.g. `session:{id}`, `principal:{userId}`, `mobile-family:{jti}`).

### Socket.IO gateway (`src/ws/`)

- `EventsGateway` at path `/api/ws`, marked `@Public()` (HTTP guards bypassed).
- Handshake auth in `NestSelfIoAdapter` (`nestself-io.adapter.ts`).
- Generic `subscribe` / `unsubscribe` handlers with `SubscriptionAuthorizer.authorizeSubscription(principal, action, resource)`.
- Room names are opaque strings; a feature publishes via `server.to(room).emit(eventName, payload)`.
- `WsInvalidationService` pushes principal invalidation events to connected sockets.
- `WsConnectionRegistry` tracks live connections per user.
- Messages validated with Zod schemas in `ws-messages.ts`.

### Background jobs (`src/jobs/`)

- `JobSchedulerService`: BullMQ `Queue` + `Worker` on `nestself-maintenance` queue, ioredis connection (separate from node-redis KVS).
- Schedules are cron strings in `MAINTENANCE_SCHEDULES`, timezone from `JOBS_TIMEZONE` (default `Europe/Belgrade`).
- `MaintenanceJobsService`: three jobs: `audit.ensure-partitions`, `grants.reconcile`, `mobile.prune-stale-families`. Each is an idempotent unit returning a typed `MaintenanceReport`.
- `JobAuthorization`: wraps any BullMQ handler with principal reload, context rebuild, `authorize()` check. Skipped (not failed) on denial. Payload must carry `principalId`, `context`, `action`, `resource`, `data` (no tokens -- AUTHZ-R-54).
- **To add a job**: add to `MAINTENANCE_JOB_NAMES`, add a cron in `MAINTENANCE_SCHEDULES`, implement the `run()` branch in `MaintenanceJobsService`, add a case in the worker.

### Mailer

- Abstraction: `InvitationMailer` abstract class in `invitations/invitation-mailer.ts`.
- Default: `LoggingInvitationMailer` (logs link in dev, redacts token in prod).
- SES: `SesInvitationMailer` in `ses-invitation-mailer.ts` -- `SESClient` from `@aws-sdk/client-ses`, `SendEmailCommand` with inline HTML + plain-text.
- Selected when `SES_FROM_EMAIL` is set.
- Templates are inline strings (English only; TODO: locale per invitee).
- **No generic mailer module exists.** A consultation/webinar mailer would follow the same abstract + SES pattern, adding localised templates.

### Audit writer

- `AuditWriter.record(input)` -- never throws in production (`strictMode` for tests).
- Event naming: `domain.verb[.qualifier]`, e.g. `auth.sign_in.succeeded`, `grant.created`, `membership.ended`.
- `details` keys: `FORBIDDEN_KEYS` set excludes sensitive fields (password, token, email, body, notes, etc.). Strings truncated to 500 chars.
- Categories: `SECURITY`, `AUTHORIZATION`, `FINANCIAL`, `CONTENT_ACCESS`, `ADMIN` -- each mapped to a retention tier (1--10 years).
- New consultation/webinar events would follow the pattern: `consultation.created`, `consultation.joined`, `consultation.ended`, `webinar.created`, `webinar.started`, etc.

### Throttler

- `@nestjs/throttler` v6.7.1. Write routes use `@Throttle({ default: { limit: 10, ttl: 60_000 } })`.
- `ThrottlerException` caught by `ApiExceptionFilter` and mapped to `429 rate_limited`.

### E2E test setup (`apps/api/test/`)

- `test/db/test-database.ts`: `resetTestDatabase(baseUrl, suffix)` creates a per-suite database (`<base>_<suffix>`), drops + recreates + migrates.
- `connectAsAppRole()` creates a non-superuser `nestself_api_test` role with RLS.
- Tests use `vitest` + `supertest` + `@nestjs/testing`.
- Pattern: `process.env.DATABASE_URL = testDb.url`, `AUTH_MODE = 'stub'`, compile `AppModule`, get `FakeIdentityProvider` for test auth.
- `TEST_DATABASE_URL` env var required; suites `describe.skipIf(!TEST_DB_URL)`.
- **Default-deny route test**: every controller route must carry `@Public()`, `@Authenticated()`, or `@Authorize()` -- CI test asserts this.
- New controllers must register in `AppModule` and the default-deny test.

### AWS SDK usage

- `apps/api/package.json` depends on:
  - `@aws-sdk/client-cognito-identity-provider` (catalog: 3.1155.0)
  - `@aws-sdk/client-ses` (catalog: 3.1155.0)
- Injected via constructors (e.g. `SESClient` in `SesInvitationMailer`, `CognitoIdentityProviderClient` in `CognitoIdentityProvider`).
- **`aws-sdk-client-mock` is NOT in the catalog or any package.json.** SES tests use a manual mock (`options.client?: Pick<SESClient, 'send'>`).
- For Chime, the same pattern would apply: inject the client, accept a mock in tests.

---

## 2. Existing Consultation / Appointment / Webinar / Event Code

### Actions in `packages/contracts/src/actions.ts`

Consultation and scheduling related:
- `appointment.propose`, `appointment.cancel`, `appointment.reschedule`
- `bookings.coordinate`, `availability.manage`
- `service.request`, `service.book`
- `case.accept`, `case.decline`
- `delivery.record`, `consultation.join`
- `events.request`, `activity.request`, `event.invite`, `event.register`, `event.present`
- `logistics.view`, `delivery.confirm`

### Permission templates that would own video consultations

- **`expert`**: has `availability.manage`, `case.accept`, `case.decline`, `appointment.propose`, `consultation.join`, `delivery.record` -- this is the expert delivering a consultation.
- **`employee`**: has `service.request`, `service.book`, `appointment.cancel`, `appointment.reschedule`, `event.register`, `consultation.join` -- the employee joining.
- **`service_coordinator`**: has `request.route`, `request.assign`, `bookings.coordinate`, `appointment.propose`.
- **`team_manager`**: has `events.request`, `activity.request`, `event.invite` -- webinar requesting.
- **`event_supplier`**: has `logistics.view`, `delivery.confirm`.

### What exists and what does not

- **Workspace route**: `apps/workspace/src/routes/_authenticated/appointments.tsx` exists as a **stub** (empty `StatusBlock`, no data fetching).
- **No API module**: no `consultations/`, `appointments/`, `scheduling/`, `availability/`, `webinars/` directories exist under `apps/api/src/`.
- **No Drizzle tables**: no `appointments`, `consultations`, `availability_slots`, `webinar_sessions` tables.
- **No contracts**: no consultation/appointment Zod schemas in `packages/contracts/src/`.
- **Sample data**: `SAMPLE_BOOKING` fixture in `packages/sample-data/src/fixtures/booking.ts` has appointment shape (advisor, date, slots, timezone, price breakdown). `SAMPLE_EVENT_REQUEST` has event request shape.
- **DB schema**: `eventRequests` table exists in `content.ts` (status enum: `REQUESTED`, `OFFERS_READY`, `SELECTED`, `CLOSED`).
- **Leads**: `WebinarRegistrationSchema` in `packages/contracts/src/leads.ts` captures webinar sign-ups (slug, name, email, company).
- **Mobile**: `BookingDemo.tsx` component in `apps/mobile/src/components/`.
- **Content items**: `contentItems` table has `kind: 'VIDEO'` in the enum.

---

## 3. `packages/contracts`

### File layout

```
src/
  actions.ts        -- action catalogue (ACTIONS, Action type)
  auth.ts           -- auth request/response schemas, AUTH_ERROR_CODES
  authorization.ts  -- grant condition, scope, decision, delegation types
  access-model.ts   -- deprecated access model
  health.ts         -- HealthResponseSchema
  index.ts          -- barrel file re-exporting everything
  leads.ts          -- lead capture schemas (demo, contact, webinar)
  locale.ts         -- Locale, locales, defaultLocale
  ops-admin.ts      -- operations admin schemas
  org-admin.ts      -- org admin schemas (members, invitations, org-units, grants)
  principal.ts      -- can() helper
  roles.ts          -- deprecated role enums
  support.ts        -- SupportArea enum
  templates.ts      -- PERMISSION_TEMPLATES, TemplateKey
```

### Conventions

- Every schema is a Zod schema with a companion TS type (`z.infer<typeof Schema>`).
- Schemas and types are named `<Entity><Verb>RequestSchema` / `<Entity><Verb>ResponseSchema`.
- All exported from `index.ts`.
- Tests colocated: `actions.test.ts`, `auth.test.ts`, `authorization.test.ts`, `templates.test.ts`, etc.

### Error codes

- `AUTH_ERROR_CODES` array in `auth.ts`: `unauthenticated`, `invalid_code`, `invalid_credentials`, `expired_code`, `too_many_attempts`, `step_up_required`, `forbidden`, `not_found`, `validation`, `rate_limited`, `csrf_rejected`, `session_expired`, `conflict`, `locked`, `subject_not_member`, `template_inactive`, `missing_conditions`, etc.
- Type: `AuthErrorCode = (typeof AUTH_ERROR_CODES)[number]`.
- API maps them via `ApiHttpException({ status, code, message })`, caught by `ApiExceptionFilter` which produces the 5.9 envelope: `{ status, code, message, requestId, details }`.
- Generic HTTP status codes mapped in `STATUS_CODE_MAP` (400 -> `validation`, 401 -> `unauthenticated`, 403 -> `forbidden`, 404 -> `not_found`, 429 -> `rate_limited`).
- New consultation/Chime error codes (e.g. `meeting_expired`, `meeting_not_found`, `chime_unavailable`) would be added to `AUTH_ERROR_CODES`.

---

## 4. `packages/api-client`

### Layout

```
src/
  client.ts          -- createApiClient({ baseUrl, mode, getToken, fetchImpl })
  client.test.ts     -- unit tests
  auth.ts            -- AuthApi class (sign-in flows, me, signOut, etc.)
  errors.ts          -- ApiError class
  index.ts           -- barrel
  queries/
    auth.ts          -- meQueryOptions (TanStack Query)
    health.ts        -- healthQueryOptions
```

### How a module is added

- Create `src/<module>.ts` exporting a class that takes `ApiClient` in its constructor and exposes typed methods calling `client.request(path, { method, schema, body })`.
- Add `queries/<module>.ts` with TanStack Query `queryOptions` / `mutationOptions`.
- Export from `index.ts`.
- Example: `AuthApi.me()` calls `GET /api/auth/me` with `MeResponseSchema`.

### Cookie vs bearer mode

- `createApiClient({ mode: 'cookie' })` sets `credentials: 'include'`, reads CSRF token from cookies, adds `X-CSRF-Token` header on mutations.
- `createApiClient({ mode: 'bearer', getToken })` adds `Authorization: Bearer <token>`.
- Default: `'bearer'` if `getToken` provided, `'cookie'` otherwise.
- Web apps use cookie mode; mobile uses bearer mode.

### Sample-mode switching

- Apps check `isSampleDataMode` from `data-source.ts`. In sample mode, the app does not call the API; it renders sample data directly from `@nestself/sample-data`.

---

## 5. `apps/workspace` and `apps/admin`

### Route directories

**Workspace** (`apps/workspace/src/routes/`):
- `__root.tsx` -- root with providers, theme, toast, sample banner
- `_authenticated.tsx` -- auth guard layout
- `_authenticated/_hr.tsx` -- HR gate: `can(principal, 'program.overview', ...)`
- `_authenticated/_hr/hr/index.tsx`, `eligibility.tsx`, `events.tsx`, `reports.tsx`
- `_authenticated/_manager.tsx` -- manager gate
- `_authenticated/_manager/manage/index.tsx`, `events.new.tsx`, `polls.new.tsx`
- `_authenticated/appointments.tsx` -- **stub page**
- `_authenticated/channels/`, `messages/`, `polls/`, `settings.tsx`, `support/`
- `_public/sign-in.tsx`, `invite.$token.tsx`, `reset-password.tsx`

**Admin** (`apps/admin/src/routes/`):
- Same structure: `__root.tsx`, `_authenticated/`, `_public/`, `-admin.test.tsx`

### Gating pattern

- File-based TanStack Router. Layout route (e.g. `_hr.tsx`) uses `beforeLoad` to check `can(principal, action)` from router context, redirecting on failure.

### Feature folder layout

- `src/auth/` -- auth hooks, screens subfolder (`screens/`)
- `src/components/` -- app-specific components (e.g. `RoleSwitcher`)
- `src/data-source.ts`, `src/api.ts`, `src/i18n.ts`, `src/session.tsx`

### Sample mode

- `VITE_DATA_SOURCE=sample` (default in dev) triggers `isSampleDataMode = true`.
- `SampleDataBanner` from `@nestself/ui` shown via `__root.tsx`.
- `SampleAuthProvider` vs `AuthProvider` selected based on mode.

### Providers wrapper (from `__root.tsx`)

- `ThemeProvider`, `ThemeStudio`, `ToastProvider`, `AnnouncerProvider`, `SkipLink`, `SampleDataBanner`, `I18nextProvider`.
- Auth: `SampleAuthProvider` or `AuthProvider`.
- `RoleSwitcher` for sample mode.

### Toasts and dialogs

- Import from `@nestself/ui`: `Dialog`, `AlertDialog`, `Sheet`, `Alert`, `ToastProvider` (+ `useToast` presumably), `FormErrorSummary`, `StatusBlock`.

### i18n

- `packages/i18n/locales/{en,sr-Latn,sr-Cyrl,hu}/` with namespace files: `common.json`, `workspace.json`, `admin.json`, `auth.json`, `marketing.json`, `mobile.json`.
- Add a namespace: create `<namespace>.json` in each of the 4 locale dirs (3 actually: `en`, `sr-Latn`, `hu`; `sr-Cyrl` is auto-generated).
- Run `pnpm --filter @nestself/i18n build:cyrillic` after editing Latin catalogs.

### Screens to copy

- `appointments.tsx` (stub with `Heading` + `StatusBlock`) for empty list pages.
- `channels/$channelId.tsx`, `support/$area.tsx` for detail pages.
- `_manager/manage/events.new.tsx` for forms.

---

## 6. `apps/mobile`

- **Expo SDK 58** (`expo: 58.0.16`), React Native 0.88.
- **Router**: Expo Router 58 (`src/app/` directory, `_layout.tsx`, `settings.tsx`, `+not-found.tsx`).
- **Auth**: `src/auth/` with `cognito-public-client.ts`, `sso.ts` (PKCE flow), `token-store.ts` (expo-secure-store), `auth-provider.tsx`, `use-auth.ts`.
- **Config**: `app.config.ts` (dynamic), `app.json`. Plugins: `expo-router`, `expo-font`, `expo-localization`, `expo-splash-screen`. New arch enabled. Typed routes.
- **No `expo-dev-client`** in plugins. No EAS config visible.
- **No config plugins for Chime** yet. `amazon-chime-sdk-js` is browser-only; mobile would need `amazon-chime-sdk-component-library-react-native` or the iOS/Android Chime SDKs as config plugins.
- **`packages/ui-native` components**: Alert, Avatar, Badge, Button, Card, CategoryIcon, CostBreakdown, Divider, Field, Icon, ListRow, Screen, StatusBlock, Text.
- **`nativeMotion`**: exported from `packages/tokens/src/native.ts` with duration and easing values for React Native `Animated` / Reanimated.

---

## 7. `packages/ui`

### Exported components (from `src/index.ts`)

Re-exports from 8 category barrels:

- **foundation**: Icon, SkipLink, ThemeProvider, ThemeStudio, Typography (`Heading`, `Text`, etc.), LiveRegion, VisuallyHidden
- **actions**: Button, IconButton, TextLink
- **fields**: Checkbox, Chip, Field, Fieldset, FormErrorSummary, OtpInput, PasswordInput, RadioGroup, Switch
- **feedback**: Alert, Badge, ProgressBar, Skeleton, StatusBlock, Toast (ToastProvider)
- **navigation**: Accordion, AppShell, Breadcrumbs, Menu, NavItem, SiteHeader, Tabs
- **dialogs**: Dialog, AlertDialog, Sheet
- **tables**: DataList, MetricCard, ProtectedValue, Table
- **patterns**: Avatar, BookingDemo, Card, ChatComposer, ChatThread, ConfirmLabel, CostBreakdown, CoverageNotice, EventRequestSummary, PhotoFigure, PrivacyAtPointOfUse, SampleDataBanner, TimeSlotGrid
- **motion**: `m`, `AnimatePresence`, `MotionFeatures`, `MotionLayoutFeatures`, `useMotionPreset`
- **utility**: `cn` (clsx + tailwind-merge)

### Motion presets

`packages/ui/src/motion/presets.ts` defines `MotionPresetName`:
- `backdrop`, `dialog`, `popover`, `sheet-bottom`, `sheet-left`, `sheet-right`, `toast`, `disclosure`
- Durations from tokens: fast 120ms, standard 200ms, slow 280ms
- Easing: `cubic-bezier(.2, 0, 0, 1)`
- Reduced-motion variants: opacity fade at most 50ms, no translate/scale

### Key components for consultations

- `FormErrorSummary`: field-level + summary error display for forms.
- `Alert`: inline feedback component.
- `StatusBlock`: empty/error/permission states.
- `TimeSlotGrid`: already exists for booking slot selection.
- `BookingDemo`: booking demonstration pattern.
- `CostBreakdown`, `CoverageNotice`: payment info display.

---

## 8. `infra/cdk`

### Stack files under `lib/` and `bin/`

```
bin/
  app.ts              -- CDK app entry, instantiates all stacks per stage
lib/
  auth-stack.ts       -- Cognito user pool, clients, hosted UI, custom triggers
  ci-stack.ts         -- CI/CD pipeline (CodePipeline or similar)
  compute-stack.ts    -- ECS cluster, Fargate services (api, worker, marketing), ALB, ECR
  config.ts           -- StageConfig type, getStageConfig()
  data-stack.ts       -- RDS PostgreSQL 17, ElastiCache Valkey
  edge-stack.ts       -- CloudFront distribution
  network-stack.ts    -- VPC, subnets, NAT
  observability-stack.ts -- CloudWatch, alarms
  security-baseline-stack.ts -- KMS keys, IAM baselines
  constructs/
    ecs-task-roles.ts -- ECS task execution and task IAM roles
  triggers/           -- Lambda triggers (custom message, pre-sign-up, etc.)
```

### Compute stack wiring

- `EcsTaskRoles` construct provides task execution role + task role.
- Fargate services: api (port 4000), worker (no inbound), marketing (port 3000).
- ALB listener routes traffic to api and marketing target groups.
- Secrets from `secretsmanager.Secret`.
- `platformKey: kms.IKey` from security-baseline stack encrypts ECR, RDS, etc.

### Existing infrastructure

- **KMS**: `platformKey` in security-baseline stack, used across all stacks.
- **S3**: No dedicated media bucket visible. Would need to be added (likely in data-stack or a new media-stack) for Chime recording storage.
- **EventBridge, SQS**: not visible in current stacks. Would be new constructs for Chime event notifications.
- **ElastiCache**: Valkey instance in data-stack.

### CDK tests (`infra/cdk/test/`)

- `nag.test.ts`: synthesizes every stack with `AwsSolutionsChecks` plugin, asserts no violations.
- Per-stack tests: `auth-stack.test.ts`, `compute-stack.test.ts`, `ci-stack.test.ts`, `edge-stack.test.ts`, `observability-stack.test.ts`.
- Pattern: create a `cdk.App`, instantiate the stack with test config, `app.synth()`, assert assembly is defined.

### `env-from-outputs.mjs`

- `infra/cdk/scripts/env-from-outputs.mjs <stage> [--mobile]`
- Reads CloudFormation outputs + SecretsManager values, prints `.env` lines to stdout.
- Must be piped/appended manually (`>> apps/api/.env`).

---

## 9. `packages/sample-data`

### Fixture naming and shape

- Files in `src/fixtures/`: `booking.ts`, `channels.ts`, `content.ts`, `credentials.ts`, `events.ts`, `experts.ts`, `hr.ts`, `identities.ts`, `org-units.ts`, `org.ts`, `people.ts`, `polls.ts`, `principals.ts`, `testimonials.ts`.
- Exports follow `SAMPLE_<NAME>` convention (e.g. `SAMPLE_BOOKING`, `SAMPLE_EVENT_REQUEST`, `SAMPLE_ORG`, `SAMPLE_PEOPLE`).
- Fixtures are plain objects with `sample: true` marker.
- `SAMPLE_BOOKING` has: `advisorName`, `format: 'online'`, `appointmentAt` (ISO), `slots` array, `timeZone: 'Europe/Belgrade'`, `price`, `employerCovers`, `youPay`, `currency`.

### How fixtures feed both API seed and apps

- `src/mode.ts` exports `isSampleMode()` (checks `VITE_DATA_SOURCE` / `EXPO_PUBLIC_DATA_SOURCE`).
- `assertNotProduction()` prevents seed in production.
- API seed (`apps/api/src/db/seed/seed-lib.ts`) imports and inserts fixtures.
- Apps import directly from `@nestself/sample-data` when in sample mode.

---

## 10. `e2e/`

### Structure

```
e2e/
  .auth-state/            -- stored auth state (TOTP secrets)
  __screenshots__/        -- golden screenshots by viewport
  helpers.ts              -- shared test utilities
  pages.ts                -- page registry (PageEntry[])
  pages/                  -- per-app page lists (admin.ts, marketing.ts, workspace.ts)
  a11y.spec.ts            -- axe-core accessibility checks
  reflow.spec.ts          -- 400% zoom reflow tests
  screenshots.spec.ts     -- visual regression (golden screenshots)
  motion/                 -- animation lifecycle tests
    disclosures.motion.ts
    popouts.motion.ts
    reduced.motion.ts
    motion-helpers.ts
```

### Playwright configs

- `playwright.config.ts` -- main visual + a11y tests
- `playwright.auth.config.ts` -- auth flow tests
- `playwright.motion.config.ts` -- motion tests against Storybook

### Page registry (`pages.ts`)

- `PageEntry`: `{ name, url, theme?, locale?, prepare? }`
- Each app contributes to the registry: `marketingPages`, `workspacePages`, `adminPages`.
- `appPrepareActions`: post-navigation actions (e.g. click to a step).

### Motion suite

- `pnpm e2e:motion` runs Playwright against Storybook.
- Tests record frames, assert token durations and easing, compositor-only properties, in-between frames, no flicker, reduced-motion fade.

---

## 11. `pnpm-workspace.yaml` catalog -- AWS SDK and missing packages

### Currently pinned AWS SDK packages

- `@aws-sdk/client-cognito-identity-provider`: 3.1155.0
- `@aws-sdk/client-ses`: 3.1155.0

### To add to the catalog (no install during parallel work)

- `@aws-sdk/client-chime-sdk-meetings` -- meeting lifecycle (CreateMeeting, CreateAttendee, DeleteMeeting)
- `@aws-sdk/client-chime-sdk-media-pipelines` -- recording pipelines (CreateMediaCapturePipeline)
- `amazon-chime-sdk-js` -- browser client (audio/video/screen share)
- Optionally: `@aws-sdk/client-s3` for presigned URLs to recording storage
- Optionally: `@aws-sdk/client-eventbridge` if Chime events are routed via EventBridge
- For mobile: the React Native Chime SDK would be a separate consideration (config plugin, native module)

### Other notable catalog entries

- `bullmq: 6.4.0` (job queues)
- `ioredis: 6.0.0` (BullMQ connections)
- `socket.io: 4.8.4` + `@nestjs/websockets: 12.2.0` + `@nestjs/platform-socket.io: 12.2.0`
- `aws-cdk-lib: 2.274.0`, `cdk-nag: 3.0.2`
- No `aws-sdk-client-mock` in catalog (tests use manual mocks).

---

## 12. Notifications, Calendar, Timezone, Feature Flags

### Email templates

- Only the invitation mailer exists (`SesInvitationMailer`).
- Templates are inline strings, English only. No template engine (Handlebars, MJML, etc.).
- A consultation/webinar notification mailer would follow the same pattern: abstract class + SES implementation + inline or file-based templates per locale.

### Calendar / ICS

- **No ICS generation code exists.** No `ical`, `ics`, or calendar library in the catalog.
- Would need a package like `ics` (npm) or hand-rolled ICS generation for appointment confirmations.

### Timezone handling

- `JOBS_TIMEZONE` env var (default `Europe/Belgrade`) for cron schedules.
- `PrincipalLoader` resolves `org.timezone` (from the organization record) into the principal.
- `SAMPLE_BOOKING.timeZone: 'Europe/Belgrade'`.
- No date-formatting utility library (no `date-fns`, `luxon`, or `dayjs` in catalog). Timezone-aware formatting would need a library or `Intl.DateTimeFormat`.

### Feature flags

- **No feature-flag system exists.** No GrowthBook, LaunchDarkly, Unleash, or custom flags.
- A feature flag for Chime rollout would need to be introduced (env-var-based toggle, or a proper feature flag service).

### Notification patterns

- `WsInvalidationService` pushes principal cache invalidation over WebSocket.
- The same Socket.IO infrastructure (`server.to(room).emit(...)`) would carry real-time consultation notifications (join, leave, recording started, etc.).
- BullMQ can schedule reminder emails before appointments.
