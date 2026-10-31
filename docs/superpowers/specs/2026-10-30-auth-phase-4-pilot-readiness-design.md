# Auth phase 4: pilot readiness and auth debts. Design

Date: 2026-10-30. Branch `feat/auth-p2` (worktree `auth-p2`, from `main` at `94b524d`). Status: draft for the owner's approval. Scope chosen by the owner on 2026-10-30: "SSO pilot + auth debts" (everything that blocks the first real employer on enterprise SSO, plus the auth technical debts of `docs/auth/implementation.md` section 21 that need no owner decision and no AWS deployment).

Companion documents: `docs/auth/implementation.md` (sections 21 and 22 list the gaps this design closes), `docs/tasks/auth/auth-strategy.md` (requirements cited as `SSO-R-nn`, `SESS-R-nn`, `API-R-nn`), `docs/tasks/auth/phase-2-readiness.md` (status tables). The three recon reports this design rests on are summarised in section 3; file references there are against `94b524d`.

## 1. Intent

A bank-sized employer wants to join the programme through its own identity provider. Enterprise SSO shipped on 2026-10-25 and is proven only against the fake identity provider. Before a real connection goes `ACTIVE`, the follow-ups recorded in section 22.14 have to be closed, because each of them bites on day one with a real employer: one office IP exhausts the sign-in throttle, a federated user cannot step up for any sensitive action, an OIDC provider that omits `email_verified` (Entra ID does by default) blocks every employee, a metadata-URL provider never gets a certificate-expiry date, the staging and production pools have no Cognito domain at all, and a federated mobile user cannot be resolved by the API.

While the branch is open, the auth technical debts that need no owner decision are closed too: audit rows that can outlive a rolled-back change, the step-up dialog's rough edges, the `cases` binding that blocks any conversation write path, the invitation import's English row reasons and double counting, the `/hr/access` gate, the silent `/auth/me` failure mode, and the existence oracle on confidential reads.

### Goals

1. A real SAML or OIDC employer can be onboarded end to end with the documented runbook and nothing in the API, the web apps, the mobile app or the CDK stacks has to be changed on the day.
2. Every federated user can complete step-up, and sensitive actions by federated staff (for example a platform owner signing in through an employer's IdP in the future) are not blocked.
3. Every failure the user can cause is visible on screen in all four locales.
4. Audit rows commit with the change they describe, or not at all.
5. The remaining open items are listed in one place (`implementation.md` section 21) with a reason each, and section 22.14 is empty or lists only items that need the owner or the pilot.

### Non-goals

- Authenticator or passkey step-up, SCIM, IdP-initiated sign-in, the identity merge runbook, retention sweeper, the S3 audit export, weekly Cognito export, the production account and SCPs, the compliance track. These need owner decisions, AWS work or a pilot and stay in section 21.
- Mobile administration screens and mobile step-up UI (web only by the 2026-10-25 decision). Mobile gains only what it needs to *sign in* through SSO: identity binding and bearer resolution.
- Domain wiring for the web surfaces (ACM certificates, CloudFront aliases, Route 53 records for `app.`, `admin.` and the apex). The edge stack has none today. This design adds the Cognito side only and names the apex record as a prerequisite.
- A searchable combobox primitive in `@nestself/ui`. The 25-organisation and 100-member picker caps are fixed with a server-side search field in front of the existing `Select`; the combobox is listed as a follow-up.
- Shortening the email code (Cognito's eight digits stay; section 21 explains the trade).

### Anti-goals

- Weakening a security ruling to make a flow work: the verified-domain rule, the per-organisation slug reservation, SP-initiated only, the `__Host-` session cookie and the surface-origin rule stay exactly as they are.
- Any new dependency. `@aws-sdk/client-ses`, `aws-jwt-verify`, `@base-ui/react` and `@nestjs/throttler` are already installed and are all this design needs. No `pnpm install` is run while other worktrees are active.
- Reading the address out of a URL. The `sso_email_unverified` redirect stops carrying the email.
- A deployment. CDK changes are synthesised and unit-tested; `cdk deploy` of the custom domain is a documented owner step.

## 2. Constraints carried over

Everything in `CLAUDE.md` and in the phase 2 and 3 plans applies: server-side enforcement with `@Public()`/`@Authenticated()`/`@Authorize()` on every route and the default-deny test; RLS with `FORCE` on tenant tables; audit details sanitised (`FORBIDDEN_KEYS`, pino redaction), never tokens, codes, assertions or secrets; failures rendered with translated copy in `en`, `sr-Latn`, `hu` and generated `sr-Cyrl`; sample data rules; motion rules for anything that pops out; `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` on commits; DB suites behind `TEST_DATABASE_URL` (local Postgres 17 on port 54329, re-created as a persistent Homebrew service on 2026-10-30); no installs; code lengths from `EMAIL_OTP_MIN_LENGTH`/`EMAIL_OTP_MAX_LENGTH`; `eu-central-1` only.

## 3. What the code does today (recon summary)

Three read-only recon passes on 2026-10-30 established the following. Items marked **(new)** were not in section 21 or 22.14 and change the design.

**Throttling.** SSO start and callback use `@nestjs/throttler` 6.7.1 with the default per-IP tracker, 10/min each, in-memory storage per process (production runs 2 to 8 API tasks). **(new)** `TRUST_PROXY_HOPS` is never set by the CDK compute stack, so behind CloudFront and the ALB every visitor most likely shares one bucket already. A 429 on the SSO browser routes renders raw JSON instead of a redirect. The step-up routes are 5/min per IP; wrong codes are bounded only by three tries per challenge, with no per-session lockout. The only non-IP throttle is `SignInThrottle` (Redis, per email). Route-level `getTracker` is supported by the installed throttler version.

**Identity binding.** `external_identities` has `(provider, subject)` unique, no organisation or connection column, no RLS. Path 1 of the callback checks only an `ACTIVE` membership in the organisation of the connection that currently owns the provider name. **(new)** The session's `cognito.username` is read from a `username` claim that real Cognito ID tokens do not carry (they carry `cognito:username`); the fake token carries both, which hides it.

**Mobile.** **(new)** The mobile app runs the PKCE flow directly against the Cognito hosted UI with `identity_provider`, so the API callback, and with it every binding rule, never runs for a mobile-first SSO user. The bearer path looks identities up under provider `cognito` only and hard-codes `secondFactor: false`.

**Step-up.** Start answers 403 `forbidden` when the user has no native `cognito` identity. Native users step up with Cognito's `EMAIL_OTP`; federated pool users cannot use any native Cognito flow. `StepUpStartResponseSchema` already allows `method: 'sso'` and `ssoStartUrl`. Start passes no locale (`principal.locale` is available); invitation acceptance passes none either. **(new)** The web dialog drops the challenge after one wrong code although the API keeps it for three; it has no resend cooldown, no in-flight guard, and Cancel stays enabled during verify; a `forbidden` leaves the dialog in a dead end.

**Unverified OIDC email.** The callback deletes the orphan pool user and redirects to `/sign-in?reason=sso_email_unverified&email=<address>`; the screen then runs the native email-code sign-in, which never sends a code for an address that has no native pool user. Nothing binds.

**Certificates.** `describeProvider` reads the expiry from `MetadataFile` only; a provider registered from a URL has `MetadataURL` and reports nothing. The job logs and audits nightly with no email and no dedupe. `metadataUrl` is validated with `z.string().url()` only (`http:`, `file:`, link-local hosts pass). The only outbound HTTP call in the API is the token exchange against a fixed host.

**State machine.** Provider changes on a `SUSPENDED` connection keep `last_tested_at`, so a later reactivation needs no test; `certificateExpiresAt` is never refreshed by PATCH.

**Email.** An `InvitationMailer` exists with a logging adapter and an SES adapter (`@aws-sdk/client-ses` 3.1155.0 installed). It is private to the invitations module and selected by `SES_FROM_EMAIL`, **(new)** which the CDK compute stack never sets, so AWS deployments log invitation links instead of sending them. **(new)** The import sends invitation emails inside its transaction, before commit.

**Audit.** `AuditRepository.insertEvent(row, tx?)` already accepts an executor; `AuditWriter.record` never passes one, so every audit row uses its own pool connection: a change can commit without its row, a row can outlive a rolled-back change, and in-transaction callers burn a second connection from a pool of ten. `audit_events` has no RLS, so a tenant-scoped transaction may insert into it. The emergency sweeper and `closeGrants` stop on the first failing row.

**Cognito domain.** **(new)** Only dev has a Cognito domain (the `nestself-dev` prefix). Staging and production pools have none; the auth stack carries a placeholder URL. The edge stack creates no certificate, no aliases and no records; the hosted zone exists with no records. `UserPoolDomainTarget` and `Certificate.fromCertificateArn` are available in the installed `aws-cdk-lib` 2.274.0. The SAML ACS URL is derived from `COGNITO_DOMAIN`, so the domain must be final before the first employer configures its IdP.

**Cases.** `conversations.case_id` and `intake_records.case_id` are free text; `assignments.target_id` is polymorphic with no organisation; the CASE match in `authorize()` compares `targetId` only. Repository reads run in system context across organisations.

**Invitations import.** Row reasons are three English sentences plus four codes; a refused duplicate or member is counted in `skipped` *and* `errors`; **(new)** a duplicate within the batch drops both rows (the later row's error carries the address, and `toCreate` then filters every valid row with an address in `errors`), and by the same filter a valid row is dropped when another row with the same address failed the template check. `sso_domain_claimed` is unmapped in both apps. `cannot_end_self` already exists (section 21's `self_end` item is stale).

**Web.** `/hr/access` sits under the `_hr` layout (needs `program.overview`); **(new)** moving it is not enough because the screen's member and org-unit lists need `program.overview` on the server too. `/auth/me` has no timeout; a 500 or network failure looks like being signed out (a `console.warn`); a stalled request leaves a blank page. The admin SSO screen reads the first 25 organisations; the organisations API supports `search`; **(new)** the test-link fallback reuses the nonce (22.14 is wrong about the second nonce); the real problems are that `window.open` with `noopener` cannot report whether the tab opened and that following both links denies the second.

**Confidential reads.** `/professional/*` loads the row before authorising, so org members and staff get 404 for a missing id and 403 for a denied one. `readRecord` returns 404 for a missing record before checking whether the caller's emergency access is active or covers it, so a staff member with any own access id can probe record ids.

**Docs tooling.** Screenshots come from `e2e/screenshots/*.shot.ts` (`pnpm docs:auth:screenshots`), PDFs from `docs/auth/pdf/build.mjs` (`pnpm docs:auth:pdf`). CI runs no Playwright suite.

## 4. Approaches considered

Each row names the alternatives that were real, what they trade, and the pick. The owner picks in this document; everything else is the builder's.

### 4.1 Step-up for federated users (SSO-R-17, API-R-12)

| Approach | Trade-off |
| --- | --- |
| **A. NestSelf-issued email code to the verified work address, for every class.** The API generates and mails the code itself (the user has no native pool user). **Chosen.** | Needs the mailer and an OTP store. Deviates from SSO-R-17's "IdP round trip first". Same user experience as native users. |
| B. Fresh IdP round trip through Cognito with `prompt=login`/`max_age=0`, accept when the new `auth_time` is fresh, else fall back to A. The strategy's wording. | Cognito forwards neither `prompt` nor SAML `ForceAuthn` to the employer's IdP, and Cognito's `auth_time` is the time Cognito completed the federation, which is "now" whenever the IdP answers silently from its own session. The check cannot tell a real re-authentication from a silent one, so it would pass step-up without any user interaction. Rejected as unsafe behind Cognito. |
| C. Enrol an authenticator for federated users and step up with TOTP. | The authenticator step-up is an open owner decision (section 21); doubles the enrolment UX. Rejected for this phase. |

**Ruling for the owner:** SSO-R-17 is implemented as "email code to the verified address" with the Cognito reasoning above recorded in `implementation.md`. The IdP round trip can be revisited only if the live pool shows that Cognito propagates the IdP's `AuthnInstant`/`auth_time` (a check added to the T-3.4 list).

### 4.2 OIDC assertion without `email_verified` (SSO-R-08, strategy 3.4.5 step 4)

| Approach | Trade-off |
| --- | --- |
| **A. Pending binding: keep the orphan pool user, store a pending record under an opaque handle, redirect with `bind=<handle>`, prove the mailbox with a NestSelf code, then bind and sign in. Plus a per-connection switch `oidcEmailVerifiedClaimRequired` (default `true`) that staff may turn off for an IdP that never emits the claim, after confirming with the client that its `email` claim is the directory's verified address. Chosen.** | Two new public routes and a sign-in screen branch. The switch is an operational escape hatch, documented in runbook 10.1. |
| B. Treat an on-domain OIDC address as verified always (the SAML inference extended to OIDC). | Contradicts SSO-R-08 ("for OIDC, `email_verified` must be present and `true`"). Rejected as the default; it is what the switch does per connection, by an explicit staff decision. |
| C. Create a native Cognito user for the address and reuse Cognito's `EMAIL_OTP`. | Two pool users per person and a native sign-in path opened for SSO accounts. Rejected. |

### 4.3 Throttling the SSO browser routes

| Approach | Trade-off |
| --- | --- |
| **A. `start` keyed by client IP plus connection (60/min), `callback` by client IP (120/min); throttler counters in Redis when `REDIS_URL` is set; `TRUST_PROXY_HOPS` set per stage; a 429 on these two routes becomes a 302 to `/sign-in?reason=sso_rate_limited`. Chosen.** | Rotating `connection` values multiplies the budget only across *active* connections, each of which costs one small PKCE record (TTL 600 s). The trust-proxy setting makes `X-Forwarded-For` spoofable if the ALB is reachable without CloudFront; section 6.12 names the check. |
| B. No throttle on `start`/`callback`; rely on the unguessable `state`. | Unbounded Redis writes from one client. Rejected. |
| C. Per-connection quota only (no IP). | One abusive client exhausts an employer's whole quota. Rejected. |

### 4.4 Existence oracle on confidential reads

| Approach | Trade-off |
| --- | --- |
| **A. A denied read of a confidential resource answers 404 whether the id exists or not; the denial is still audited. `readRecord` checks the access record's state before loading the target, so an inactive access answers 403 `emergency_not_active` without touching the record, and a record outside the access scope answers 404 like a missing one. Chosen.** | Two e2e expectations that assert 403 change to 404; the quick guide's copy changes. |
| B. Always 403. | Also closes the oracle but tells a member "it exists and you may not". The convention elsewhere in the API (no org visibility, 404) already points at A. Rejected. |

### 4.5 Binding cases to an organisation

| Approach | Trade-off |
| --- | --- |
| **A. A `cases(id, org_id)` table with `unique (id, org_id)`, and composite foreign keys `(case_id, org_id)` from `conversations` and `intake_records`. Chosen.** | A conversation in organisation B can no longer carry a case id that belongs to A, so the `targetId`-only CASE match becomes safe without touching `assignments`. One migration with a backfill. |
| B. An `org_id` on `assignments`. | `target_id` stays polymorphic and unbound; the leak through a shared case id remains. Rejected (may still come later for other kinds). |

### 4.6 The us-east-1 certificate for the Cognito custom domain

| Approach | Trade-off |
| --- | --- |
| **A. A context value `authCertificateArn` (certificate issued by hand in us-east-1 for `auth.<stage domain>`) plus `hostedZoneId`, the same pattern as `edgeWafArn`. Chosen.** | Two manual steps, both already the kind of step `CDK-setup.md` lists. Offline synth keeps working. |
| B. `DnsValidatedCertificate` with `region: 'us-east-1'`. | Deprecated construct with a custom-resource Lambda; still works. Rejected for now. |
| C. A us-east-1 stack with cross-region references. | The edge stack's comment records that it breaks offline synth. Rejected. |

### 4.7 Federated users on mobile

| Approach | Trade-off |
| --- | --- |
| **A. Keep the mobile PKCE flow against Cognito and add `POST /auth/sso/bind-token { idToken }` that verifies the mobile client's ID token and runs the same binding rules as the web callback; the bearer path then resolves `cognito:<provider>` identities from the access token's `username` prefix with the same connection and membership checks. Chosen.** | The mobile app makes one extra call after the exchange. Binding logic is shared with the callback. |
| B. Route mobile SSO through the API's `/auth/sso/start` and a custom-scheme return. | Changes the whole mobile token model (the API would have to mint something for the app). Rejected for scope. |

## 5. Decisions taken (the "how", as decided)

### 5.1 Contracts and schema

- `AUTH_ERROR_CODES` gains `step_up_unavailable` (403) and `sso_denied` (403, used by the new bind routes). `SSO_SIGN_IN_REASONS` gains `sso_rate_limited`.
- `InvitationImportRowReason` enum next to the import response schema: `invalid_template`, `duplicate_in_batch`, `org_unit_outside_org`, `sso_domain_claimed`, `owner_exists`, `duplicate_invitation`, `already_member`. `errors[].reason` is that enum. `skipped` counts `duplicate_invitation` and `already_member` rows only, and those rows are not in `errors`. Each row lands in exactly one of `created`, `skipped`, `errors`. A duplicate within the batch marks the later row only; the first is processed.
- `SsoConnection` create/update/response gain `oidcEmailVerifiedClaimRequired: boolean` (default `true`; 422 when set on a SAML connection, mirroring the secret rule). Shipped deviation (a recorded ruling of Task 1, kept by the final review): a SAML connection stores the switch and ignores it instead of answering 422, because the switch means nothing for SAML (the verified domain is enough) and the create schema defaults it to `true`, so the service cannot tell a value sent on a SAML create from the default (`apps/api/src/sso/sso-connections.service.ts`).
- `StepUpStartResponseSchema` gains `emailMasked: string | null` (for example `d***@acme.example`). `method` stays `email_otp` for everyone; the `sso` member of the union remains for the future and is never returned.
- `BindStartRequestSchema { handle, locale? }`, `BindStartResponseSchema { challengeToken, emailMasked }`, `BindVerifyRequestSchema { challengeToken, code }`, `BindVerifyResponseSchema { returnPath }`, `BindTokenRequestSchema { idToken }`.
- Schema and migrations (each its own file, numbered from `0007`):
  - `cases`: `id text pk`, `org_id` FK, `created_at`; `unique (id, org_id)`; RLS tenant policy + `FORCE`. Backfill from the distinct `(case_id, org_id)` pairs of both tables; then composite FKs on `conversations` and `intake_records`. `seed-lib` creates `case_sample` first. The RLS table list grows to 18.
  - `external_identities.sso_connection_id text null references sso_connections(id) on delete restrict`, backfilled by joining `provider = 'cognito:' || cognito_provider_name`; index on it.
  - `sso_connections.oidc_email_verified_claim_required boolean not null default true`.
  - `organizations.status` CHECK over the four contract values.

### 5.2 Email: a shared mailer

- New `apps/api/src/email` module (global): `Mailer` port with `send(message)`, where a message is `{ to, locale, template, params }` and templates are `invitation`, `step_up_code`, `sso_bind_code`, `ops_certificate_alert`. Adapters: `LoggingMailer` (default outside AWS; in test and stub mode it also keeps `sent[]` for assertions) and `SesMailer` (`@aws-sdk/client-ses`, `SendEmailCommand`, selected when `SES_FROM_EMAIL` is set and `NODE_ENV !== 'test'`). The invitation mailer becomes a thin caller of the port; its SES test moves with it.
- Templates live in `apps/api/src/email/templates/<template>.ts` with text and minimal HTML in all four locales, Cyrillic generated by the same transliteration as the catalogs (a script in the i18n package writes the `sr-Cyrl` entries; `pnpm check` verifies freshness). Copy mirrors the Cognito CustomMessage trigger's tone: the code, its validity, "if you did not request this, ignore it". No promises, no marketing.
- Rule (added to `CLAUDE.md`): emails are sent after the transaction that justifies them has committed; never inside it. The import collects the created invitations and sends after commit.
- CDK: `sharedEnv` of the compute stack sets `SES_FROM_EMAIL` from `config.sesFromEmail` for stages that have one, `OPS_ALERT_EMAIL` from a new `StageConfig.opsAlertEmail` (staging and production), and `TRUST_PROXY_HOPS` from `StageConfig.trustProxyHops` (2 behind CloudFront and the ALB). `NODE_ENV` becomes `production` for staging too, so `devToken` is never returned off a developer machine (the invitation email now carries the link).

### 5.3 NestSelf-issued one-time codes

- `OtpService` in `apps/api/src/auth/nestself-otp.service.ts`: `issue({ purpose, email, locale, template })` generates `EMAIL_OTP_MAX_LENGTH` decimal digits with `crypto.randomInt`, stores `otp:{purpose}:{challengeToken}` → `{ codeHash, email, attempts, issuedAt, purposeData }` for `CHALLENGE_TTL` (300 s) with the hash salted by the challenge token, mails it through the `Mailer`, and returns `{ challengeToken, emailMasked }`. `verify(purpose, challengeToken, code)` compares timing-safe, allows three attempts (`invalid_code` with the challenge kept, then `too_many_attempts` and deletion), answers `invalid_challenge` for unknown or expired tokens, and deletes the record on success. `resend(purpose, challengeToken, locale)` issues a new code for the same challenge with a 60-second cooldown (`otp_resend:{challengeToken}`; 429 `rate_limited` with `retryAfter`). In stub mode `FAKE_IDP_FIXED_OTP` fixes the code as it does for the fake IdP, so Playwright types the same code everywhere.
- Audit: `auth.code.issued { purpose, issuer: 'nestself' }` is *not* added (noise); the completing event of each flow carries `issuer: 'nestself'` in its details.

### 5.4 Step-up

- `start`: if the principal has a native identity with a live pool user, Cognito `EMAIL_OTP` as today, now with `locale: principal.locale`. Otherwise, if the principal has a federated identity, a NestSelf code to the `email` column of that `external_identities` row (the asserted address on a verified domain of the binding connection; never the user record's email, which may differ), `purpose: 'step_up'`, the challenge record carrying `userId` and `sessionId` or `tokenFamily`. With several federated identities, the one whose `ssoConnectionId` points at an `ACTIVE` connection, else the most recently seen. Otherwise 403 `step_up_unavailable`. The response carries `emailMasked`.
- `verify` dispatches on the challenge kind; the NestSelf kind has no throwaway tokens to revoke. Completion updates the session exactly as today (`markStepUp`, `regenerate`, cookies) and audits `auth.step_up.completed { method: 'email_otp', issuer }`.
- New `POST /auth/step-up/resend` (authenticated) for both kinds, with the cooldown from 5.3 (for the Cognito kind, a new `startEmailOtp` call behind the same cooldown).
- Throttles: the route-level throttle on start, verify and resend is keyed by session id (or token family for bearers) instead of IP, 10/min; it replaces the IP throttle on these routes (one decorator per route). A `StepUpThrottle` on wrong codes per user (five failures in 15 minutes → `locked`, same shape as `SignInThrottle`, reset on success) applies in addition.
- `assertStepUpFresh` keeps `method: 'email_otp'` in the 403 details (true for everyone now).
- Invitation acceptance passes the request's locale (`InvitationAcceptRequestSchema` gains `locale?`), and the web screens send it.
- Web dialog (both apps, still byte-identical): keeps the challenge on `invalid_code` (three tries), shows `emailMasked`, resend button with a 60-second countdown (the existing `auth:otp.resendCountdown` key), an in-flight guard on start, resend and verify, Cancel disabled while a verify is in flight, `step_up_unavailable` copy that tells the user what to do ("Ask your administrator"), `unavailable` (503) mapped to its own copy. Tests cover each.

### 5.5 Binding organisation on the identity

- `linkIdentity` sets `ssoConnectionId`. Path 1 denies (neutral `sso_denied`, audit `sso_provider_mismatch`) when the identity's `ssoConnectionId` is null or differs from the connection that owns the provider name, in addition to the `ACTIVE` membership check.
- The ID-token username is read as `cognito:username` first, then `username`, then `sub`; the fake token factory gains a test that emits only `cognito:username`.

### 5.6 Pending binding after an unverified OIDC email

- Callback branch (OIDC, on-domain address, `emailVerified !== true`, connection's `oidcEmailVerifiedClaimRequired` is `true`): keep the pool user; store `sso_pending_bind:{handle}` → `{ connectionId, providerName, sub, username, email, surface, returnPath, tokens (encrypted as the session encrypts them) }` for `SSO_PENDING_BIND_TTL` (900 s); audit `identity.verification_started { connectionId, emailNormalised }`; redirect to `/sign-in?reason=sso_email_unverified&bind=<handle>`. With the switch off, the on-domain address is treated as verified (same as SAML) and the normal paths 2 and 3 run.
- `POST /auth/sso/bind/start { handle, locale? }` (public, 10/min per IP): reads the pending record (kept), issues a NestSelf code (`purpose: 'sso_bind'`) to its email, answers `{ challengeToken, emailMasked }`; unknown handle → 400 `invalid_challenge`. The two lifetimes are deliberate: the code lives 300 s and the handle 900 s, so a user whose code expired calls `bind/start` again from the same screen and gets a new code without going back to the IdP. An abandoned pending binding leaves the federated pool user in place; that user can do nothing (no identity, no bearer resolution, no native flow), and the next sign-in with the same NameID reuses it and opens a new pending record. No sweeper is added.
- `POST /auth/sso/bind/verify { challengeToken, code }` (public, 10/min per IP): verifies the code, `GETDEL`s the pending record, reloads the connection (must be `ACTIVE` and the domain still verified), runs paths 2 and 3 in the connection's org scope exactly as the callback does (invitation of that organisation, else JIT if on), creates the session from the stored tokens and sets the cookies, answers `{ returnPath }`. No binding target → delete the orphan, audit `identity.denied { reason: 'no_invitation' }`, answer 403 `sso_denied`. Audit on success adds `via: 'sso_email_code'` to `identity.linked`.
- `handle` and `challengeToken` join the audit `FORBIDDEN_KEYS` and the pino redaction paths.
- Web (both apps): the sign-in route accepts `bind`; the page opens a "Confirm your email" step that calls `bind/start` on mount (once), shows the masked address, the code field, resend with countdown, errors in `FormErrorSummary`, and navigates to `returnPath` on success. `email` is removed from the route schema. The old `emailCodeOnly` path goes away.

### 5.7 Mobile federated users

- `POST /auth/sso/bind-token { idToken }` (public, 10/min per IP): verifies the ID token for the mobile client (`aws-jwt-verify`, `tokenUse: 'id'`, the mobile client id; in stub mode the same signature check the stub bearer verifier applies to access tokens, with `token_use: 'id'` required, so the fake token factory's ID tokens pass and nothing unsigned does), rejects tokens without an `identities` claim, then runs path 1 (existing identity → 204) or paths 2 and 3 under the same domain and `email_verified` rules; the unverified-OIDC case answers 403 `sso_email_unverified` (mobile shows "sign in on the web first" copy; the pending-bind screen is web only). Denied → orphan deleted, 403 `sso_denied`.
- Bearer path: the verifier passes `username`; the guard derives the provider from a known `cognito_provider_name` prefix (`<name>_`), looks the identity up under `cognito:<name>`, and applies the 5.5 checks (connection exists, `ssoConnectionId` matches, `ACTIVE` membership in its organisation). The principal gets `method: 'sso'`, `secondFactor: true` (delegated, as on the web).
- Mobile app: after the Cognito exchange and before `/auth/me`, call `bind-token`; on `sso_denied` or `sso_email_unverified` show the matching copy (`mobile` namespace) and clear the tokens.

### 5.8 Certificates and metadata

- `MetadataFetcher` port: `https:` only; the host is resolved and every address must be public unicast (reject loopback, private, link-local, CGNAT, unspecified, multicast, IPv4-mapped equivalents); 5-second timeout; `redirect: 'manual'` (a 3xx is a failure, documented: metadata URLs must be direct); body capped at 1 MiB while streaming. Fake adapter for stub mode and tests. DNS rebinding between the check and the connect is accepted and documented.
- Contracts: `metadataUrl` and `oidcIssuer` require `https:`. The service additionally refuses a non-public host at create, PATCH and test with 422 `validation`.
- The expiry is refreshed from the fetched metadata at `test`, at a PATCH that changes `metadataUrl`, and nightly for every registered SAML connection with a `metadataUrl` (metadata-XML providers keep the `describeProvider` path).
- Nightly job: a connection whose certificate expires within 30 days, or has expired, is audited as today and mailed to `OPS_ALERT_EMAIL` through the `Mailer` at most once per seven days per connection (`sso_cert_alert:{connectionId}` key, TTL 7 days); the report counts `alerted`. No `OPS_ALERT_EMAIL` → log only.
- State machine: a provider-field PATCH on `SUSPENDED` moves the connection to `TESTING` and clears `last_tested_at`, as on `ACTIVE`; a PATCH that changes `metadataXml` re-reads the expiry.

### 5.9 Throttling and proxies

- Start: `getTracker` → `ip + ':' + connection` (raw query, bounded to 32 characters), 60/min. Callback: `ip`, 120/min. A 429 on either route is turned into a 302 to the workspace `/sign-in?reason=sso_rate_limited` by the exception filter when the route carries a `@RedirectOnThrottle()` marker; the copy says to wait a minute.
- `KeyValueThrottlerStorage` implements the throttler's `ThrottlerStorage` over `KeyValueStore` (INCR, EXPIRE on first hit, `ttl` for `timeToExpire`; block handling as the memory storage does it) and is wired into `ThrottlerModule` only when `REDIS_URL` is set. Without it (local development, tests) the module keeps its default in-memory `ThrottlerStorageService`, so `test/throttler-reset.ts` and the existing 429 tests are untouched.
- `TRUST_PROXY_HOPS` per stage (5.2). Documented check before go-live: the ALB must not be reachable without CloudFront (security group restricted to the CloudFront origin-facing prefix list, or an origin header verified by the listener). The CDK task adds the prefix-list restriction if the edge or compute stack lacks it.

### 5.10 Audit in the caller's transaction

- `AuditWriter.record(input, { tx? })`. With `tx`, the row is inserted through it and an insert failure propagates (the caller's transaction rolls back; strict by construction). Without `tx`, behaviour is unchanged. The retention lookup stays on the pool.
- Every `record` call inside a `withOrgScope` or `withTransaction` callback passes its `tx` (grants, platform grants, ownership transfer, emergency request/approve/deny/revoke, members, invitations import and activation, SSO binding and connection changes, approval authorities). `actorUserId: null` workarounds for same-transaction users are removed where they existed for that reason.
- The emergency sweeper and `closeGrants` run each row in its own transaction with the audit inside, catch per row, continue, and report `failed`.

### 5.11 Cases, organisations, invitations, confidential reads, health

- `cases` per 5.1; `ProfessionalRepository` create methods and the seed insert the case first; the professional and schema specs insert cases before conversations.
- Import per 5.1; both apps map the enum to `people.import.reasons.*` (adding `ssoDomainClaimed`); the summary reads one number per bucket; the sentences and prefix matching go.
- Confidential reads per 4.4: `readConversation`/`readAssignedIntake` authorise with the loaded row and answer 404 on denial as on absence (audit `authz.denied` stays); `readRecord` order: own access record (404) → active (403 `emergency_not_active`) → load target (404) → covers (404).
- `KeyValueStore` gains `readonly kind: 'memory' | 'redis'`; the health indicator uses it; a unit test covers the 3-second timeout with fake timers.

### 5.12 Web gating and `/auth/me`

- `@Authorize` accepts an array of actions meaning "any of"; the default-deny test treats it as a decorator. `GET /orgs/:orgId/members` and `GET /orgs/:orgId/org-units` accept `['program.overview', 'access.preview']`. The access route file moves from `_hr/hr/access.tsx` to `hr/access.tsx` under `_authenticated` (URL unchanged) with `beforeLoad` on `access.preview`; the sidebar item needs `access.preview` only. The access screen's member pickers get a server-side search field (`search` param; the repository escapes `%` and `_`).
- `/auth/me`: `me()` accepts an `AbortSignal`; the initial load uses `AbortSignal.timeout(10_000)`; `resolveRouteAuth` returns `unauthenticated` only on 401; any other failure resolves to an `error` state that the authenticated layout renders as a `StatusBlock` ("We could not load your account", Retry → `ensure()` again) instead of redirecting; the admin layout does the same. Both apps get a test with a 500 and with an abort.

### 5.13 Admin SSO screen

- Organisation picker: a search field (server `search`, debounced) above the `Select`, with the first 25 matches and a "Load more" row; the table and detail panel resolve unknown names with `useOrganization`.
- The create dialog allows the protocol radio to be changed; the edit dialog offers it in `DRAFT` only (with the `fieldProtocol` error mapping) and a `oidcEmailVerifiedClaimRequired` switch with helper text for OIDC.
- `TESTING → DRAFT` reset action with a confirmation dialog ("deletes the registered provider").
- Mutations are `reset()` in the failure path too, so the secret never lingers in mutation state; the secret field is cleared after any submit.
- Test sign-in: the button mints a link and renders it as an anchor (`target="_blank" rel="noopener"`) with "single use, 15 minutes" copy; no automatic `window.open`. "New test link" mints again (and, as before, clears `lastTestedAt`).

### 5.14 Cognito custom domain (CDK only, no deploy)

- `StageConfig` gains `authDomainName` (`auth.<domainName>`; it replaces the `enableCustomDomain` flag), and the auth stack reads `authCertificateArn` and `hostedZoneId` from context when `authDomainName` is set. With both present: `addDomain('CustomDomain', { customDomain: { domainName, certificate: Certificate.fromCertificateArn(...) } })`, `ARecord` and `AaaaRecord` aliases with `UserPoolDomainTarget` in the zone from `HostedZone.fromHostedZoneAttributes`, and a real `CognitoDomain` output. Missing context on a custom-domain stage → synth fails with a message naming the two prerequisites (tests pass context).
- Documentation: the manual steps (request the certificate in us-east-1, validate it in the zone, find the zone id, an A record must exist at the parent name), and the rule that the domain is final before the first employer configures its IdP because the ACS URL and the OIDC redirect URI derive from it. The dev pool keeps the prefix domain.

### 5.15 Documentation and proof

- `implementation.md`: sections 4 (throttles, trust proxy), 6 and 9 (step-up for federated users, the SSO-R-17 ruling), 10 (`cases`), 11.1 (`access.preview` route gate), 14 (certificate job with alerts), new section "Email" (mailer, templates, after-commit rule), 17 (custom domain), 18 (new env: `OPS_ALERT_EMAIL`, `TRUST_PROXY_HOPS` per stage, `SES_FROM_EMAIL` in AWS), 19 (new suites), 21 rewritten (what is left and why), 22.2 (`SUSPENDED → TESTING`), 22.4 (binding org, pending bind, `cognito:username`), 22.8 (screen changes), 22.13 (pilot list for a real employer: domain final, OIDC claim question, MFA confirmation, throttle, mobile), 22.14 reduced to pilot-dependent items. `quick-guide.md` for the new screens. `phase-2-readiness.md` gets a "Phase 4 status" table. `CDK-setup.md`, `infra/cdk/README.md`, `e2e/README.md`, `CLAUDE.md` (email-after-commit rule, outbound-fetch rule, no addresses in URLs).
- Screenshots: the step-up dialog with the masked address, the "Confirm your email" sign-in step, the admin SSO create dialog with the search field and the claim switch, the test-link panel. PDFs rebuilt.
- **User guides (owner's request of 2026-10-30).** One short tutorial PDF per role, written from the user's point of view with numbered steps and a screenshot per step, no background or rationale: employee (sign in with a code or through the employer's sign-in, confirm the email when asked, verify identity when asked, settings, sign out), HR administrator (people, invitations and import, org units), employer owner (access: assign, delegate, revoke, transfer), expert (cases and conversations), platform staff (organisations, access and user lookup, suspend, emergency access, SSO onboarding step by step). Sources in `docs/auth/guides/<role>.md`, built by the existing PDF builder (`pnpm docs:auth:pdf` builds them too), screenshots from the Playwright screenshot project. English, like the rest of `docs/auth`; translations are a follow-up.
- Proof: unit tests per service; API e2e cases for each new route and each ruling (per-connection throttle buckets, binding-connection mismatch, pending bind end to end, bind-token, bearer resolution of a federated user, federated step-up, audit row rolled back with its change, import buckets, 404 on denied confidential reads, `readRecord` ordering, cases composite FK refusal); CDK tests for the domain and the env; Playwright journeys for the pending-bind sign-in and the federated step-up; motion suite untouched unless a new popout appears (none planned).

## 6. Points the owner should know (not decisions to make now)

1. **SSO-R-17 deviation** (4.1): federated step-up is an email code, not an IdP round trip. The reason is Cognito, not effort.
2. **OIDC claim switch** (4.2): staff can turn the `email_verified` requirement off per connection. The runbook says when.
3. **Domain before onboarding** (5.14): the Cognito custom domain must be deployed before the first employer configures its IdP, or the employer reconfigures later. Staging and production have no domain at all today.
4. **Surfaces' domain wiring is missing** (non-goal): the apex and `app.`/`admin.` names have no certificates, aliases or records in CDK. The Cognito custom domain needs an A record at the parent name.
5. **Proxy trust** (5.9): per-IP throttles only work with `TRUST_PROXY_HOPS` set, and that setting is safe only if the ALB is unreachable without CloudFront. The CDK task adds the prefix-list restriction when it is missing; please confirm after the next deploy.
6. **Mobile-first SSO users with an OIDC IdP that omits `email_verified`** are asked to sign in on the web first; the mobile pending-bind screen is out of scope.
7. **CI runs no Playwright suite.** The journeys exist and run locally; adding them to CI is a separate item.
8. **Owner decisions still open** stay in section 21: authenticator step-up for `emergency`, retention periods, presenter template, emergency approvers, staging date, SCIM, IdP-initiated.

## 7. Left to the builder

- Exact Redis key names and TTL constants beyond those named here; where the mailer templates' Cyrillic generation lives (script in `packages/i18n` or `apps/api`), as long as `pnpm check` verifies freshness.
- Migration file split and names; whether the `cases` backfill runs in the same file as the FK change (it must run before it).
- The `@Authorize` any-of implementation (array vs a second decorator), as long as the default-deny test still sees every route.
- The exception-filter marker for the redirect-on-429 behaviour.
- How the sign-in page's new step is composed from the existing `otp-screen` pieces.
- Test helper deduplication across the API e2e suites is welcome but optional.
- Ordering of tasks, subject to: contracts and schema first; mailer and OTP before step-up and pending bind; audit `tx` before the sweeper; docs last with screenshots.
