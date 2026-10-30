# Auth Phase 4: Pilot Readiness and Auth Debts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every follow-up that blocks the first real employer on enterprise SSO (throttles, federated step-up, unverified OIDC email, binding organisation, mobile federated users, certificate expiry for metadata-URL providers, the Cognito custom domain) and the auth technical debts of `implementation.md` section 21 that need no owner decision, with the documentation, screenshots and per-role tutorial PDFs that go with them.

**Architecture:** Builds on phases 1 to 3 without new dependencies. New pieces: a global `EmailModule` (`Mailer` port, logging and SES adapters, four-locale templates), a `NestselfOtpService` for API-issued email codes (federated step-up and the pending-bind flow), a `FederatedBindingService` shared by the web callback, the pending-bind routes and the mobile `bind-token` route, a `KeyValueThrottlerStorage` plus route trackers, `AuditWriter.record(input, { tx })`, a `cases` table with composite foreign keys, a `MetadataFetcher` with an SSRF guard, and the Cognito custom domain in CDK behind context values.

**Tech Stack:** As phases 2 and 3: NestJS 12, Drizzle 0.45 on PostgreSQL 17 with RLS, Redis/Valkey through `KeyValueStore`, `@nestjs/throttler` 6.7.1, `aws-jwt-verify`, `@aws-sdk/client-ses` 3.1155, zod 4 contracts, React 19 + TanStack Router (workspace, admin), Expo (mobile), `@base-ui/react` 1.9 through `@nestself/ui`, Vitest, supertest, Playwright, aws-cdk-lib 2.274.

**Spec:** `docs/superpowers/specs/2026-10-30-auth-phase-4-pilot-readiness-design.md` (sections 4 to 7 hold the decisions; section 3 the recon with file:line references against `94b524d`).

## Global Constraints

- No `pnpm install`, `pnpm add`, `npx`, `pnpm dlx` or anything that touches `pnpm-lock.yaml` or `node_modules`; no new dependencies, including workspace ones (the API does not depend on `@nestself/i18n` and must not start to).
- Every route carries `@Public()`, `@Authenticated()` or `@Authorize()`; `default-deny.test.ts` must pass. Tenant tables have RLS with `FORCE`; `test/db/schema.spec.ts` lists them.
- Audit details are sanitised (`FORBIDDEN_KEYS`, `PINO_REDACT_CONFIG`): never a token, code, handle, verifier, state, nonce, secret or assertion.
- Every user-caused failure renders translated copy in `en`, `sr-Latn`, `hu`; `sr-Cyrl` is generated (`pnpm --filter @nestself/i18n build:cyrillic`), never edited by hand; `pnpm check` must pass.
- Code lengths come from `EMAIL_OTP_MIN_LENGTH` (6) and `EMAIL_OTP_MAX_LENGTH` (8); NestSelf-issued codes are `EMAIL_OTP_MAX_LENGTH` digits.
- Timing constants: `CHALLENGE_TTL` 300 s, `PKCE_TTL` 600 s, `SSO_TEST_TTL` 900 s, new `SSO_PENDING_BIND_TTL` 900 s, `OTP_RESEND_COOLDOWN_SECONDS` 60, `STEP_UP_THROTTLE` 5 failures / 900 s, SSO start throttle 60/min per IP+connection, callback 120/min per IP, step-up routes 10/min per session, `SSO_CERTIFICATE_WARNING_DAYS` 30, `SSO_CERT_ALERT_TTL` 7 days, metadata fetch 5 s and 1 MiB, `/auth/me` timeout 10 s.
- Emails are sent after the transaction that justifies them has committed, never inside it.
- Outbound HTTP from the API is `https:` only, to public unicast addresses, with a timeout and a size cap.
- The `sso_email_unverified` redirect never carries the address; the session cookie stays `__Host-`, SSO stays SP-initiated, the verified-domain rule and the slug reservation stay.
- Motion rule for anything new that pops out (none planned); colour tokens only; no literal durations.
- Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Integration suites need `TEST_DATABASE_URL=postgresql://nestself:nestself_dev@localhost:54329/nestself_test` (`pg_isready -p 54329`; `brew services start postgresql@17` if down) and Redis on 6379 for Playwright.
- Run before each commit: `pnpm --filter <package> lint && pnpm --filter <package> typecheck && pnpm --filter <package> test` for every package touched; `pnpm check` after any i18n, token or motion change.

## Review Focus

1. **A step-up challenge token from the Cognito kind presented to the NestSelf kind (or vice versa), or a NestSelf step-up token minted for user A verified by user B.** Expected: 401 `invalid_challenge`, nothing recorded on B's session, `auth.step_up.failed { reason: 'foreign_challenge' }`. Test in Task 6.
2. **A pending-bind handle whose connection was suspended, or whose domain lost its verification, between the callback and `bind/verify`.** Expected: 403 `sso_denied`, no identity and no session created, the pending record consumed, `identity.denied { reason: 'connection_inactive' }`. Test in Task 8.
3. **A federated access token whose `username` prefix names a provider that belongs to another organisation than the identity's binding connection** (the slug-reservation defence on the bearer path). Expected: 401 `unauthenticated`, no principal, `auth.sign_in.failed { reason: 'sso_provider_mismatch' }`. Test in Task 9.
4. **A metadata URL whose host resolves to a public address at validation time and to a private one at fetch time cannot be caught; but a URL that resolves to both a public and a private address must be refused.** Expected: 422 `validation` with `details.field: 'metadataUrl'` at create and PATCH, and the nightly job counts it in `failed` without fetching. Test in Task 10.
5. **An audit insert that fails inside a grant creation transaction.** Expected: the grant is not created either (the transaction rolls back) and the caller gets a 500 with no partial state. Test in Task 4.

---

### Task 1: Contracts, schema and migrations

**Files:**
- Modify: `packages/contracts/src/auth.ts` (codes, reasons, step-up and bind schemas, `InvitationAcceptRequestSchema`), `packages/contracts/src/org-admin.ts` (import reasons), `packages/contracts/src/ops-admin.ts` (`https:` URLs, `oidcEmailVerifiedClaimRequired`), `packages/contracts/src/index.ts` (exports), tests `auth.test.ts`, `ops-admin.test.ts`, `contracts.test.ts`
- Modify: `apps/api/src/db/schema/professional.ts` (`cases` table, composite FKs), `apps/api/src/db/schema/identity.ts` (`externalIdentities.ssoConnectionId`), `apps/api/src/db/schema/invitations.ts` (`ssoConnections.oidcEmailVerifiedClaimRequired`), `apps/api/src/db/schema/organization.ts` (`status` CHECK), `apps/api/src/db/schema/index.ts`
- Create: `apps/api/drizzle/0007_cases.sql`, `0008_external_identities_sso_connection.sql`, `0009_sso_connections_oidc_claim.sql`, `0010_organizations_status_check.sql` (generated with `pnpm --filter @nestself/api db:generate`, then hand-edited: backfills, `FORCE ROW LEVEL SECURITY`), plus the journal entries `drizzle-kit` writes
- Modify: `apps/api/src/db/seed/seed-lib.ts:377-425` (insert the `cases` row before the conversation), `apps/api/src/db/repositories/professional.repository.ts` (create methods insert the case first: `createCase({ id, orgId }, tx)`), `apps/api/src/db/repositories/identity.repository.ts` (`createExternalIdentity` input gains `ssoConnectionId: string | null`), `apps/api/src/db/repositories/sso.repository.ts` (`SsoConnectionPatch` gains the flag)
- Test: `apps/api/test/db/schema.spec.ts` (migration count 11, RLS list 18 with `cases`, composite FK refusal, CHECK refusal), `apps/api/test/professional.e2e.spec.ts:355-359` and `apps/api/test/db/schema.spec.ts:260-320` (insert cases before conversations)

**Interfaces:**
- Produces (contracts): `AUTH_ERROR_CODES` += `'step_up_unavailable' | 'sso_denied'`; `SSO_SIGN_IN_REASONS` += `'sso_rate_limited'`; `INVITATION_IMPORT_ROW_REASONS = ['invalid_template','duplicate_in_batch','org_unit_outside_org','sso_domain_claimed','owner_exists','duplicate_invitation','already_member'] as const`, `InvitationImportRowReasonSchema`, `InvitationImportResponseSchema.errors[].reason: InvitationImportRowReasonSchema`; `StepUpStartResponseSchema` += `emailMasked: z.string().nullable()`; `StepUpResendRequestSchema { challengeToken: z.string().min(1) }`; `SsoBindStartRequestSchema { handle: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/), locale: LocaleSchema.optional() }`; `SsoBindStartResponseSchema { challengeToken: z.string().min(1), emailMasked: z.string().min(1) }`; `SsoBindVerifyRequestSchema { challengeToken, code: z.string().min(EMAIL_OTP_MIN_LENGTH).max(EMAIL_OTP_MAX_LENGTH) }`; `SsoBindVerifyResponseSchema { returnPath: z.string() }`; `SsoBindTokenRequestSchema { idToken: z.string().min(1).max(8192) }`; `InvitationAcceptRequestSchema` += `locale: LocaleSchema.optional()`; `httpsUrl` (a `z.string().url()` refined to start with `https://`) used by `metadataUrl` and `oidcIssuer` on create and update; `oidcEmailVerifiedClaimRequired: z.boolean().default(true)` on create, `.optional()` on update, `z.boolean()` on `SsoConnectionResponseSchema`.
- Produces (schema): `cases(id text pk, org_id text fk organizations restrict/cascade, created_at)` with `unique (id, org_id)`, policy `cases_tenant_isolation`, `.enableRLS()`; `conversations` and `intake_records` gain `foreignKey({ columns: [t.caseId, t.orgId], foreignColumns: [cases.id, cases.orgId] })`; `externalIdentities.ssoConnectionId: text().references(() => ssoConnections.id, { onDelete: 'restrict', onUpdate: 'cascade' })` nullable with `index('external_identities_sso_connection_id_idx')`; `ssoConnections.oidcEmailVerifiedClaimRequired: boolean().notNull().default(true)`; `organizations.status` gains `check('organizations_status_check', sql\`${t.status} in ('ONBOARDING','ACTIVE','SUSPENDED','ENDED')\`)`.
- Produces (repositories): `ProfessionalRepository.createCase(input: { id: string; orgId: string }, tx?: DbExecutor): Promise<void>`; `IdentityRepository.createExternalIdentity` accepts `ssoConnectionId`.

- [ ] **Step 1: Write the failing contract tests** in `packages/contracts/src/auth.test.ts` and `ops-admin.test.ts`:

```ts
it('contains the phase 4 codes and reasons', () => {
  expect(AUTH_ERROR_CODES).toEqual(expect.arrayContaining(['step_up_unavailable', 'sso_denied']));
  expect(SSO_SIGN_IN_REASONS).toContain('sso_rate_limited');
});
it('refuses an http metadata URL and an http issuer', () => {
  expect(SsoConnectionCreateRequestSchema.safeParse({ orgId: 'o', slug: 'acme', protocol: 'SAML', metadataUrl: 'http://idp.acme.example/m' }).success).toBe(false);
  expect(SsoConnectionUpdateRequestSchema.safeParse({ oidcIssuer: 'http://idp.acme.example' }).success).toBe(false);
});
it('defaults oidcEmailVerifiedClaimRequired to true on create', () => {
  expect(SsoConnectionCreateRequestSchema.parse({ orgId: 'o', slug: 'acme', protocol: 'OIDC', oidcIssuer: 'https://idp.acme.example', oidcClientId: 'c' }).oidcEmailVerifiedClaimRequired).toBe(true);
});
it('import row reasons are the enum', () => {
  expect(InvitationImportResponseSchema.safeParse({ created: 0, skipped: 0, errors: [{ email: 'a@b.c', reason: 'Invalid template key: x' }] }).success).toBe(false);
  expect(InvitationImportResponseSchema.safeParse({ created: 0, skipped: 0, errors: [{ email: 'a@b.c', reason: 'invalid_template' }] }).success).toBe(true);
});
it('bind schemas', () => {
  expect(SsoBindStartRequestSchema.safeParse({ handle: 'short' }).success).toBe(false);
  expect(StepUpStartResponseSchema.parse({ method: 'email_otp', challengeToken: 't', ssoStartUrl: null, emailMasked: 'd***@x.example' }).emailMasked).toBe('d***@x.example');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @nestself/contracts test`
Expected: FAIL (unknown exports, parse results differ)

- [ ] **Step 3: Implement the contract changes** listed in Interfaces; export every new name from `index.ts`; update the enumerations in `contracts.test.ts:430-434` and `ops-admin.test.ts:145-147` if they assert the full list.

- [ ] **Step 4: Run the contract tests and typecheck**

Run: `pnpm --filter @nestself/contracts test && pnpm --filter @nestself/contracts typecheck`
Expected: PASS

- [ ] **Step 5: Write the failing schema tests** in `apps/api/test/db/schema.spec.ts`:

```ts
it('migrations apply cleanly on a fresh database', ...) // expect 11
it('tenant tables have RLS enabled and forced', ...)   // list += 'cases', toHaveLength(18)
it('a conversation cannot point at a case of another organization', async () => {
  await owner.db.insert(cases).values({ id: 'case_fk_a', orgId: ORG_A });
  await expect(owner.db.insert(conversations).values({ ...row, caseId: 'case_fk_a', orgId: ORG_B })).rejects.toThrow(/foreign key/);
});
it('organizations.status is checked', async () => {
  await expect(owner.db.insert(organizations).values({ id: 'o_bad', name: 'x', slug: 'x', status: 'BOGUS' })).rejects.toThrow(/organizations_status_check/);
});
```

Add `createCase`/direct `cases` inserts before every existing conversation or intake insert in `schema.spec.ts:260-320` and `professional.e2e.spec.ts:355-359`.

- [ ] **Step 6: Run them to verify they fail**

Run: `cd apps/api && TEST_DATABASE_URL=... pnpm exec vitest run test/db/schema.spec.ts`
Expected: FAIL (count 7, 17 tables, inserts succeed)

- [ ] **Step 7: Implement the schema changes, generate the four migrations, hand-edit them**

`0007_cases.sql`: create table, `INSERT INTO cases (id, org_id) SELECT DISTINCT case_id, org_id FROM conversations UNION SELECT DISTINCT case_id, org_id FROM intake_records ON CONFLICT DO NOTHING`, then the two composite FKs, the policy, `ENABLE` and `FORCE ROW LEVEL SECURITY`. `0008`: add column, `UPDATE external_identities ei SET sso_connection_id = c.id FROM sso_connections c WHERE ei.provider = 'cognito:' || c.cognito_provider_name`, index, FK. `0009`: add column with default. `0010`: `ALTER TABLE organizations ADD CONSTRAINT organizations_status_check CHECK (...)`. Update `seed-lib.ts` and the repository create methods.

- [ ] **Step 8: Run the DB suites and the full API tests**

Run: `pnpm --filter @nestself/api test` (with `TEST_DATABASE_URL`)
Expected: PASS, 11 migrations, 18 RLS tables

- [ ] **Step 9: Commit**

```bash
git add packages/contracts apps/api/src/db apps/api/drizzle apps/api/test
git commit -m "feat(contracts,api): phase 4 contracts; cases table, binding connection on identities, OIDC claim switch, organization status check"
```

---

### Task 2: Email module: `Mailer` port, templates, SES and logging adapters

**Files:**
- Create: `apps/api/src/email/mailer.ts`, `apps/api/src/email/email-templates.ts`, `apps/api/src/email/render-mail.ts`, `apps/api/src/email/logging-mailer.ts`, `apps/api/src/email/ses-mailer.ts`, `apps/api/src/email/email.module.ts`, `apps/api/src/email/mask-email.ts`
- Tests: `apps/api/src/email/email-templates.test.ts`, `render-mail.test.ts`, `ses-mailer.test.ts` (move the assertions of `invitations/ses-invitation-mailer.test.ts`), `logging-mailer.test.ts`, `mask-email.test.ts`
- Modify: `apps/api/src/invitations/invitation-mailer.ts` (becomes an injectable that delegates to `Mailer`; delete `ses-invitation-mailer.ts` and `LoggingInvitationMailer`), `apps/api/src/invitations/invitations.module.ts:26-41` (drop the factory), `apps/api/src/invitations/invitations.service.ts:129-138, 276-284` (import sends after commit), `apps/api/src/app.module.ts` (import `EmailModule`), `apps/api/src/config/env.ts` (`OPS_ALERT_EMAIL: optionalEmail`), `apps/api/.env.example`
- Test: `apps/api/src/invitations/invitations.service.test.ts` (import sends after the transaction resolves; none when it throws)

**Interfaces:**
- Produces: `export type MailTemplate = 'invitation' | 'step_up_code' | 'sso_bind_code' | 'ops_certificate_alert'`; `export interface MailMessage { to: string; locale: Locale; template: MailTemplate; params: Record<string, string> }`; `export abstract class Mailer { abstract send(message: MailMessage): Promise<void> }`; `export class LoggingMailer extends Mailer { readonly sent: MailMessage[] }` (keeps `sent` only when `NODE_ENV === 'test'` or `AUTH_MODE === 'stub'`; logs subject and recipient domain, never the body); `export class SesMailer extends Mailer` with options `{ fromEmail: string; region: string; client?: Pick<SESClient, 'send'> }`; `export function renderMail(message: MailMessage): { subject: string; text: string; html: string }` (placeholders `{{name}}` replaced from `params`, HTML-escaped in `html`; unknown locale falls back to `sr-Latn`); `EMAIL_TEMPLATES: Record<MailTemplate, Record<Locale, { subject: string; text: string }>>` with params: invitation `{ link, organizationName, inviterDisplayName }`; step_up_code and sso_bind_code `{ code, minutes }`; ops_certificate_alert `{ organizationName, providerName, expiresAt, daysLeft, adminUrl }` (English only is acceptable for the ops alert: all four keys present, same copy); `export function maskEmail(email: string): string` → first character, `***`, `@`, domain (`d***@intesa.example`; a one-character local part becomes `*@`).
- `EmailModule` is `@Global()`, provides `Mailer` (SES when `SES_FROM_EMAIL` is set and `NODE_ENV !== 'test'`, region `COGNITO_REGION ?? 'eu-central-1'`, else `LoggingMailer`), exports `Mailer`.
- `InvitationMailer.send(input)` keeps its signature and calls `mailer.send({ to: input.email, locale: 'sr-Latn', template: 'invitation', params: { link: \`${workspaceUrl}/invitations/${token}\`, organizationName, inviterDisplayName } })`.

- [ ] **Step 1: Write the failing tests**

```ts
// email-templates.test.ts
import { transliterate } from '../../../../packages/i18n/scripts/transliterate-core.mjs';
it('every template has all four locales and sr-Cyrl is the transliteration of sr-Latn', () => {
  for (const [name, byLocale] of Object.entries(EMAIL_TEMPLATES)) {
    expect(Object.keys(byLocale).sort()).toEqual(['en', 'hu', 'sr-Cyrl', 'sr-Latn']);
    expect(byLocale['sr-Cyrl'].subject, name).toBe(transliterate(byLocale['sr-Latn'].subject));
    expect(byLocale['sr-Cyrl'].text, name).toBe(transliterate(byLocale['sr-Latn'].text));
  }
});
it('placeholders match across locales', ...); // same {{...}} set per template
// render-mail.test.ts
it('substitutes params and escapes html', () => {
  const out = renderMail({ to: 'a@b.c', locale: 'en', template: 'step_up_code', params: { code: '12345678', minutes: '5' } });
  expect(out.text).toContain('12345678'); expect(out.html).not.toContain('<script');
});
// ses-mailer.test.ts: SendEmailCommand input has Source=fromEmail, Destination.ToAddresses=[to], Subject/Text/Html from renderMail
// mask-email.test.ts: 'dragan@intesa.example' -> 'd***@intesa.example'; 'a@b.c' -> '*@b.c'
// invitations.service.test.ts: import -> mailer.send called only after withOrgScope resolves; a throwing transaction sends nothing
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/api && pnpm exec vitest run src/email src/invitations`
Expected: FAIL (modules missing)

- [ ] **Step 3: Implement the module, adapters, templates and the invitation changes.** Template copy mirrors `infra/cdk/lib/triggers/custom-message.ts`: the code, "expires in {{minutes}} minutes", "If you did not request this, ignore this email." (translated); no promises, no marketing. Import: collect `{ email, token }` per created row inside the transaction, send the batch after `withOrgScope` returns.

- [ ] **Step 4: Run the tests**

Run: `cd apps/api && pnpm exec vitest run src/email src/invitations && pnpm --filter @nestself/api typecheck && pnpm --filter @nestself/api lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/email apps/api/src/invitations apps/api/src/app.module.ts apps/api/src/config apps/api/.env.example
git commit -m "feat(api): shared mailer with SES and logging adapters; invitation emails after commit"
```

---

### Task 3: NestSelf-issued one-time codes

**Files:**
- Create: `apps/api/src/auth/nestself-otp.service.ts`, `apps/api/src/auth/nestself-otp.service.test.ts`
- Modify: `apps/api/src/redis/redis-keys.ts` (`OTP_RESEND_COOLDOWN_SECONDS = 60`, `otpResendKey(purpose, hash)` → `otp_resend:{purpose}:{hash}`), `apps/api/src/auth/auth.module.ts` (provide and export the service), `apps/api/src/audit/audit-writer.ts:42-73` (`FORBIDDEN_KEYS` += `'handle'`, `'challengeToken'`), `apps/api/src/audit/pino-redaction.ts` (same paths)

**Interfaces:**
- Consumes: `Mailer`, `maskEmail` (Task 2); `KeyValueStore`; `otpKey(purpose, hash)` (existing, `otp:{purpose}:{hash}`); `CHALLENGE_TTL`; `MAX_EMAIL_OTP_ATTEMPTS` (`sign-in.service.ts`); `EMAIL_OTP_MAX_LENGTH`; `FAKE_IDP_FIXED_OTP` (env, stub mode only).
- Produces: `export type OtpPurpose = 'step_up' | 'sso_bind'`; `export interface OtpIssueInput { purpose: OtpPurpose; email: string; locale: Locale; template: 'step_up_code' | 'sso_bind_code'; data: Record<string, string> }`; `NestselfOtpService.issue(input): Promise<{ challengeToken: string; emailMasked: string }>`; `verify(purpose, challengeToken, code): Promise<{ email: string; data: Record<string, string> }>` (throws `ApiHttpException` 401 `invalid_challenge` for unknown/expired/other purpose, 401 `invalid_code` with the record kept while `attempts < MAX_EMAIL_OTP_ATTEMPTS`, 429 `too_many_attempts` and deletion on the last attempt; deletes on success); `resend(purpose, challengeToken, locale): Promise<{ emailMasked: string }>` (new code, same token and deadline, 429 `rate_limited` with `details.retryAfter` seconds while the cooldown key exists). Record: `{ codeHash, email, data, attempts, expiresAt, locale, template }` under `otpKey(purpose, sha256(token))`; `codeHash = sha256(token + ':' + code)`; comparison timing-safe. Code: `randomInt(0, 10 ** EMAIL_OTP_MAX_LENGTH)` zero-padded, or `FAKE_IDP_FIXED_OTP` when set and `AUTH_MODE !== 'cognito'`.

- [ ] **Step 1: Write the failing tests** (`MemoryKeyValueStore`, `LoggingMailer`, fake timers):

```ts
it('issues an 8-digit code, mails it in the locale and masks the address', ...) // mailer.sent[0].template === 'step_up_code', params.code matches /^\d{8}$/, emailMasked 'd***@intesa.example'
it('verifies once and deletes the record', ...)         // second verify -> invalid_challenge
it('keeps the record for two wrong codes and locks on the third', ...) // invalid_code, invalid_code, too_many_attempts; then invalid_challenge
it('refuses a token of another purpose', ...)            // issued step_up, verified as sso_bind -> invalid_challenge
it('resend is refused inside the cooldown and allowed after it', ...) // 429 rate_limited retryAfter <= 60; advance 60 s; new code mailed; old code now invalid
it('uses FAKE_IDP_FIXED_OTP in stub mode', ...)
```

- [ ] **Step 2: Run to verify failure** — `cd apps/api && pnpm exec vitest run src/auth/nestself-otp.service.test.ts` → FAIL

- [ ] **Step 3: Implement the service and the key helpers; add the forbidden keys.**

- [ ] **Step 4: Run** the file, then `pnpm exec vitest run src/audit` → PASS

- [ ] **Step 5: Commit** — `git commit -m "feat(api): NestSelf-issued email codes for step-up and SSO binding"`

---

### Task 4: Audit rows in the caller's transaction; sweepers continue past failures

**Files:**
- Modify: `apps/api/src/audit/audit-writer.ts:116-150` (`record(input, opts?)`), `apps/api/src/audit/audit-writer.spec.ts`
- Modify (pass `tx`): `apps/api/src/grants/grants.service.ts:149-157, 221-229, 513, 530, 581`, `apps/api/src/emergency/emergency.service.ts:146-168, 201-209, 223-232, 242-253`, `apps/api/src/members/members.service.ts:120-137`, `apps/api/src/invitations/invitations.service.ts:265-274`, `apps/api/src/invitations/invitation-activation.service.ts:178, 195`, `apps/api/src/invitations/invitation-membership-activator.ts:123-132`, `apps/api/src/auth/sso-callback.service.ts:447-456, 481-490`, `apps/api/src/sso/sso-connections.service.ts:229, 332, 620-633`, `apps/api/src/grants/approval-authorities.service.ts:82, 122`
- Modify: `apps/api/src/jobs/maintenance-jobs.service.ts:170-237` (`closeGrants`, `sweepExpiredEmergencyAccess`: per-row `dbs.withTransaction`, try/catch, `failed` in the reports; constructor gains `DbService`), `apps/api/src/jobs/jobs.module.ts` if `DbModule` is not imported
- Tests: the eleven unit-test files whose `toHaveBeenCalledWith(event)` assertions now see a second argument (use `expect.objectContaining` or add `{ tx: expect.anything() }`), `apps/api/test/grants.e2e.spec.ts` (new case below), `maintenance-jobs.service.test.ts:197-255`

**Interfaces:**
- Produces: `AuditWriter.record(input: AuditEventInput, opts: { tx?: DbExecutor } = {}): Promise<void>`. With `tx`, the insert runs through it and any error propagates (no catch, no `strictMode` needed). Without `tx`, unchanged. `EmergencySweepReport` and `GrantReconciliationReport` gain `failed: number`.

- [ ] **Step 1: Write the failing tests**

```ts
// audit-writer.spec.ts
it('inserts through the given executor and lets its error propagate', async () => {
  repo.insertEvent.mockRejectedValueOnce(new Error('boom'));
  await expect(writer.record(event, { tx: fakeTx })).rejects.toThrow('boom');
  expect(repo.insertEvent).toHaveBeenCalledWith(expect.anything(), fakeTx);
});
it('still swallows without an executor', ...)
// grants.e2e.spec.ts (Review Focus 5)
it('a failing audit insert rolls the grant back', async () => {
  // drop INSERT on audit_events for nestself_app inside the test, call POST /orgs/:orgId/grants, expect 500, expect no new grants row, restore the privilege
});
// maintenance-jobs.service.test.ts
it('emergency sweep continues after one row fails and reports it', ...) // 3 rows, 2nd revoke throws -> expired has 2 ids, failed 1
```

- [ ] **Step 2: Run to verify failure** — `cd apps/api && pnpm exec vitest run src/audit src/jobs` → FAIL

- [ ] **Step 3: Implement** `record(input, opts)`; pass `tx` at every listed call site; per-row transactions in the two sweepers.

- [ ] **Step 4: Run the whole API suite** — `pnpm --filter @nestself/api test` → PASS (fix the `toHaveBeenCalledWith` assertions)

- [ ] **Step 5: Commit** — `git commit -m "fix(api): audit rows commit with the change they describe; sweepers continue past a failing row"`

---

### Task 5: Throttling: trackers, Redis storage, redirect on 429, trust proxy

**Files:**
- Create: `apps/api/src/redis/key-value-throttler-storage.ts` + `.spec.ts`, `apps/api/src/common/app-throttler.guard.ts` + `.test.ts`, `apps/api/src/common/redirect-on-throttle.decorator.ts`
- Modify: `apps/api/src/authz/throttles.ts` (`SSO_START_THROTTLE`, `SSO_CALLBACK_THROTTLE`, `SESSION_THROTTLE`, trackers), `apps/api/src/auth/auth.controller.ts:79-80, 157, 177` (use them; `@RedirectOnThrottle()` on `ssoStart` and `ssoCallbackRoute`), `apps/api/src/app.module.ts:66, 95` (`ThrottlerModule.forRootAsync` with the storage when `REDIS_URL` is set; `AppThrottlerGuard` as the APP_GUARD), `apps/api/src/common/api-exception.filter.ts` (`ThrottledRedirect` → 302 with `Cache-Control: no-store`)
- Test: `apps/api/test/sso-auth.e2e.spec.ts` (new cases), `apps/api/test/throttler-reset.ts` unchanged

**Interfaces:**
- Produces: `export const SSO_START_THROTTLE = { default: { limit: 60, ttl: 60_000, getTracker: ssoStartTracker } }` where `ssoStartTracker(req) = \`${ip}:${String(req.query.connection ?? '').slice(0, 32)}\``; `SSO_CALLBACK_THROTTLE = { default: { limit: 120, ttl: 60_000 } }`; `SESSION_THROTTLE = { default: { limit: 10, ttl: 60_000, getTracker: sessionTracker } }` where `sessionTracker(req) = sha256(req.session?.sessionId ?? req.principal?.tokenFamily ?? req.ip)`; `RedirectOnThrottle()` sets metadata `REDIRECT_ON_THROTTLE`; `AppThrottlerGuard extends ThrottlerGuard` overrides `throwThrottlingException` to throw `ThrottledRedirect(location)` (`location = \`${workspaceUrl}/sign-in?reason=sso_rate_limited\``, `workspaceUrl` from `WORKSPACE_URL` or the stub default) when the metadata is present, else the default; `KeyValueThrottlerStorage implements ThrottlerStorage` with `increment(key, ttl, limit, blockDuration, name)` using `store.incr(key, ttlSeconds)` and `store.ttl` (blocking as the memory storage: a `:block` key for `blockDuration`).

- [ ] **Step 1: Write the failing tests**

```ts
// key-value-throttler-storage.spec.ts: 3 increments -> totalHits 3, timeToExpire <= ttl; isBlocked after limit when blockDuration > 0
// app-throttler.guard.test.ts: handler with REDIRECT_ON_THROTTLE -> ThrottledRedirect; without -> ThrottlerException
// sso-auth.e2e.spec.ts
it('start buckets are per IP and connection', async () => { /* 60 starts for PROVIDER then one for OTHER_PROVIDER -> 302 to the IdP, not 429 */ });
it('the 61st start of one connection redirects to /sign-in?reason=sso_rate_limited', ...) // status 302, location ends with reason=sso_rate_limited, no JSON body
it('callback over its limit redirects too', ...)
```

- [ ] **Step 2: Run to verify failure** — `cd apps/api && pnpm exec vitest run src/redis src/common test/sso-auth.e2e.spec.ts` → FAIL

- [ ] **Step 3: Implement.** `forRootAsync({ imports: [RedisModule, ConfigModule], inject: [ConfigService, KEY_VALUE_STORE], useFactory: (config, store) => ({ throttlers: [{ ttl: 60_000, limit: 60 }], ...(config.get('REDIS_URL') ? { storage: new KeyValueThrottlerStorage(store) } : {}) }) })`.

- [ ] **Step 4: Run** `pnpm --filter @nestself/api test` → PASS (`throttler-reset.ts` still works: tests run without `REDIS_URL`)

- [ ] **Step 5: Commit** — `git commit -m "feat(api): SSO throttles per IP and connection, Redis-backed counters, redirect instead of JSON on 429"`

---

### Task 6: Step-up for federated users, `step_up_unavailable`, locale, resend, lockout; the web dialog

**Files:**
- Modify: `apps/api/src/auth/step-up.service.ts` (start/verify/resend), `step-up.service.test.ts`, `apps/api/src/auth/auth.controller.ts:384-415` (+ `POST step-up/resend`, `SESSION_THROTTLE` on the three routes), `apps/api/src/invitations/invitation-activation.service.ts:386` (`emailOtpStart(invitation.email, meta, body.locale)`), `invitation-activation.controller.ts` (accept body schema), `apps/api/src/auth/sign-in.service.ts` (export nothing new; reuse `MAX_EMAIL_OTP_ATTEMPTS`)
- Create: `apps/api/src/auth/step-up-throttle.ts` + test (`throttleKey('step_up', userId)`, 5 failures / 900 s, 429 `too_many_attempts`)
- Modify: `packages/api-client/src/auth.ts` (`stepUpResend(challengeToken)`; `acceptInvitation(token, locale?)`; `stepUpStart` schema already from contracts), the invitation-accept screens of both apps (pass `negotiateLocale([i18n.resolvedLanguage ?? i18n.language])`, as `sign-in-page.tsx:106` does), `apps/workspace/src/auth/step-up-dialog.tsx` and `apps/admin/src/auth/step-up-dialog.tsx` (identical), their tests, `packages/i18n/locales/{en,sr-Latn,hu}/auth.json` (`stepUp.descriptionMasked` "We sent a verification code to {{email}}.", `stepUp.unavailable` reworded to name the next step: "Verification is not available for your account. Ask your administrator.", `stepUp.resendCountdown` reuse `otp.resendCountdown`, `error.unavailable` already exists), then `build:cyrillic`
- Test: `apps/api/test/auth.e2e.spec.ts` step-up block (reset the throttler in `beforeEach`), new e2e cases below

**Interfaces:**
- Consumes: `NestselfOtpService` (Task 3), `Mailer` (Task 2), `SESSION_THROTTLE` (Task 5), `maskEmail`.
- Produces: `StepUpService.start(principal, meta, surface): Promise<StepUpStartResponse>` → native: Cognito `startEmailOtp({ email, locale: principal.locale })`, `ChallengeStore` record as today, `emailMasked: maskEmail(native.email)`; federated: `otp.issue({ purpose: 'step_up', email: federated.email, locale, template: 'step_up_code', data: { userId, target: principal.sessionId ?? \`family:${tokenFamily}\` } })`; neither → 403 `step_up_unavailable`. `verify(principal, token, code, meta)`: `challenges.consume(token)`; if null → `otp.verify('step_up', token, code)` and require `data.userId === principal.userId` (else audit `foreign_challenge`, 401 `invalid_challenge`); wrong codes go through `StepUpThrottle.recordFailure(principal.userId)` and `isLocked` is checked first (429 `too_many_attempts`); completion unchanged plus `details.issuer: 'cognito' | 'nestself'`. `resend(principal, token, locale): Promise<StepUpStartResponse>` → Cognito kind: new `startEmailOtp` behind `otpResendKey('step_up_cognito', hash)` cooldown, record re-created under a **new** token (the old one removed); NestSelf kind: `otp.resend`. Federated identity choice: `ssoConnectionId` of an `ACTIVE` connection first, else latest `lastSeenAt`.
- Web: `StepUpDialog` keeps `challengeToken` on `invalid_code` (clears only on `invalid_challenge`/`expired_code`/`too_many_attempts`), shows `emailMasked` in the description, resend button disabled while `countdown > 0` (60 s, reset on each start/resend), `busy` ref guards start/resend/verify re-entry, Cancel `disabled={submitting}`, maps `step_up_unavailable` → `auth:stepUp.unavailable`, `unavailable` → `auth:error.unavailable`, 429 → lockout copy as today.

- [ ] **Step 1: Write the failing API tests**

```ts
// step-up.service.test.ts
it('a federated-only user gets a NestSelf code to the identity email', ...) // otp.issue called with email of the cognito:AcmeSaml row, response.emailMasked, method 'email_otp'
it('a user without identities gets step_up_unavailable', ...)
it('native start passes the principal locale', ...) // startEmailOtp({ email, locale: 'hu' })
it('verify of a NestSelf code minted for another user is foreign_challenge', ...) // Review Focus 1
it('a Cognito challenge token is not accepted by the NestSelf path and vice versa', ...)
it('five wrong codes lock the user', ...) // 429 too_many_attempts on the sixth call
// auth.e2e.spec.ts
it('a federated session steps up with the mailed code and regenerates the session', ...) // sign in via federatedSignIn helper copied from sso-auth, age the session, POST step-up/start -> emailMasked, code from LoggingMailer.sent, verify 204, new cookie
it('step-up/resend inside the cooldown answers 429 rate_limited with retryAfter', ...)
it('invitation accept passes the locale to the code email', ...) // idp.sentCodes[...].locale === 'hu'
```

- [ ] **Step 2: Run to verify failure** — `cd apps/api && pnpm exec vitest run src/auth/step-up.service.test.ts test/auth.e2e.spec.ts` → FAIL

- [ ] **Step 3: Implement the API side.**

- [ ] **Step 4: Run** `pnpm --filter @nestself/api test` → PASS

- [ ] **Step 5: Write the failing web tests** in `apps/workspace/src/auth/step-up-dialog.test.tsx` (and admin):

```ts
it('keeps the challenge after one wrong code', ...)            // replaces the test at :114-127
it('shows the masked address', ...)
it('resend is disabled for 60 seconds after the code was sent', ...) // fake timers
it('does not start twice when the button is clicked twice quickly', ...)
it('Cancel is disabled while verifying', ...)
it('step_up_unavailable renders the unavailable copy', ...)
```

- [ ] **Step 6: Run to verify failure** — `pnpm --filter @nestself/workspace test -- step-up` → FAIL

- [ ] **Step 7: Implement the dialog in both apps, the api-client method, the i18n keys; run `pnpm --filter @nestself/i18n build:cyrillic`.**

- [ ] **Step 8: Run** `pnpm --filter @nestself/workspace test && pnpm --filter @nestself/admin test && pnpm check` → PASS

- [ ] **Step 9: Add the Playwright journey** to `e2e/auth/sso-sign-in.spec.ts`: Ivana also invites `it.admin@acme.example` with `templateKey: 'hr_admin'`; after activation that person signs in through the IdP (`signInAtIdpAs`), opens `/hr/access`, assigns a template; the step-up dialog shows "We sent a verification code to i***@acme.example."; typing `123456` (the stub's fixed code, now also used by the NestSelf mailer) completes the assignment. Run `pnpm e2e:auth` → PASS.

- [ ] **Step 10: Commit** — `git commit -m "feat(auth): step-up for federated users with a NestSelf email code; resend, lockout, locale; dialog fixes"`

---

### Task 7: Binding connection on the identity; `cognito:username`

**Files:**
- Modify: `apps/api/src/auth/sso-callback.service.ts:298-309` (path 1), `:460-491` (`linkIdentity` sets `ssoConnectionId: connection.id`), `sso-callback.service.test.ts`, `apps/api/src/auth/identity-resolution.service.ts:152` (`cognitoUsername: (claims['cognito:username'] as string | undefined) ?? claims.username ?? sub`), `identity-resolution.service.test.ts`, `apps/api/src/identity/fake-token-factory.ts` (test helper option to omit `username`)
- Test: `apps/api/test/sso-auth.e2e.spec.ts` (new case)

**Interfaces:**
- Consumes: `externalIdentities.ssoConnectionId` (Task 1).
- Produces: path 1 denies with `sso_provider_mismatch` when `existing.ssoConnectionId !== connection.id` (null included), in addition to the membership check.

- [ ] **Step 1: Write the failing tests**

```ts
// sso-callback.service.test.ts
it('links the identity to the connection', ...) // createExternalIdentity called with ssoConnectionId
it('an identity bound to another connection is denied even with an ACTIVE membership', ...) // neutral sso_denied, audit reason sso_provider_mismatch, deleteUser not called
// identity-resolution.service.test.ts
it('stores cognito:username when the token has no username claim', ...)
// sso-auth.e2e.spec.ts
it('a federated identity whose binding connection was moved to another row signs in nowhere', ...) // UPDATE external_identities SET sso_connection_id = other; sign in -> sso_denied
```

- [ ] **Step 2: Run to verify failure** → FAIL

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run** `pnpm --filter @nestself/api test` → PASS

- [ ] **Step 5: Commit** — `git commit -m "fix(api): federated identities remember their binding connection; session username from cognito:username"`

---

### Task 8: Pending binding after an unverified OIDC email (API and web)

**Files:**
- Create: `apps/api/src/auth/federated-binding.service.ts` (extract `bind`, `resolveOrCreateUser`, `linkIdentity`, `denyBinding`, `isDomainVerifiedFor`, `isMemberOf` from `sso-callback.service.ts`), `apps/api/src/auth/sso-bind.service.ts` + `.test.ts`
- Modify: `apps/api/src/auth/sso-callback.service.ts:330-333, 627-631` (pending record instead of deletion; `signInUrl(surface, reason, extra?: { bind?: string })`), `apps/api/src/auth/auth.controller.ts` (+ `POST sso/bind/start`, `POST sso/bind/verify`, both `@Public()`, 10/min per IP), `apps/api/src/auth/auth.module.ts`, `apps/api/src/redis/redis-keys.ts` (`SSO_PENDING_BIND_TTL = 900`, `ssoPendingBindKey(hash)` → `sso_pending_bind:{hash}`), `apps/api/src/audit/audit-events.ts` (+ `identity.verification_started`), `apps/api/src/sso/sso-connections.service.ts` (accept and store `oidcEmailVerifiedClaimRequired` on create/PATCH; audit the change)
- Modify (web, both apps): `routes/_public/sign-in.tsx` (`bind` param replaces `email`), `auth/screens/sign-in-page.tsx` (remove `emailCodeOnly`; a `bind` opens the new screen), create `auth/screens/sso-bind-screen.tsx` + test, `packages/api-client/src/auth.ts` (`ssoBindStart(handle, locale?)`, `ssoBindVerify(challengeToken, code)`), i18n `auth.json` (`ssoBind.title` "Confirm your email address", `ssoBind.instructions` "Your organisation's sign-in did not confirm {{email}}. Enter the code we sent there.", `ssoBind.submit`, `error.ssoDenied` reused, `error.ssoBindExpired` "This confirmation link has expired. Sign in again.", `error.ssoRateLimited` "Too many sign-in attempts from your network. Wait a minute and try again."; `reasonMessage` in `sign-in-page.tsx` maps `sso_rate_limited` to it)
- Test: `apps/api/test/sso-auth.e2e.spec.ts` (pending-bind end to end, Review Focus 2), `e2e/auth/sso-sign-in.spec.ts` (new journey), `e2e/screenshots/sso.shot.ts` (shot `workspace-sign-in-sso-confirm-email`)

**Interfaces:**
- Consumes: `NestselfOtpService` (`purpose: 'sso_bind'`, `template: 'sso_bind_code'`), `TokenCipher` (`src/session/token-cipher.ts`, `encrypt`/`decrypt`), `IdentityResolutionService.resolveIdentityAndCreateSession` (unchanged), `oidcEmailVerifiedClaimRequired` (Task 1), `SsoBind*` schemas (Task 1).
- Produces: `interface PendingBind { connectionId: string; providerName: string; sub: string; username: string; email: string; surface: Surface; returnPath: string | null; tokens: { accessToken: string; idToken: string; refreshToken: string; expiresIn: number } /* encrypted fields */; createdAt: string }`; `SsoBindService.start(body: SsoBindStartRequest, meta): Promise<SsoBindStartResponse>`; `verify(body: SsoBindVerifyRequest, meta): Promise<{ returnPath: string; session: { sessionId; csrfToken; absoluteExpiresAt } }>`; `FederatedBindingService.bind(tx, connection, claims, email, provider, domainVerified): Promise<Binding | null>` and `denyBinding(claims, email, connection, meta, reason)` with reason union += none (unchanged values). Callback branch: when `connection.protocol === 'OIDC' && claims.emailVerified !== true && connection.oidcEmailVerifiedClaimRequired` → store the pending record (handle = 32 random bytes base64url, key by `sha256(handle)`), audit `identity.verification_started { connectionId, emailNormalised }`, redirect `/sign-in?reason=sso_email_unverified&bind=<handle>`; when the switch is off, continue to paths 2 and 3 with `domainVerified`.

- [ ] **Step 1: Write the failing API tests**

```ts
// sso-bind.service.test.ts
it('start mails a code to the pending address and keeps the record', ...)
it('verify binds through the invitation, creates the session and answers returnPath', ...) // identity.linked details.via 'sso_email_code'
it('verify with a suspended connection answers sso_denied and consumes the record', ...) // Review Focus 2
it('verify with no invitation and JIT off deletes the orphan and answers sso_denied', ...)
it('start with an unknown handle answers invalid_challenge', ...)
// sso-callback.service.test.ts
it('an unverified on-domain OIDC email leaves the pool user in place and redirects with bind=', ...) // deleteUser not called, location has bind= and no email=
it('with oidcEmailVerifiedClaimRequired=false the on-domain address binds like SAML', ...)
// sso-auth.e2e.spec.ts
it('pending bind end to end: callback -> bind/start -> bind/verify -> session cookie', ...)
it('the redirect never carries the address', ...) // location has no `email=`
```

- [ ] **Step 2: Run to verify failure** → FAIL

- [ ] **Step 3: Implement the API side (extraction first, behaviour unchanged, tests green; then the pending flow).**

- [ ] **Step 4: Run** `pnpm --filter @nestself/api test` → PASS

- [ ] **Step 5: Write the failing web tests** (`sso-bind-screen.test.tsx`, both apps): renders the masked address after `ssoBindStart`, verifies and navigates to `returnPath`, shows `error.ssoDenied` on 403 `sso_denied`, shows `error.ssoBindExpired` on 400 `invalid_challenge` from start, resend countdown 60 s.

- [ ] **Step 6: Run to verify failure** → FAIL

- [ ] **Step 7: Implement the screens, route schemas, api-client methods and i18n; `build:cyrillic`.**

- [ ] **Step 8: Run** `pnpm --filter @nestself/workspace test && pnpm --filter @nestself/admin test && pnpm check` → PASS

- [ ] **Step 9: Add the Playwright journey** to `e2e/auth/sso-sign-in.spec.ts` (an OIDC connection with `email_verified=false` through `signInAtIdpAs` plus `&email_verified=false` on the fake authorize hop; the screen shows "Confirm your email address"; type `123456`; land on the workspace home) and the screenshot in `sso.shot.ts`. Run `pnpm e2e:auth` → PASS.

- [ ] **Step 10: Commit** — `git commit -m "feat(auth): pending binding with an email code when the OIDC provider omits email_verified; per-connection claim switch"`

---

### Task 9: Federated users on mobile: `bind-token` and bearer resolution

**Files:**
- Create: `apps/api/src/auth/id-token-verifier.ts` (`ID_TOKEN_VERIFIER` token, `IdTokenVerifier { verify(idToken: string): Promise<IdTokenClaims> }`, `CognitoIdTokenVerifier` via `aws-jwt-verify` with `tokenUse: 'id'` and `COGNITO_MOBILE_CLIENT_ID`, `StubIdTokenVerifier` via `JwtService.verifyAsync` requiring `token_use === 'id'`; both map with `toIdTokenClaims`) + tests
- Modify: `apps/api/src/auth/bearer-verifier.ts` (`BearerPayload.username?: string`), `cognito-bearer-verifier.ts:97-103` (pass `claims.username`), `stub-bearer-verifier.ts` (pass `payload.username`), `apps/api/src/auth/authentication.guard.ts:170-183, 221-231` (provider-aware lookup; `method: 'sso'`, `secondFactor: true` for federated), `authentication.guard.test.ts`, `apps/api/src/auth/auth.controller.ts` (+ `POST sso/bind-token`, `@Public()`, 10/min per IP), `apps/api/src/auth/sso-bind.service.ts` (`bindToken(body, meta): Promise<void>`), `apps/api/src/auth/auth.module.ts`
- Modify (mobile): `packages/api-client/src/auth.ts` (`ssoBindToken(idToken)`), `apps/mobile/src/auth/auth-provider.tsx:347-360` (`completeSsoSignIn` calls `ssoBindToken` before `fetchMe`), `apps/mobile/src/app/(auth)/sign-in.tsx` (`sso_denied` → `auth:error.ssoDenied`; `sso_email_unverified` → new `auth:error.ssoEmailUnverifiedMobile` "Sign in once on the web to confirm your email address, then sign in here again."), i18n keys, mobile tests if present
- Test: `apps/api/test/sso-auth.e2e.spec.ts` (bind-token cases; bearer resolution with `.overrideProvider(BEARER_VERIFIER)` returning a payload with `username: \`${PROVIDER}_${subject}\``; Review Focus 3)

**Interfaces:**
- Consumes: `FederatedBindingService` (Task 8), `IdentityRepository.findExternalIdentity(provider, sub)`, `SsoRepository.findConnectionByProviderName`.
- Produces: `SsoBindService.bindToken({ idToken }, meta)` → verify; require `claims.identities?.[0]?.providerName`; connection by that name; path 1 (identity exists → checks of Task 7 → 204) else paths 2 and 3 under the same rules (`ACTIVE` only, verified domain, OIDC claim or switch) → 204; unverified OIDC → 403 `sso_email_unverified` (orphan kept); nothing to bind → orphan deleted, 403 `sso_denied`. Guard: `resolveBearerUser(payload): Promise<{ userId; federated: boolean }>`: if `payload.username` contains `_` and the prefix before the first `_` is a `cognito_provider_name` of a connection → identity under `cognito:<prefix>` by `sub`, require identity, `identity.ssoConnectionId === connection.id` and an `ACTIVE` membership in `connection.orgId` (else 401 `unauthenticated` with audit `auth.sign_in.failed { reason: 'sso_provider_mismatch' }`); else native lookup as today.

- [ ] **Step 1: Write the failing tests**

```ts
// authentication.guard.test.ts
it('resolves a federated bearer by provider prefix and marks the principal sso with a second factor', ...)
it('refuses a federated bearer whose identity is bound to another connection', ...) // Review Focus 3
it('a native bearer still resolves under provider cognito', ...)
// id-token-verifier tests: stub accepts fake ID tokens, rejects access tokens (token_use)
// sso-auth.e2e.spec.ts
it('bind-token binds an invited mobile user and a later bearer call resolves', ...)
it('bind-token without an invitation deletes the orphan and answers sso_denied', ...)
it('bind-token with an unverified OIDC email answers sso_email_unverified and keeps the pool user', ...)
```

- [ ] **Step 2: Run to verify failure** → FAIL

- [ ] **Step 3: Implement the API side, then the mobile call and copy.**

- [ ] **Step 4: Run** `pnpm --filter @nestself/api test && pnpm --filter @nestself/mobile typecheck && pnpm --filter @nestself/mobile test && pnpm check` → PASS

- [ ] **Step 5: Commit** — `git commit -m "feat(auth): federated users on mobile bind through the API and resolve on the bearer path"`

---

### Task 10: Certificates: metadata fetcher with SSRF guard, refresh points, ops alert, `SUSPENDED → TESTING`

**Files:**
- Create: `apps/api/src/sso/public-address.ts` + test (`isPublicAddress(ip: string): boolean`), `apps/api/src/sso/metadata-fetcher.ts` + test (`METADATA_FETCHER`, `MetadataFetcher { fetchXml(url: string): Promise<string> }`, `HttpsMetadataFetcher({ lookup?, fetch?, timeoutMs = 5_000, maxBytes = 1_048_576 })`, `FakeMetadataFetcher(responses: Map<string, string>)`, `assertPublicHttpsUrl(url, lookup): Promise<void>` throwing `MetadataUrlError('scheme' | 'host' | 'private_address')`)
- Modify: `apps/api/src/identity/identity.module.ts` (provide and export `METADATA_FETCHER`: fake in stub mode), `apps/api/src/sso/sso-connections.service.ts` (create/PATCH: `assertPublicHttpsUrl` for `metadataUrl` and `oidcIssuer` → 422 `validation` with `details.field`; `test()` and a PATCH changing `metadataUrl`/`metadataXml` refresh `certificateExpiresAt` through `certificateExpiryFromMetadata(await fetcher.fetchXml(url))`; `SUSPENDED` + provider change → `TESTING`, `lastTestedAt: null`, audit `sso_connection.changed { from: 'SUSPENDED', to: 'TESTING' }`), `sso-connections.service.test.ts`, `apps/api/src/jobs/maintenance-jobs.service.ts:278-363` (metadata-URL SAML connections fetched nightly; alert through `Mailer` to `OPS_ALERT_EMAIL` with `ssoCertAlertKey(connectionId)` TTL `SSO_CERT_ALERT_TTL = 7 * 24 * 3600`; report `alerted: number`), `maintenance-jobs.service.test.ts`, `apps/api/src/redis/redis-keys.ts`, `apps/api/src/config/env.ts` (`OPS_ALERT_EMAIL` if not added in Task 2)
- Test: `apps/api/test/sso.e2e.spec.ts` (422 for `http:` and for a private host; `SUSPENDED` provider change moves to `TESTING`), `apps/api/test/jobs.e2e.spec.ts` (alert mailed once in seven days)

**Interfaces:**
- Consumes: `Mailer` (`template: 'ops_certificate_alert'`), `certificateExpiryFromMetadata` (`src/identity/saml-metadata.ts`).
- Produces: see files. The fake fetcher is seeded in tests with `SAMPLE_SAML_METADATA` (`src/identity/saml-metadata.fixture.ts`).

- [ ] **Step 1: Write the failing tests**

```ts
// public-address.test.ts: 10.0.0.1, 172.16.0.1, 192.168.1.1, 127.0.0.1, 169.254.169.254, 100.64.0.1, 0.0.0.0, ::1, fc00::1, fe80::1, ::ffff:10.0.0.1 -> false; 203.0.113.10, 2001:db8::1 -> true
// metadata-fetcher.test.ts: http -> scheme; host resolving to [public, private] -> private_address (Review Focus 4); 3xx -> error; body > 1 MiB -> error; timeout -> error
// sso-connections.service.test.ts: create with metadataUrl on a private host -> 422 field metadataUrl; test() stores the fetched expiry; SUSPENDED + metadataXml change -> TESTING, lastTestedAt null, expiry refreshed
// maintenance-jobs.service.test.ts: metadata-URL connection gets its expiry from the fetcher; within 30 days -> mailer.sent has one ops_certificate_alert; second run same day -> none; fetcher throwing -> failed + 1 and no fetch retry in the same run
```

- [ ] **Step 2: Run to verify failure** → FAIL

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run** `pnpm --filter @nestself/api test` → PASS

- [ ] **Step 5: Commit** — `git commit -m "feat(api): metadata fetcher with SSRF guard, certificate expiry for metadata-URL providers, ops alert email, SUSPENDED provider changes need a new test"`

---

### Task 11: Admin SSO screen

**Files:**
- Create: `apps/admin/src/features/organizations/organization-picker.tsx` + test (search `Input` debounced 300 ms over `useOrganizationPages(opsApi, enabled, search)`, `Select` of the loaded names, "Load more" button while `hasNextPage`)
- Modify: `apps/admin/src/features/sso/create-connection-dialog.tsx` (picker; `oidcEmailVerifiedClaimRequired` `Switch` shown for OIDC with helper text; `create.reset()` in the catch too; secret cleared after any submit), `edit-connection-dialog.tsx` (protocol `RadioGroup` enabled only in `DRAFT`; the claim switch; `update.reset()` in the catch; `fieldName` gets `protocol`), `connection-detail.tsx:97-105, 160-225` (test link: button mints and renders the anchor, no `window.open`; "New test link"; `TESTING → DRAFT` "Reset to draft" with `AlertDialog`), `sso-screen.tsx:41-56` (`useOrganization` fallback for names outside the loaded pages), `features/sso/sso-errors.ts`, tests of each file, i18n `admin.json` (`sso.create.oidcClaimRequired` "Require a verified email claim from the provider", `sso.create.oidcClaimRequiredHint` "Turn off only after the client confirms that its email claim is the directory's verified address.", `sso.actions.reset`, `sso.actions.resetConfirm`, `sso.actions.testLinkNote` "Single use, valid 15 minutes.", `sso.actions.newTestLink`, `sso.create.organizationSearch`, `sso.create.loadMore`), `build:cyrillic`
- Test: `e2e/screenshots/sso.shot.ts` (new shots `admin-sso-create-connection` refreshed, `admin-sso-test-link`)

**Interfaces:**
- Consumes: `oidcEmailVerifiedClaimRequired` on the SSO contracts (Task 1), `GET /ops/organizations?search=` (existing).

- [ ] **Step 1: Write the failing tests**

```ts
// organization-picker.test.tsx: typing filters through the API (search param), Load more appends
// create-connection-dialog.test.tsx: OIDC shows the claim switch defaulting on; a failed create resets the mutation (create.variables undefined) and clears the secret field
// edit-connection-dialog.test.tsx: protocol radio disabled unless DRAFT; claim switch PATCHes the flag
// connection-detail.test.tsx: Test sign-in renders the link anchor and does not call window.open; Reset to draft confirms then PATCHes status DRAFT
```

- [ ] **Step 2: Run to verify failure** → FAIL

- [ ] **Step 3: Implement; `build:cyrillic`.**

- [ ] **Step 4: Run** `pnpm --filter @nestself/admin test && pnpm --filter @nestself/admin typecheck && pnpm check` → PASS

- [ ] **Step 5: Commit** — `git commit -m "feat(admin): SSO page: organisation search, protocol change in draft, reset to draft, claim switch, single-use test link"`

---

### Task 12: Invitation import buckets, `@Authorize` any-of, member search escaping

**Files:**
- Modify: `apps/api/src/invitations/invitations.service.ts:147-289` (reason enum, one bucket per row, duplicates keep the first row, no `errorEmails` filter), `invitations.service.test.ts:137-152, 290-352`, `apps/api/test/invitations.e2e.spec.ts:235-252`
- Modify: `apps/api/src/authz/authorize.decorator.ts` (`Authorize(action: Action | readonly Action[], resolver)`; metadata `{ actions: Action[], resolver }`), `apps/api/src/authz/authorization.guard.ts:67-118` (evaluate in order; allowed if any; step-up class of the allowing action; audit `actionAttempted: actions[0]`, `details.alternatives: actions`), `authorization.guard.test.ts`, `default-deny.test.ts` (unchanged semantics), `apps/api/src/members/members-admin.controller.ts:40-41` and `apps/api/src/org-units/org-units.controller.ts:41-42` (`[ACTIONS['program.overview'], ACTIONS['access.preview']]`), `apps/api/src/db/repositories/memberships.repository.ts:127-134` (escape `%`, `_`, `\\` like `organizations.repository.ts:24-26`)
- Test: `apps/api/test/members.e2e.spec.ts` (an owner-only principal with `access.preview` lists members and org units; a plain employee still gets 403), `memberships.repository` spec for the escape

- [ ] **Step 1: Write the failing tests**

```ts
// invitations.service.test.ts
it('a duplicate within the batch marks only the later row and creates the first', ...) // created 1, errors [{ reason: 'duplicate_in_batch' }]
it('each row lands in exactly one bucket', ...) // pending -> skipped 1, errors []
it('row reasons are codes', ...) // 'invalid_template', 'org_unit_outside_org'
// authorization.guard.test.ts
it('allows when any of the listed actions is allowed', ...)
it('denies and audits the first action when none is allowed', ...)
// members.e2e.spec.ts: owner-only member with access.preview -> 200 on GET members and org-units
```

- [ ] **Step 2: Run to verify failure** → FAIL

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run** `pnpm --filter @nestself/api test` → PASS (default-deny still green)

- [ ] **Step 5: Commit** — `git commit -m "fix(api): import rows land in one bucket with coded reasons; Authorize accepts alternatives; member search escapes wildcards"`

---

### Task 13: Confidential reads without an existence oracle; health indicator

**Files:**
- Modify: `apps/api/src/authz/authorization.service.ts:35-78` (`require(principal, action, resource, opts: { denyAs?: 'not_found' } = {})`), `apps/api/src/professional/professional.service.ts:109-114, 143-148` (`denyAs: 'not_found'`), `apps/api/src/emergency/emergency.service.ts:262-295` (order: own access → `isActive` else 403 `emergency_not_active` → load → `covers` else 404), `apps/api/test/professional.e2e.spec.ts:250-258` (staff get 404), `apps/api/test/emergency.e2e.spec.ts:245-269` (inactive access → 403 before the record lookup; a record outside the scope → 404)
- Modify: `apps/api/src/redis/key-value-store.ts` (`readonly kind: 'memory' | 'redis'`), `memory-key-value-store.ts`, `redis-key-value-store.ts`, `redis-health.indicator.ts:32` (use `store.kind`), create `redis-health.indicator.test.ts` (a `ping` that never resolves → the check fails within `REDIS_HEALTH_TIMEOUT_MS` under fake timers; `kind` reported)

- [ ] **Step 1: Write the failing tests** (listed above)

- [ ] **Step 2: Run to verify failure** → FAIL

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run** `pnpm --filter @nestself/api test` → PASS

- [ ] **Step 5: Commit** — `git commit -m "fix(api): denied confidential reads answer 404; emergency record order; health indicator reports the store kind"`

---

### Task 14: Web: access route gate, `/auth/me` resilience, import reasons, member search

**Files:**
- Move: `apps/workspace/src/routes/_authenticated/_hr/hr/access.tsx` → `apps/workspace/src/routes/_authenticated/hr/access.tsx` (gate `access.preview` only; regenerate the route tree), `apps/workspace/src/routes/_authenticated.tsx:69-71, 88-90` (`showAccess = can(access.preview)`), `apps/workspace/src/features/access/access-screen.test.tsx:893-909`, `e2e/auth/hr-access.spec.ts:82`
- Modify: `apps/workspace/src/features/access/use-org-admin.ts:44-53` (members query takes `search`), `access-screen.tsx` (a search `Input` above each member `Select`, debounced), tests
- Modify (both apps): `packages/api-client/src/auth.ts:81-85` (`me(init?: { signal?: AbortSignal })`), `auth/route-auth.ts` (`ME_TIMEOUT_MS = 10_000`; `initialMe` passes `AbortSignal.timeout`; `initialSnapshot` throws `SessionUnavailableError` for any non-401 failure), `routes/_authenticated.tsx` (`errorComponent` renders `StatusBlock state="offline"` with `common:state.sessionUnavailable.title/body` and `action: { label: common:action.retry, onClick: () => router.invalidate() }`), `auth/auth-provider.tsx:51-64` (`status: 'error'` on non-401), tests `route-auth.test.ts` (500 → throws; abort → throws; 401 → signed-out snapshot), `_authenticated` route test (error component shown, Retry refetches), i18n `common.json` (`state.sessionUnavailable`: "We could not load your account" / "Check your connection and try again.")
- Modify (both apps): `features/people/people-errors.ts:83-93` (map the enum: `invalid_template → invalidTemplate`, `duplicate_in_batch → duplicateInBatch`, `org_unit_outside_org → invalidOrgUnit`, `sso_domain_claimed → ssoDomainClaimed` (new key), others unchanged), `people-errors.test.ts`, `import-dialog.tsx:99-105` (summary unchanged, counts now correct), i18n `people.import.reasons.ssoDomainClaimed` "The address belongs to an organisation that signs in through its own identity provider."

- [ ] **Step 1: Write the failing tests** (listed per file)

- [ ] **Step 2: Run to verify failure** → FAIL

- [ ] **Step 3: Implement; `build:cyrillic`.**

- [ ] **Step 4: Run** `pnpm --filter @nestself/workspace test && pnpm --filter @nestself/admin test && pnpm --filter @nestself/api-client test && pnpm check && pnpm e2e:auth` → PASS

- [ ] **Step 5: Commit** — `git commit -m "fix(web): access page for owners without HR rights; visible error when the session cannot load; coded import reasons; member search"`

---

### Task 15: CDK: Cognito custom domain, environment, ALB restricted to CloudFront

**Files:**
- Modify: `infra/cdk/lib/config.ts` (`authDomainName: string | undefined` (staging `auth.staging.nestself.rs`, production `auth.nestself.rs`), `trustProxyHops: number` (dev 0, staging and production 2)), `infra/cdk/lib/auth-stack.ts:89-104, 472-476` (context `authCertificateArn`, `hostedZoneId`; `addDomain('CustomDomain', { customDomain: { domainName, certificate: acm.Certificate.fromCertificateArn(...) } })`; `route53.ARecord` and `AaaaRecord` with `targets.UserPoolDomainTarget` in `HostedZone.fromHostedZoneAttributes({ hostedZoneId, zoneName: config.domainName })`; output `https://${authDomainName}`; a missing context value on a custom-domain stage throws `Error('auth custom domain needs context authCertificateArn and hostedZoneId; see CDK-setup.md')`), `infra/cdk/lib/compute-stack.ts:68-73, 133-147` (`SES_FROM_EMAIL` when `config.sesFromEmail`, `OPS_ALERT_EMAIL` from context `opsAlertEmail` when present, `TRUST_PROXY_HOPS: String(config.trustProxyHops)`, `NODE_ENV: 'production'` for every stage; ALB ingress from `ec2.Peer.prefixList(context cloudfrontOriginPrefixListId)` when `trustProxyHops > 0`, required then, `anyIpv4` otherwise), `infra/cdk/bin/app.ts` if context is read there
- Tests: `infra/cdk/test/auth-stack.test.ts` (production with context: `AWS::Cognito::UserPoolDomain` with `CustomDomainConfig.CertificateArn`, two `AWS::Route53::RecordSet` for `auth.nestself.rs` of types A and AAAA, output value `https://auth.nestself.rs`; without context: synth throws), `compute-stack.test.ts` (env vars present; ALB SG ingress uses the prefix list in production, `0.0.0.0/0` in dev), `nag.test.ts` still green
- Docs: `CDK-setup.md` (new steps: request the us-east-1 certificate, validate it in the zone, read the zone id and the CloudFront origin-facing prefix list id (`aws ec2 describe-managed-prefix-lists --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing`), an A record must exist at the parent name, pass `-c authCertificateArn=... -c hostedZoneId=... -c cloudfrontOriginPrefixListId=... -c opsAlertEmail=...`), `infra/cdk/README.md`

- [ ] **Step 1: Write the failing CDK tests** (listed above; pass context through `new cdk.App({ context: { ... } })`)

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @nestself/cdk test` → FAIL

- [ ] **Step 3: Implement; update the two docs.**

- [ ] **Step 4: Run** `pnpm --filter @nestself/cdk test && pnpm --filter @nestself/cdk typecheck` → PASS. Do not deploy.

- [ ] **Step 5: Commit** — `git commit -m "feat(infra): Cognito custom domain behind context, API email and proxy settings, ALB reachable from CloudFront only"`

---

### Task 16: Documentation, screenshots and PDFs

**Files:**
- Modify: `docs/auth/implementation.md` (sections 4, 6, 9, 10, 11.1, 14, 17, 18, 19, 21 rewritten, 22.2, 22.4, 22.8, 22.9, 22.13, 22.14; new section 23 "Email" after 22; the stale `self_end` note and the 22.14 nonce sentence corrected; the `cases` TODOs removed from `schema/professional.ts` header comments), `docs/auth/quick-guide.md` (sign-in with the confirm-email step, step-up for federated users, what is not done yet), `docs/tasks/auth/phase-2-readiness.md` (a "Phase 4 status" table: task, status, commits), `e2e/README.md` (new journeys and shots), `CLAUDE.md` (three rules: email after commit; outbound fetch guard; no addresses in URLs), `apps/api/.env.example`
- Modify: `e2e/screenshots/workspace.shot.ts` (step-up dialog with the masked address), `sso.shot.ts` (confirm-email step, test-link panel, create dialog with search and the claim switch), `workspace-screens.shot.ts:20-25, 56-66` (import result captions)
- Run: `pnpm docs:auth:screenshots`, `pnpm docs:auth:pdf`

- [ ] **Step 1: Update the screenshot scripts, run them, check every new PNG by eye (Read the files).**

- [ ] **Step 2: Write the documentation changes.** Every claim names the file that implements it; every removed follow-up names the task that closed it; every remaining follow-up (section 21) carries a reason (owner decision, pilot, AWS, out of scope).

- [ ] **Step 3: Build the PDFs** — `pnpm docs:auth:pdf` → both files rebuilt; open page 1 of each (Read) to confirm.

- [ ] **Step 4: Commit** — `git commit -m "docs(auth): phase 4 documented; screenshots and PDFs rebuilt"`

---

### Task 17: User guides: one tutorial PDF per role

**Files:**
- Create: `docs/auth/guides/employee.md`, `hr-admin.md`, `employer-owner.md`, `expert.md`, `platform-staff.md`, `README.md` (index with one line per guide), the PDFs next to them
- Create: `e2e/screenshots/guides.shot.ts` for screens no guide has yet (sign-in identifier with a work address typed, code screen, the confirm-email step, settings, sign-out menu, HR people invite dialog, import dialog, org units add, access assign/delegate/revoke/transfer dialogs, expert case list and conversation, admin organisations, user lookup, suspend, emergency request and approve, SSO create/domains/verify/test/activate); reuse existing PNGs where they fit
- Modify: `package.json` scripts (`docs:auth:pdf` also builds every `docs/auth/guides/*.md` to its PDF), `docs/auth/pdf/build.mjs` only if a guide needs a different page style (prefer none)

**Format rules (from the owner, 2026-10-30):** no background, no rationale, no option lists. Each guide: a one-line "Who this is for", then numbered steps, each step one imperative sentence ("Type your work email address and press Continue."), a screenshot under the step where the screen changes, and a one-line "If it fails" note under the step only where the product shows an error (the exact on-screen copy, e.g. "Your organisation has not enabled your account yet. Ask your HR administrator." → "ask HR to invite you"). English, under four pages each. Fictional people only (`shot()` enforces it).

Contents:
- **Employee:** sign in with a code; sign in through your organisation (SSO); confirm your email when asked; verify your identity when asked (step-up); change language and name; sessions and sign out everywhere; sign out.
- **HR administrator:** people list; invite one person; import a list (and read the result: created, skipped, not imported); revoke an invitation; move a person; end a membership; org units: add, rename, move.
- **Employer owner:** open Access; assign a template; delegate; preview someone's effective access; revoke; transfer ownership; what verify-your-identity means here.
- **Expert:** open Cases; open a conversation; read the intake; what you cannot see.
- **Platform staff:** sign in with password and authenticator; organisations; a client's people and access; look up a user's access; suspend and reinstate; emergency access: request, approve, open a record; SSO onboarding, one step per screen: create the connection, add the domain, give the client the TXT record and the ACS URL and entity ID, verify, test sign-in (single-use link), activate, suspend, reset to draft; what to tell the client about `email_verified`.

- [ ] **Step 1: Write `guides.shot.ts`, run `pnpm docs:auth:screenshots`, check each PNG (Read).**

- [ ] **Step 2: Write the five guides and the index in the format above.**

- [ ] **Step 3: Build** — `pnpm docs:auth:pdf` → five new PDFs; open each (Read, pages 1-2) and check that every image rendered and no page is blank.

- [ ] **Step 4: Commit** — `git commit -m "docs(auth): per-role tutorial guides with screenshots, as PDFs"`

---

## Execution notes

- Order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17. Tasks 11, 12, 13, 14 and 15 are independent of each other once 1 to 10 are in and may be run by parallel workers in separate worktrees of this branch only if they do not touch the same files (11 is admin only, 12 and 13 are API only, 14 is web only, 15 is CDK only).
- After Task 17: whole-branch review (superpowers:requesting-code-review), then `superpowers:finishing-a-development-branch` (push `feat/auth-p2`, open the PR with the design and plan linked, update the memory file `auth-phase-4-state`).
