# Environment variables

All variables are listed in `.env.example` at the repository root; each app has its own example file (`apps/api/.env.example`). Copy the relevant section into the app's own env file before starting it. Validation for the API lives in `apps/api/src/config/env.ts`; the rules below (required in cognito mode, refused in production) are enforced there.

## API (`apps/api/.env`)

### Core

| Variable | Meaning | Default |
| --- | --- | --- |
| `NODE_ENV` | Node environment (`development`, `production`, `test`) | `development` |
| `PORT` | HTTP port the API listens on | `4000` |
| `DATABASE_URL` | PostgreSQL connection string. In Docker and AWS use the `nestself_api` login (a member of `nestself_app`) so row-level security applies; migrations run as the owner | `postgresql://nestself:nestself_dev@localhost:5432/nestself` |
| `DATABASE_POOL_MAX` | Maximum connections in the pg Pool | `10` |
| `TEST_DATABASE_URL` | Integration tests only: a server and base name the suites may drop and recreate databases under (`<name>_<prefix>_schema`, `<name>_<prefix>_auth` ...) | unset (suites skip) |
| `TEST_DATABASE_PREFIX` | Integration tests only: the `<prefix>` in test database names (letters, digits, underscores) | first 8 hex characters of the SHA-1 of the repository root path |
| `E2E_DATABASE_URL` | `pnpm e2e:auth` only: the database the stub API uses; dropped, recreated, migrated and seeded on every run, so it must name a `nestself_e2e_*` or `nestself_test_*` database (others are refused) | `nestself_e2e_<prefix>` on the `TEST_DATABASE_URL` server |
| `TRUST_PROXY_HOPS` | Trusted proxy depth for client IP extraction (set to 1 or more behind a load balancer) | `0` |

### Authentication mode

| Variable | Meaning | Default |
| --- | --- | --- |
| `AUTH_MODE` | `stub` (fake identity provider, in-memory store allowed) or `cognito` (real pool, Redis required). `stub` is refused when `NODE_ENV=production` | `stub` |
| `JWT_SECRET` | Stub mode only: signs the legacy bearer tokens; at least 32 characters. Removed after cutover | `change-me-...` |
| `JWT_EXPIRES_IN` | Stub mode only: legacy token lifetime | `1h` |
| `FAKE_IDP_FIXED_OTP` | Stub mode only: a six-digit code the fake provider always accepts (handy for Playwright) | unset |

### Redis and sessions

| Variable | Meaning | Default |
| --- | --- | --- |
| `REDIS_URL` | Redis or Valkey connection. Required in cognito mode and for the worker process; optional in stub mode (in-memory store when absent) | `redis://localhost:6379` |
| `SESSION_ENCRYPTION_KEY` | 64 hex characters (32 bytes) for AES-256-GCM encryption of Cognito tokens in Redis. Required in cognito mode; derived from `JWT_SECRET` in stub mode. The auth stack generates one in Secrets Manager | unset |
| `SESSION_ENCRYPTION_KEY_PREVIOUS` | Previous key during rotation (dual acceptance) | unset |
| `IP_HASH_SALT` | Key for the HMAC of client IPs in audit and session records; defaults to the session encryption key | unset |
| `SESSION_COOKIE_NAME` | Session cookie name | `__Host-nestself_session` |
| `CSRF_COOKIE_NAME` | CSRF cookie name | `__Host-nestself_csrf` |
| `SESSION_COOKIE_INSECURE_DEV` | `true` drops the `__Host-` prefix and the `Secure` flag so cookies work on plain `http://localhost` | unset |
| `SESSION_LIFETIME_OVERRIDES` | JSON overrides per `population:context`, e.g. `{"employee:personal":{"idleSeconds":600,"absoluteSeconds":3600}}` | unset |

### Cognito (cognito mode)

`node infra/cdk/scripts/env-from-outputs.mjs <stage>` prints these from the deployed auth stack; see `CDK-setup.md`.

| Variable | Meaning |
| --- | --- |
| `COGNITO_REGION` | Pool region (`eu-central-1`) |
| `COGNITO_USER_POOL_ID` | User pool id |
| `COGNITO_WEB_CLIENT_ID` | Confidential web app client used by the BFF |
| `COGNITO_WEB_CLIENT_SECRET` | Its client secret (Secrets Manager `nestself-<stage>/cognito/web-client-secret`) |
| `COGNITO_MOBILE_CLIENT_ID` | Public mobile app client; bearer tokens must carry this client id |
| `COGNITO_DOMAIN` | Hosted sign-in domain (`https://nestself-dev.auth.eu-central-1.amazoncognito.com` in dev) |
| `COGNITO_ISSUER` | Optional; derived from region and pool id when absent |

The API process also needs AWS credentials (task role in ECS, `AWS_PROFILE` or access keys locally) for the Cognito admin calls and, if `SES_FROM_EMAIL` is set, for SES. The IAM actions are listed in `CDK-setup.md`.

These AWS variables are not declared in `envSchema` and reach the SDK only because `validateEnv` spreads the raw config before the parsed one (`{ ...config, ...appEnv }`). ConfigModule's `validate:` branch writes back exactly what the function returns, unlike its `validationSchema:` branch which merges stripped keys itself, so dropping that spread makes `AWS_PROFILE` in `apps/api/.env` a silent no-op and the SDK falls through to the machine's default profile.

### Origins and email

| Variable | Meaning | Default |
| --- | --- | --- |
| `MARKETING_URL` | Origin of the marketing app (CORS) | `http://localhost:3000` |
| `WORKSPACE_URL` | Origin of the workspace app (CORS, CSRF, WebSocket handshake) | `http://localhost:5173` |
| `ADMIN_URL` | Origin of the admin app (CORS, CSRF, WebSocket handshake) | `http://localhost:5174` |
| `API_PUBLIC_URL` | Public URL of the API when it is served under a different origin (CSRF origin check, invitation links, mobile and direct SSO callers). Browser SSO redirects use the surface's own origin instead (`docs/auth/implementation.md` §18, §22.3). Required with `AUTH_MODE=cognito` | unset |
| `SES_FROM_EMAIL` | Enables the SES invitation mailer; without it invitation links are logged | unset |

### Worker process

| Variable | Meaning | Default |
| --- | --- | --- |
| `JOBS_TIMEZONE` | IANA timezone for the maintenance schedules (`pnpm --filter @nestself/api worker:dev`, ECS `worker` service). The worker boots the same application module as the API, so it needs every API variable too (`DATABASE_URL`, `AUTH_MODE` and the `COGNITO_*` values, `SESSION_ENCRYPTION_KEY`: the `sessions.reconcile-ttl` job revokes refresh tokens through the session service) and exits without `REDIS_URL` | `Europe/Belgrade` |

## Workspace and Admin (`apps/workspace/.env.local`, `apps/admin/.env.local`)

| Variable | Meaning | Default |
| --- | --- | --- |
| `VITE_API_URL` | Base URL for API requests (proxied by Vite in development) | `http://localhost:4000` |
| `VITE_DATA_SOURCE` | `sample` renders fictional fixtures with the sample-data banner and a sample sign-in; `api` uses the real sign-in screens and the API | `sample` |

## Mobile (`apps/mobile/.env.local`)

| Variable | Meaning | Default |
| --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | Base URL for API requests from the mobile app | `http://localhost:4000` |
| `EXPO_PUBLIC_DATA_SOURCE` | `sample` or `api`, same behaviour as the web apps | `sample` |
| `EXPO_PUBLIC_COGNITO_REGION` | Pool region (api mode) | unset |
| `EXPO_PUBLIC_COGNITO_USER_POOL_ID` | User pool id (api mode) | unset |
| `EXPO_PUBLIC_COGNITO_CLIENT_ID` | Public mobile app client id (api mode) | unset |
| `EXPO_PUBLIC_COGNITO_DOMAIN` | Hosted sign-in domain, used for the SSO PKCE flow (api mode) | unset |

`node infra/cdk/scripts/env-from-outputs.mjs <stage> --mobile` prints the four Cognito values. They are public by design; the mobile client has no secret.

## Marketing (`apps/marketing/.env.local`)

| Variable | Meaning | Default |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Canonical site URL, used for metadata and sitemap generation | `http://localhost:3000` |
| `NEXT_PUBLIC_WORKSPACE_URL` | Link target for "sign in" | `http://localhost:5173` |
| `NEXT_PUBLIC_CONTACT_EMAIL` | Contact address shown on the site (placeholder until set) | `hello@nestself.example` |
| `API_URL` | Server-side API base for lead forms (they return 503 when unset) | `http://localhost:4000` |

## CDK (`infra/cdk`)

The CDK app reads the target account from `-c account=<id>` or, failing that, `AWS_ACCOUNT_DEV`, `AWS_ACCOUNT_STAGING`, `AWS_ACCOUNT_PRODUCTION` or `CDK_DEFAULT_ACCOUNT`. AWS credentials come from the standard chain (`AWS_PROFILE`, `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, SSO). See `CDK-setup.md`.

## Docker

Docker Compose services (Postgres, Redis and optionally the API) are defined in `docker/docker-compose.yml`. Run `pnpm db:up` to start only the databases, or `pnpm docker:api` to build and start the full API stack. Copy `docker/api.env.example` to `docker/api.env` before running the API profile. See `docker/README.md` for details on each service, the two Compose profiles and how to build the API image in CI. The same image runs the worker with the command `node dist/worker/main.js`.

## Notes

- `VITE_DATA_SOURCE` and `EXPO_PUBLIC_DATA_SOURCE` default to `sample` in development. In sample mode, apps import fixtures from `@nestself/sample-data` and display a banner on every screen.
- The `DATABASE_URL` default matches the Docker Compose service in `docker/docker-compose.yml` (user `nestself`, password `nestself_dev`, database `nestself` on port 5432). For Docker deployments, `DATABASE_URL` should use the `nestself_api` login role (created by `docker/initdb/01-app-role.sql`). Migrations run as the database owner, not as `nestself_api`.
- `GET /api/health` (public) checks `database` and `redis` and answers 503 when either is down. `redis.mode` is `redis` for a real connection and `memory` when `REDIS_URL` is absent and the in-memory store is in use, in which case `up` says nothing about Redis.
- The API seed script (`pnpm --filter @nestself/api db:seed`) refuses to run when `NODE_ENV` is `production`. `db:backfill-grants` uses the same `DATABASE_URL` and only works on a database at migration `0004` (see `apps/api/README.md`).
- Auth phase 2 (step-up, grant administration, confidential domain, emergency access) added no environment variables.
- Integration tests use `TEST_DATABASE_URL` to create and drop per-suite databases; the test environment ignores `.env` for everything else so a developer's `REDIS_URL` never leaks into a test run. Each database is named `<base>_<prefix>_<suffix>` (`testDatabaseName` in `apps/api/test/db/test-database-name.ts`): the prefix is `TEST_DATABASE_PREFIX` or a hash of the repository root, so two git worktrees running the same suite against one server never drop each other's database. Names longer than PostgreSQL's 63-byte limit shorten the base. `pnpm e2e:auth` uses the same prefix for its own database, `nestself_e2e_<prefix>` (or `E2E_DATABASE_URL`), and never the `DATABASE_URL` in `.env`; see `e2e/README.md`.
