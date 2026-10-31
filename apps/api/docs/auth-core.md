# Auth Core Infrastructure Layer

Covers the Redis access layer, identity provider, session service, audit
writer, environment schema and error handling. Implemented on
`feat/auth-foundation` as tasks T-1.3, T-1.10, T-1.15, T-0.4; the route
table, resolvers and phase 2 modules (grants, professional, emergency,
step-up) were updated on 2026-10-24.

## Module map

| Module | Global? | Key export(s) |
|--------|---------|---------------|
| `RedisModule` | yes | `KEY_VALUE_STORE` (Symbol token) |
| `IdentityModule` | no | `IdentityProviderService` (abstract class) |
| `SessionModule` | no | `SessionService`, `SessionCookies`, `CsrfGuard` |
| `AuditModule` | yes | `AuditWriter` |
| `DbModule` | yes | `DbService`, repositories (identity, authorization, approval-authorities, professional, audit, leads, invitations, memberships, org-units) |
| `GrantsModule` | no | `GrantsService`, `ApprovalAuthoritiesService`; controllers for `/orgs/:orgId/grants`, `/orgs/:orgId/approval-authorities`, `/ops/...grants`, `/ops/users/:userId/access` |
| `ProfessionalModule` | no | `ProfessionalService` (`/professional/*`) |
| `EmergencyModule` | no | `EmergencyService` (`/ops/emergency-access/*`) |

## Redis (`src/redis/`)

`KeyValueStore` is the DI contract (Symbol `KEY_VALUE_STORE`). Two
implementations are wired automatically:

- **`RedisKeyValueStore`** when `REDIS_URL` is set (node-redis v6, lazy
  subscriber client for pub/sub).
- **`MemoryKeyValueStore`** when `REDIS_URL` is absent and
  `AUTH_MODE=stub` or `NODE_ENV=test`.

Key functions live in `redis-keys.ts` (Appendix I Part B).

## Identity (`src/identity/`)

`IdentityProviderService` is an abstract class. The module provides:

- **`CognitoIdentityProvider`** when `AUTH_MODE=cognito`. Uses the SDK
  confidential web client with SECRET_HASH on every call. User
  management methods are delegated to `cognito-user-ops.ts`.
- **`FakeIdentityProvider`** otherwise. In-memory users, OTP codes and
  refresh tokens. Refuses to construct when `NODE_ENV=production`.

Helper files: `cognito-error-map.ts`, `cognito-helpers.ts`,
`cognito-user-ops.ts`, `fake-token-factory.ts`, `fake-user-store.ts`,
`totp.ts`.

## Session (`src/session/`)

`SessionService` manages server-side sessions in Redis:

- `create` / `get` / `regenerate` / `destroy` / `destroyAllForUser`
- `updateContext` (switches org, never extends absolute expiry)
- `ensureFreshAccessToken` (lock-based Cognito token refresh)

Cognito tokens are encrypted at rest with AES-256-GCM (`TokenCipher`);
dual-key rotation is supported via `SESSION_ENCRYPTION_KEY_PREVIOUS`.

`SessionCookies` handles `__Host-` prefixed session + CSRF cookies
(cookie v2 API). `CsrfGuard` implements double-submit + Sec-Fetch-Site
+ Origin validation (SPIKE-02: NestJS 12.x has no built-in CSRF).

Session lifetimes follow the population/context matrix in `session-policy.ts`
and can be overridden with `SESSION_LIFETIME_OVERRIDES` (JSON env var).

## Audit (`src/audit/`)

`AuditWriter.record()` inserts `AuditEvent` rows with:
- IP hashing (SHA-256, truncated)
- User-agent family extraction (ua-parser-js v2)
- Detail sanitisation (forbidden keys stripped, strings truncated)
- Retention policy from `RetentionPolicy` table (10-min cache, defaults)

`record()` never throws in production (SESS-R-22); `strictMode` re-throws
for test assertions.

`PINO_REDACT_CONFIG` redacts sensitive fields from Pino HTTP logs.

## Config (`src/config/`)

`env.ts` defines the Zod schema for all auth-related environment
variables. `AUTH_MODE=stub` is the default (requires `JWT_SECRET`).
`AUTH_MODE=cognito` requires `REDIS_URL`, all `COGNITO_*` vars, and
`SESSION_ENCRYPTION_KEY`. Empty strings from `.env` files are coerced to
`undefined` for optional fields.

## Common (`src/common/`)

- `ApiHttpException` (extends HttpException with `code` + `details`)
- `SessionExpiredError`, `SessionRefreshBusyError`
- `ApiExceptionFilter` (global filter producing the 5.9 error envelope)
- `requestMeta()` (IP, user-agent, request-id extraction)

## Bootstrap (`main.ts`, `app.module.ts`)

- Trust proxy via `TRUST_PROXY_HOPS`
- `ApiExceptionFilter` registered as global filter
- `exposedHeaders: ['x-request-id']` on CORS
- Pino redaction wired into LoggerModule

## Security notes

- `findUserByEmail` rejects emails containing whitespace, quotes, or
  backslashes to prevent Cognito ListUsers filter injection.
- CSRF guard checks Sec-Fetch-Site, Origin header, and double-submit
  token with timing-safe comparison.
- Session IDs are SHA-256 hashed before use as Redis keys.
- The fake IDP never runs in `NODE_ENV=production`.

---

## HTTP Layer (T-1.4, T-1.6, T-1.7)

### Guards and registration order

Four global guards registered via `APP_GUARD` in `app.module.ts`:

| Order | Guard | Behaviour |
|-------|-------|-----------|
| 1 | `AuthenticationGuard` | Session cookie path or bearer token path. Attaches `request.principal`, `request.session`, `request.authMeta`, `request.csrfToken`. `@Public()` bypasses. |
| 2 | `CsrfGuard` | Double-submit CSRF check. Only enforces when session cookie is present. Safe methods (GET/HEAD/OPTIONS) pass. |
| 3 | `AuthorizationGuard` | Reads `@Authorize()` metadata, resolves resource, calls `authorize()`. `@Public()` and `@Authenticated()` bypass. Non-disclosure: 404 when no org visibility, 403 when visible but denied (AUTHZ-R-61). |
| 4 | `AppThrottlerGuard` | @nestjs/throttler, 60 req/min per client IP unless the route sets its own (`src/authz/throttles.ts`); counters in Redis when `REDIS_URL` is set (`KeyValueThrottlerStorage`); a route marked `@RedirectOnThrottle()` answers a refusal with a 302 to the workspace `/sign-in?reason=sso_rate_limited`. |

### Decorators

| Decorator | Metadata key | Effect |
|-----------|-------------|--------|
| `@Public()` | `isPublic` | Bypasses authentication and authorization |
| `@Authenticated()` | `isAuthenticatedOnly` | Requires valid session/bearer, no authorization check |
| `@Authorize(action, resolver)` | `authorize` | Requires authentication + passes authorize(principal, action, resource, ctx), then the step-up freshness check when the action has a class |
| `@Authorize([action, ...], resolver)` | `authorize` | Any of the listed actions: they are evaluated in order and the first that allows decides, and its step-up class applies. When none allows, the denial is audited as `access.denied` under the first action (`actionAttempted`) with the whole list in `details.alternatives`. An empty list throws when the route is declared. |
| `@CurrentPrincipal()` | param decorator | Extracts `request.principal` |

### Resource resolvers (`src/authz/resolvers.ts`)

| Resolver | Used on | Behaviour |
|----------|---------|-----------|
| `orgResourceFromContext(type)` | `/orgs/:orgId/*` | The active context must be the organization in the route (403 `context_mismatch` otherwise, API-R-21); returns `{ type, orgId }` |
| `operationsResource(type, idFn?)` | `/ops/*` without an organization | Requires a web session (403 `session_required` for bearer callers, API-R-28) and the operations context (403 `context_mismatch`); returns `{ type, id? }` |
| `operationsOrgResource(type)` | `/ops/orgs/:orgId/*` | The same session and context checks (shared `assertOperationsSession`), then the route `:orgId` (404 `not_found` without it); returns `{ type, orgId }`, so the engine applies the `assigned_clients` scope through the CLIENT assignment |

Routes whose resource needs row data (confidential conversations and intakes, emergency record reads) are `@Authenticated()` and call `AuthorizationService.require(principal, action, resource)` after loading the row; `require()` audits denials, maps them to 403 or 404 like the guard and runs the same step-up check (`assertStepUpFresh` in `step-up-freshness.ts`). `require(principal, action, resource, { denyAs: 'not_found' })` answers every denial as the 404 `not_found` of a missing record (the audit row is unchanged); the `/professional/*` single-record reads pass it, because the row is loaded before the decision and a 403 would confirm that the record exists. A stale step-up is not a denial and stays 403 `step_up_required`.

The emergency record read checks the caller's own access record before it loads the record: unknown or someone else's is 404, one that is not active (pending, revoked, expired) is 403 `emergency_not_active`, answered the same for any record id. Then the record (404) and whether the access covers it (404, like a missing one), then the engine. The two refusals the engine no longer sees are audited as `access.denied` (`details.reason` `emergency_not_active` or `outside_emergency_scope`, identifiers only).

Staff (any principal with a staff template) always count as having organization visibility, so a denied operations caller gets 403, not 404, except on the confidential reads above.

### Route table

All routes under the global `/api` prefix.

| Method | Path | Decorator | Throttle |
|--------|------|-----------|----------|
| POST | /auth/discover | @Public | default (wrong codes are bounded per address by `SignInThrottle`) |
| POST | /auth/email-otp/start | @Public | default |
| POST | /auth/email-otp/verify | @Public | default |
| POST | /auth/password | @Public | default |
| POST | /auth/challenge | @Public | default |
| POST | /auth/totp/enrol | @Public | default |
| POST | /auth/totp/confirm | @Authenticated | default |
| POST | /auth/password-reset/start | @Public | default |
| POST | /auth/password-reset/confirm | @Public | default |
| POST | /auth/context | @Authenticated | default |
| POST | /auth/step-up/start | @Authenticated | 10/min per session |
| POST | /auth/step-up/resend | @Authenticated | 10/min per session |
| POST | /auth/step-up/verify | @Authenticated (204) | 10/min per session |
| POST | /auth/sign-out | @Authenticated | default |
| POST | /auth/sign-out-all | @Authenticated | default |
| POST | /auth/ws-ticket | @Authenticated | default |
| GET | /auth/me | @Authenticated | default |
| PATCH | /auth/me/locale | @Authenticated | default |
| PATCH | /auth/me/display-name | @Authenticated | default |
| GET | /auth/sessions | @Authenticated | default |
| DELETE | /auth/sessions/:sessionId | @Authenticated | default |
| GET | /health | @Public (reports `database` and `redis`) | default |
| GET | /orgs/:orgId/programme | @Authorize(program.overview) | default |
| GET | /orgs/:orgId/org-units | @Authorize([program.overview, access.preview]) | default |
| POST | /orgs/:orgId/org-units | @Authorize(org_units.manage) | default |
| PATCH | /orgs/:orgId/org-units/:unitId | @Authorize(org_units.manage) | default |
| POST | /orgs/:orgId/org-units/:unitId/move | @Authorize(org_units.manage) | default |
| GET | /orgs/:orgId/members | @Authorize([program.overview, access.preview]) | default |
| PATCH | /orgs/:orgId/members/:membershipId | @Authorize(people.move) | default |
| POST | /orgs/:orgId/members/:membershipId/end | @Authorize(people.deactivate) | default |
| POST | /ops/users/:userId/suspend | @Authorize(people.deactivate) | default |
| POST | /ops/users/:userId/reinstate | @Authorize(people.deactivate) | default |
| POST | /orgs/:orgId/invitations | @Authorize(people.invite) | default |
| POST | /orgs/:orgId/invitations/import | @Authorize(people.import) | default |
| DELETE | /orgs/:orgId/invitations/:invitationId | @Authorize(people.invite) | default |
| GET | /orgs/:orgId/grants | @Authorize(access.preview) | default |
| GET | /orgs/:orgId/grants/preview | @Authorize(access.preview) | default |
| POST | /orgs/:orgId/grants | @Authorize(access.grant) | 10/min |
| PATCH | /orgs/:orgId/grants/:grantId | @Authorize(access.grant) | 10/min |
| POST | /orgs/:orgId/grants/:grantId/revoke | @Authorize(access.revoke) | 10/min |
| POST | /orgs/:orgId/grants/delegate | @Authorize(access.delegate) | 10/min |
| POST | /orgs/:orgId/grants/transfer-ownership | @Authorize(access.grant); caller must hold the owner grant | 10/min |
| GET | /orgs/:orgId/approval-authorities | @Authorize(access.preview) | default |
| POST | /orgs/:orgId/approval-authorities | @Authorize(access.grant) | 10/min |
| PATCH | /orgs/:orgId/approval-authorities/:id | @Authorize(access.grant) | 10/min |
| GET | /ops/orgs/:orgId/members | @Authorize(client.configure), operationsOrgResource | default |
| POST | /ops/orgs/:orgId/members/:membershipId/end | @Authorize(people.deactivate), operationsOrgResource | default |
| POST | /ops/orgs/:orgId/invitations | @Authorize(people.onboard), operationsOrgResource | default |
| POST | /ops/orgs/:orgId/invitations/import | @Authorize(people.import), operationsOrgResource | default |
| DELETE | /ops/orgs/:orgId/invitations/:invitationId | @Authorize(people.onboard), operationsOrgResource | default |
| GET | /ops/grants | @Authorize(access.preview), operationsResource | default |
| POST | /ops/grants | @Authorize(access.grant), operationsResource | 10/min |
| GET | /ops/orgs/:orgId/grants | @Authorize(access.preview), operationsOrgResource | default |
| GET | /ops/orgs/:orgId/grants/preview | @Authorize(access.preview), operationsOrgResource | default |
| POST | /ops/orgs/:orgId/grants | @Authorize(access.grant), operationsOrgResource | 10/min |
| POST | /ops/orgs/:orgId/grants/:grantId/revoke | @Authorize(access.revoke), operationsOrgResource | 10/min |
| POST | /ops/orgs/:orgId/grants/transfer-ownership | @Authorize(access.grant), operationsOrgResource | 10/min |
| GET | /ops/users/:userId/access | @Authorize(access.preview), operationsResource | default |
| GET | /ops/emergency-access | @Authorize(audit.read), operationsResource | default |
| POST | /ops/emergency-access | @Authorize(access.emergency.request), operationsResource | 10/min |
| POST | /ops/emergency-access/:id/approve | @Authorize(access.emergency.approve), operationsResource | 10/min |
| POST | /ops/emergency-access/:id/deny | @Authorize(access.emergency.approve), operationsResource (204) | 10/min |
| POST | /ops/emergency-access/:id/revoke | @Authorize(access.emergency.approve), operationsResource | 10/min |
| GET | /ops/emergency-access/:id/records/:recordType/:recordId | @Authenticated; `require(records.read.emergency)` in the service | default |
| GET | /professional/conversations/:id | @Authenticated; `require(conversation.read.assigned)` | default |
| GET | /professional/me/conversations/:id | @Authenticated; `require(conversation.participate)` | default |
| GET | /professional/intake/:id | @Authenticated; `require(conversation.read.assigned)` | default |
| GET | /auth/sso/start | @Public, @RedirectOnThrottle (302 to the identity provider) | 60/min per IP and connection |
| GET | /auth/sso/callback | @Public, @RedirectOnThrottle (always 302) | 120/min per IP |
| POST | /auth/sso/bind/start | @Public (pending binding: mails the confirm-email code) | 10/min per IP |
| POST | /auth/sso/bind/verify | @Public (binds, sets the session cookies) | 10/min per IP |
| POST | /auth/sso/bind/resend | @Public | 10/min per IP |
| POST | /auth/sso/bind-token | @Public (mobile federated binding, 204) | 10/min per IP |
| GET | /auth/sso/_fake/authorize | @Public; registered only with `AUTH_MODE=stub` | default |
| GET | /ops/sso-connections | @Authorize(sso.manage), operationsResource | default |
| POST | /ops/sso-connections | @Authorize(sso.manage), operationsResource | 10/min |
| PATCH | /ops/sso-connections/:id | @Authorize(sso.manage), operationsResource | 10/min |
| POST | /ops/sso-connections/:id/domains | @Authorize(sso.manage), operationsResource | 10/min |
| POST | /ops/sso-connections/:id/domains/:domainId/verify | @Authorize(sso.manage), operationsResource | 10/min |
| POST | /ops/sso-connections/:id/test | @Authorize(sso.manage), operationsResource | 10/min |
| POST | /ops/sso-connections/:id/activate | @Authorize(sso.manage), operationsResource | 10/min |
| GET | /invitations/:token/preview | @Public | 10/min |
| POST | /invitations/accept | @Public | 10/min |
| POST | /leads/* (3 routes) | @Public | 5/min |

### Organization owner (owner model, 2026-10-24)

`employer_owner` is an organization's single superadmin and holds
`access.grant` and `access.revoke`. `GrantsService` keeps at most one active
(unrevoked, not expired) `employer_owner` grant per `scopeOrgId`:
`AuthorizationRepository.findActiveOwnerGrants` takes a transaction-scoped
advisory lock on the organization's ownership and returns the active owner
grants, and `create`, an owner grant's window `update`, the transfer,
invitation create/import and invitation acceptance answer a second owner with 409 `owner_exists`
(`details.currentOwnerUserId`).

`transferOwnership` (both transfer routes) runs in one `withOrgScope`
transaction: the organization route requires the caller's own started owner
grant (403 `forbidden`), both routes require the new owner's ACTIVE membership
(409 `subject_not_member`) and refuse the current owner (409 `conflict`). It
revokes the old owner grant only (reason `ownership_transferred`), creates
the new grant from the template, and re-parents the old grant's active
(unrevoked) children to the new grant
(`AuthorizationRepository.reparentActiveChildren`); the bounds still hold
because the new grant has the same template and actions. It audits
`grant.revoked` + `grant.created` with `details.transfer = true` (and
`byStaff = true` on the ops route) and one `grant.adjusted`
(`details.reparented = true`, `fromGrantId`) per moved child. The response is
`OwnershipTransferResponse` (`revokedGrantId`, null when staff created the
first owner, and `createdGrant`). Afterwards the old and new owners, the moved
children's subjects and the delegatees below both grants are invalidated.

`InvitationsService.create` refuses an `employer_owner` invitation while the
organization has an active owner (409 `owner_exists`); `import` reports such
rows in `errors` with reason `owner_exists`.

### Principal cache (T-1.7)

| Redis key pattern | TTL | Content |
|-------------------|-----|---------|
| `principal:{userId}` | 30s +/- 5s jitter | LoadedPrincipal JSON |
| `grants:{userId}:{orgId}` | 60s +/- 10s jitter | GrantInput[] JSON |
| `assignments:{userId}` | 60s | AssignmentInput[] JSON |
| `org_tree:{orgId}` | 5min | OrgTreeEntry[] JSON |

Cache invalidation: pub/sub on `invalidate` channel triggers key deletion + LRU purge.

Circuit breaker: 3 consecutive Redis failures open the breaker for 5s. LRU fallback holds 100 entries with 10s TTL.

### Signing in locally (stub mode)

Set `AUTH_MODE=stub` (default) and `JWT_SECRET` (any 32+ char string). The fake
identity provider is pre-loaded with the sample people (`identity.module.ts`,
`SAMPLE_EXTERNAL_IDENTITIES`) and the database seed links them, so every seeded
person can sign in after `db:migrate` and `db:seed`.

**Employee (email OTP)**, e.g. `user_jovan@example.com`:
1. `POST /api/auth/discover` with email → `method: "email_otp"`
2. `POST /api/auth/email-otp/start` → `challengeToken`
3. Read the code from the API log: `Fake identity provider: OTP for user_jovan@example.com is 123456` (or set `FAKE_IDP_FIXED_OTP`)
4. `POST /api/auth/email-otp/verify` with `{ challengeToken, code }` → session cookies set

**Staff and experts (password + TOTP)**, e.g. `user_nikola@example.com`:
1. `POST /api/auth/discover` → `method: "password"`
2. `POST /api/auth/password` with `Nestself-dev-1234!` (`SAMPLE_DEV_PASSWORD`) → `{ step: "totp_enrol", challengeToken }` on first sign-in
3. `POST /api/auth/totp/enrol` with the challengeToken → `secretUri` and a rotated `challengeToken`
4. `POST /api/auth/challenge` with the authenticator code → session cookies set; later sign-ins ask for the code directly (`step: "totp"`)

Set `SESSION_COOKIE_INSECURE_DEV=true` to drop the `__Host-` prefix and `Secure` flag for HTTP localhost.

## HTTP layer (`src/auth/`, `src/authz/`, `src/principal/`)

Implemented as tasks T-1.4 (BFF sign-in endpoints), T-1.6 (guards and
decorators), T-1.7 (PrincipalLoader with Redis cache).

### Guards (global, ordered by `APP_GUARD` registration)

1. **AuthenticationGuard** — reads `__Host-sid` cookie or `Authorization:
   Bearer` header, attaches `request.principal`, `request.session`,
   `request.authMeta` and `request.csrfToken`. Skips `@Public()` routes.
2. **CsrfGuard** — double-submit cookie + `Sec-Fetch-Site` + Origin check.
3. **AuthorizationGuard** — evaluates `@Authorize(action, resolver)`.
   Skips `@Public()` and `@Authenticated()` routes.
4. **ThrottlerGuard** — rate limiting.

### Security decorators

| Decorator | Purpose |
|-----------|---------|
| `@Public()` | No auth required (discover, OTP start, password reset) |
| `@Authenticated()` | Valid session/bearer, no authz action (me, sessions, sign-out) |
| `@Authorize(action, resolver)` | Full grant-based authorization check |

The **default-deny test** walks every controller handler via
`DiscoveryService` and fails if any route lacks one of the three decorators.

### PrincipalLoader (`src/principal/`)

Loads `Principal` from the identity and authorization repositories
(backed by Drizzle; user, memberships, grants, expert, staff
templates). Uses a Redis cache with circuit-breaker (3 failures
→ open for 5s, LRU fallback 100 entries / 10s TTL). `InvalidationSubscriber`
listens on Redis pub/sub for `principal:invalidate:{userId}` messages.

### BFF sign-in services (`src/auth/`)

The original monolithic `AuthService` (841 lines) is split into six
focused services:

| Service | Lines | Responsibility |
|---------|-------|----------------|
| `DiscoverService` | 30 | Email → sign-in method lookup |
| `SignInService` | 240 | email-OTP start/verify, password sign-in, challenge response |
| `IdentityResolutionService` | 279 | IdP tokens → local user → session → MeResponse |
| `TotpService` | 71 | TOTP enrolment and confirmation |
| `PasswordResetService` | 46 | Forgot password start/confirm |
| `SessionEndpointsService` | 167 | /me, context switch, sign-out, sessions list/revoke, ws-ticket |

Shared utilities: `neutral-delay.ts` (200ms timing floor against
user-enumeration oracles), `challenge-store.ts` (single-use SHA-256 hashed
Redis tokens), `sign-in-throttle.ts` (lockout after 5 failed OTP attempts).

### Bearer verification

Two implementations behind the `BEARER_VERIFIER` DI token:
- `StubBearerVerifier` — HS256 JWT via `JwtService` when `AUTH_MODE=stub`
- `CognitoBearerVerifier` — `aws-jwt-verify` + revoked family check when
  `AUTH_MODE=cognito`

## WebSocket (`src/ws/`)

Real-time communication over Socket.IO at path `/api/ws`.
Implemented as task T-1.11 (4.6.7, AUTHZ-R-58..60).

### Adapter

`NestSelfIoAdapter` (extends `IoAdapter` from `@nestjs/platform-socket.io`)
configures the Socket.IO server and registers the handshake middleware.
Installed in `main.ts` via `app.useWebSocketAdapter(new NestSelfIoAdapter(app))`.

| Config | Source |
|--------|--------|
| Path | `/api/ws` |
| CORS | `WORKSPACE_URL`, `ADMIN_URL` with credentials |

### Handshake authentication (AUTHZ-R-58)

`WsAuthService.authenticateHandshake()` runs in the `io.use()` middleware:

1. **Origin check** — when `Origin` header is present, it must match
   `WORKSPACE_URL` or `ADMIN_URL`. Rejects with `forbidden_origin`.
2. **Web path (cookie)** — parse session cookie via `SessionCookies.parse`,
   load session via `SessionService.get`, load principal via
   `PrincipalLoader.load`. Rejects when missing, suspended or deactivated
   with `unauthorized`.
3. **Mobile path (ticket)** — `handshake.auth.ticket` → SHA-256 →
   `store.getDel(wsTicketKey(hash))` (single-use, AUTHZ-R-60). Reject when
   absent or older than 30 s with `invalid_ticket`. Load principal for
   the stored `userId` with default context (same as bearer path).
4. **Attach** `socket.data.principal` and
   `socket.data.subscriptions = new Map()`.

### Gateway events

`EventsGateway` (`@WebSocketGateway({ path: '/api/ws' })`) handles:

| Event | Direction | Payload | Behaviour |
|-------|-----------|---------|-----------|
| `subscribe` | client → server | `{ room, action, resource }` (zod-validated) | Runs `authorizeSubscription`; on allow → join room, record in `subscriptions`; on deny → emit `subscribe:denied { room, reason }` (AUTHZ-R-59) |
| `unsubscribe` | client → server | `{ room }` | Leave room, remove from `subscriptions` |
| `subscribe:ok` | server → client | `{ room }` | Subscription confirmed |
| `subscribe:denied` | server → client | `{ room, reason }` | Subscription denied |
| `subscription:revoked` | server → client | `{ room }` | Room access revoked after invalidation |
| `session:revoked` | server → client | `{ reason }` | Socket about to be disconnected (suspension/deactivation) |

The gateway class carries `@Authenticated()` for the default-deny scan
(AUTHZ-R-62). Per-subscription authorization runs inside the handler.

### Real-time invalidation

`WsInvalidationService` subscribes to the Redis `invalidate` channel.
On each message with a `userId`:

1. Find all sockets for that user via `WsConnectionRegistry`.
2. Reload the principal via `PrincipalLoader.load`.
3. If the user is now suspended, deactivated or missing → emit
   `session:revoked` and disconnect the socket (SESS-R-24, DR-15).
4. Otherwise, re-run `authorizeSubscription` for every recorded
   subscription. Revoke rooms that are no longer allowed, emitting
   `subscription:revoked { room }`.

### Module map addition

| Module | Global? | Key export(s) |
|--------|---------|---------------|
| `WsModule` | no | `WsAuthService`, `WsConnectionRegistry` |

### Not yet implemented

- IdP-initiated SSO and SCIM (SP-initiated SSO is built, federated mobile users included; `docs/auth/implementation.md` section 22)
- Push notifications
- A step-up screen in the mobile app (the API accepts bearer step-up)
