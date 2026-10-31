/**
 * SsoBindService unit tests: the pending binding after an unverified OIDC
 * email (phase 4 design 5.6) with the real NestselfOtpService, the real
 * PendingBindStore over the in-memory key-value store, the real
 * FederatedBindingService and fake identity provider, and repository fakes.
 * Covers Review Focus 2 (a connection or domain that stopped vouching between
 * the callback and the code).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { ApiHttpException } from '../common/api-error.js';
import { LoggingMailer } from '../email/logging-mailer.js';
import { FakeIdentityProvider } from '../identity/fake-identity-provider.js';
import { createFakeTokenSet } from '../identity/fake-token-factory.js';
import { InvitationMembershipActivator } from '../invitations/invitation-membership-activator.js';
import { MemoryKeyValueStore } from '../redis/memory-key-value-store.js';
import { TokenCipher } from '../session/token-cipher.js';
import { FederatedBindingService } from './federated-binding.service.js';
import { NestselfOtpService } from './nestself-otp.service.js';
import { PendingBindStore, pendingBindId } from './pending-bind-store.js';
import { SsoBindService } from './sso-bind.service.js';

const PROVIDER = 'org-acme-oidc';
const EMAIL = 'maria@acme.example';
const SUB = '5f0c2f4e-0000-4000-8000-000000000001';
const USERNAME = `${PROVIDER}_idp-maria`;
const META = { ip: '127.0.0.1', userAgent: 'vitest' };
const KEY = 'ab'.repeat(32);

type Conn = {
  id: string;
  orgId: string;
  cognitoProviderName: string;
  protocol: 'SAML' | 'OIDC';
  status: 'DRAFT' | 'TESTING' | 'ACTIVE' | 'SUSPENDED';
  jitProvisioning: boolean;
  oidcEmailVerifiedClaimRequired: boolean;
  defaultOrgUnitId: string | null;
};

function connection(overrides: Partial<Conn> = {}): Conn {
  return {
    id: 'conn_1',
    orgId: 'org_sample',
    cognitoProviderName: PROVIDER,
    protocol: 'OIDC',
    status: 'ACTIVE',
    jitProvisioning: false,
    oidcEmailVerifiedClaimRequired: true,
    defaultOrgUnitId: 'unit_1',
    ...overrides,
  };
}

function invitation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv_1',
    email: EMAIL,
    orgId: 'org_sample',
    orgUnitId: 'unit_2',
    templateKey: 'employee',
    invitedByUserId: 'user_ivana',
    acceptedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

type DomainRow = { connectionId: string; verifiedAt: Date | null; domain: string } | null;

function setup(opts: { conn?: Conn | null; domain?: DomainRow } = {}) {
  const store = new MemoryKeyValueStore();
  const cipher = new TokenCipher({ get: (key: string) => (key === 'SESSION_ENCRYPTION_KEY' ? KEY : undefined) } as never);
  const pendingBinds = new PendingBindStore(store, cipher);
  const mailer = new LoggingMailer({ keepSent: true });
  const otp = new NestselfOtpService(store, mailer, { get: (_key: string, fallback?: string) => fallback } as never);
  const idp = new FakeIdentityProvider({ apiPublicUrl: 'http://api.test' });
  const conn = opts.conn === undefined ? connection() : opts.conn;
  const domain: DomainRow =
    opts.domain === undefined ? { connectionId: 'conn_1', verifiedAt: new Date(), domain: 'acme.example' } : opts.domain;
  const sso = {
    findConnection: vi.fn(async (id: string) => (conn && conn.id === id ? { ...conn, domains: [] } : null)),
    findDomainByName: vi.fn(async (name: string) => (name === 'acme.example' ? domain : null)),
  };
  const tx = {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'membership_1' }]) }),
    }),
  };
  const dbs = { withOrgScope: vi.fn(async (_org: string, fn: (t: unknown) => Promise<unknown>) => fn(tx)) };
  const identities = {
    findUserByEmail: vi.fn().mockResolvedValue(null),
    createUser: vi.fn().mockResolvedValue({ id: 'user_new' }),
    createExternalIdentity: vi.fn().mockResolvedValue({}),
  };
  const invitations = {
    findPendingByEmailAndOrg: vi.fn().mockResolvedValue(null),
    accept: vi.fn().mockResolvedValue({}),
  };
  const memberships = { findByUserId: vi.fn().mockResolvedValue([]) };
  const authz = { createGrant: vi.fn().mockResolvedValue({}), findActiveOwnerGrants: vi.fn().mockResolvedValue([]) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const activator = new InvitationMembershipActivator(
    invitations as never, memberships as never, authz as never, audit as never,
  );
  const binding = new FederatedBindingService(
    idp, sso as never, identities as never, invitations as never, activator, audit as never, memberships as never,
  );
  const principalLoader = { invalidateUser: vi.fn().mockResolvedValue(undefined) };
  const identity = {
    resolveIdentityAndCreateSession: vi.fn().mockResolvedValue({
      sessionId: 'sess_1', csrfToken: 'csrf_1', absoluteExpiresAt: new Date('2026-11-01'),
    }),
  };
  const deleteUser = vi.spyOn(idp, 'deleteUser').mockResolvedValue();
  const service = new SsoBindService(
    otp, pendingBinds, sso as never, dbs as never, binding, audit as never, principalLoader as never, identity as never,
  );
  return {
    service, store, pendingBinds, mailer, idp, sso, dbs, tx, identities, invitations, audit, principalLoader, identity, deleteUser,
  };
}

type Ctx = ReturnType<typeof setup>;

/** What the callback stores for an unverified OIDC sign-in; answers the handle and the token set. */
async function openPending(ctx: Ctx, overrides: { returnPath?: string | null; surface?: 'workspace' | 'admin' } = {}) {
  const tokens = createFakeTokenSet(SUB, USERNAME);
  const handle = await ctx.pendingBinds.open({
    connectionId: 'conn_1',
    providerName: PROVIDER,
    sub: SUB,
    username: USERNAME,
    email: EMAIL,
    surface: overrides.surface ?? 'workspace',
    returnPath: overrides.returnPath === undefined ? '/people' : overrides.returnPath,
    tokens,
  });
  return { handle, tokens };
}

/** `start`, then the code the mail carried. */
async function startAndReadCode(ctx: Ctx, handle: string) {
  const started = await ctx.service.start({ handle }, META);
  return { challengeToken: started.challengeToken, code: ctx.mailer.sent.at(-1)!.params.code! };
}

async function refusal(promise: Promise<unknown>): Promise<ApiHttpException> {
  const err = await promise.then(
    () => {
      throw new Error('expected the call to be refused');
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiHttpException);
  return err as ApiHttpException;
}

async function expectRefused(promise: Promise<unknown>, status: number, code: string): Promise<void> {
  const err = await refusal(promise);
  expect(err.getStatus()).toBe(status);
  expect(err.code).toBe(code);
}

function auditActions(ctx: Ctx): string[] {
  return ctx.audit.record.mock.calls.map((c) => (c[0] as { action: string }).action);
}

function auditEvent(ctx: Ctx, action: string): { details: Record<string, unknown> } & Record<string, unknown> {
  const call = ctx.audit.record.mock.calls.find((c) => (c[0] as { action: string }).action === action);
  if (!call) throw new Error(`no ${action} audit event`);
  return call[0] as { details: Record<string, unknown> } & Record<string, unknown>;
}

describe('SsoBindService', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.useRealTimers());

  describe('start', () => {
    it('start mails a code to the pending address and keeps the record', async () => {
      const ctx = setup();
      const { handle } = await openPending(ctx);

      const started = await ctx.service.start({ handle, locale: 'hu' }, META);

      expect(started).toEqual({ challengeToken: expect.any(String), emailMasked: 'm***@acme.example' });
      expect(ctx.mailer.sent).toHaveLength(1);
      expect(ctx.mailer.sent[0]).toMatchObject({ to: EMAIL, template: 'sso_bind_code', locale: 'hu' });
      // The pending binding stays: a code lives 5 minutes, the handle 15, so a new start works.
      expect(await ctx.pendingBinds.peek(pendingBindId(handle))).toMatchObject({ email: EMAIL, connectionId: 'conn_1' });
      const again = await ctx.service.start({ handle }, META);
      expect(again.challengeToken).not.toBe(started.challengeToken);
      expect(ctx.mailer.sent).toHaveLength(2);
    });

    it('writes the mail in sr-Latn when the page sent no locale', async () => {
      const ctx = setup();
      const { handle } = await openPending(ctx);
      await ctx.service.start({ handle }, META);
      expect(ctx.mailer.sent[0]).toMatchObject({ locale: 'sr-Latn' });
    });

    it('start with an unknown handle answers invalid_challenge', async () => {
      const ctx = setup();
      await expectRefused(ctx.service.start({ handle: 'u'.repeat(43) }, META), 400, 'invalid_challenge');
      expect(ctx.mailer.sent).toHaveLength(0);
    });
  });

  describe('verify', () => {
    it('verify binds through the invitation, creates the session and answers returnPath', async () => {
      // Time stands still, so the stored tokens come back with their whole lifetime.
      vi.useFakeTimers({ toFake: ['Date'] });
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const { handle, tokens } = await openPending(ctx);
      const { challengeToken, code } = await startAndReadCode(ctx, handle);

      const result = await ctx.service.verify({ challengeToken, code }, META);

      expect(result).toEqual({
        returnPath: '/people',
        session: { sessionId: 'sess_1', csrfToken: 'csrf_1', absoluteExpiresAt: new Date('2026-11-01') },
      });
      expect(ctx.dbs.withOrgScope).toHaveBeenCalledWith('org_sample', expect.any(Function));
      expect(ctx.identities.createExternalIdentity).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user_new',
          provider: `cognito:${PROVIDER}`,
          subject: SUB,
          cognitoUsername: USERNAME,
          email: EMAIL,
          emailVerified: true,
          ssoConnectionId: 'conn_1',
        }),
        ctx.tx,
      );
      expect(ctx.invitations.accept).toHaveBeenCalledWith('inv_1', expect.any(Date), 'user_new', ctx.tx);
      expect(auditEvent(ctx, 'identity.linked').details).toEqual({
        emailNormalised: EMAIL,
        provider: `cognito:${PROVIDER}`,
        via: 'sso_email_code',
        connectionId: 'conn_1',
      });
      expect(auditEvent(ctx, 'invitation.accepted')).toMatchObject({
        actorUserId: 'user_new',
        orgId: 'org_sample',
        recordId: 'inv_1',
        details: { emailNormalised: EMAIL, templateKey: 'employee', via: 'sso_email_code', connectionId: 'conn_1' },
      });
      expect(ctx.principalLoader.invalidateUser).toHaveBeenCalledWith('user_new', ['org_sample']);
      // The session comes from the tokens of the original code exchange, decrypted.
      expect(ctx.identity.resolveIdentityAndCreateSession).toHaveBeenCalledWith(
        tokens, EMAIL, 'workspace', META, false, true, PROVIDER,
      );
      // Single use: the pending binding is gone.
      expect(await ctx.pendingBinds.peek(pendingBindId(handle))).toBeNull();
      expect(ctx.deleteUser).not.toHaveBeenCalled();
    });

    it('answers / when the sign-in had no return path, and keeps the surface', async () => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const { handle } = await openPending(ctx, { returnPath: null, surface: 'admin' });
      const result = await ctx.service.verify(await startAndReadCode(ctx, handle), META);
      expect(result.returnPath).toBe('/');
      expect(ctx.identity.resolveIdentityAndCreateSession).toHaveBeenCalledWith(
        expect.anything(), EMAIL, 'admin', META, false, true, PROVIDER,
      );
    });

    it('provisions JIT when the connection allows it, recorded as confirmed by the email code', async () => {
      const ctx = setup({ conn: connection({ jitProvisioning: true }) });
      const { handle } = await openPending(ctx);
      const result = await ctx.service.verify(await startAndReadCode(ctx, handle), META);
      expect(result.session.sessionId).toBe('sess_1');
      expect(auditActions(ctx)).toEqual(['user.created', 'identity.created', 'identity.linked', 'membership.activated']);
      expect(auditEvent(ctx, 'identity.linked').details).toMatchObject({ via: 'sso_email_code' });
    });

    it('verify with a suspended connection answers sso_denied and consumes the record', async () => {
      // Review Focus 2: suspended between the callback and the code.
      const ctx = setup({ conn: connection({ status: 'SUSPENDED' }) });
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const { handle } = await openPending(ctx);
      const { challengeToken, code } = await startAndReadCode(ctx, handle);

      await expectRefused(ctx.service.verify({ challengeToken, code }, META), 403, 'sso_denied');

      expect(ctx.dbs.withOrgScope).not.toHaveBeenCalled();
      expect(ctx.identities.createExternalIdentity).not.toHaveBeenCalled();
      expect(ctx.identity.resolveIdentityAndCreateSession).not.toHaveBeenCalled();
      expect(await ctx.pendingBinds.peek(pendingBindId(handle))).toBeNull();
      await expectRefused(ctx.service.start({ handle }, META), 400, 'invalid_challenge');
      expect(ctx.deleteUser).toHaveBeenCalledWith(USERNAME);
      expect(auditEvent(ctx, 'identity.denied')).toMatchObject({
        orgId: 'org_sample',
        result: 'DENIED',
        details: { emailNormalised: EMAIL, reason: 'connection_inactive', connectionId: 'conn_1', via: 'sso_email_code' },
      });
    });

    it.each([
      ['whose domain lost its verification', { conn: connection(), domain: { connectionId: 'conn_1', verifiedAt: null, domain: 'acme.example' } }],
      ['whose domain moved to another connection', { conn: connection(), domain: { connectionId: 'conn_other', verifiedAt: new Date(), domain: 'acme.example' } }],
      ['that no longer exists', { conn: null }],
      ['back in TESTING', { conn: connection({ status: 'TESTING' }) }],
      ['now named for another protocol', { conn: connection({ cognitoProviderName: 'org-acme-saml', protocol: 'SAML' }) }],
    ])('verify through a connection %s answers sso_denied (connection_inactive)', async (_label, opts) => {
      const ctx = setup(opts as { conn: Conn | null; domain?: DomainRow });
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const { handle } = await openPending(ctx);

      await expectRefused(ctx.service.verify(await startAndReadCode(ctx, handle), META), 403, 'sso_denied');

      expect(ctx.identities.createExternalIdentity).not.toHaveBeenCalled();
      expect(ctx.identity.resolveIdentityAndCreateSession).not.toHaveBeenCalled();
      expect(await ctx.pendingBinds.peek(pendingBindId(handle))).toBeNull();
      expect(auditEvent(ctx, 'identity.denied').details).toMatchObject({ reason: 'connection_inactive' });
    });

    it('verify with no invitation and JIT off deletes the orphan and answers sso_denied', async () => {
      const ctx = setup();
      const { handle } = await openPending(ctx);

      await expectRefused(ctx.service.verify(await startAndReadCode(ctx, handle), META), 403, 'sso_denied');

      expect(ctx.deleteUser).toHaveBeenCalledWith(USERNAME);
      expect(auditEvent(ctx, 'identity.denied').details).toMatchObject({ reason: 'no_invitation', via: 'sso_email_code' });
      expect(ctx.identity.resolveIdentityAndCreateSession).not.toHaveBeenCalled();
      expect(await ctx.pendingBinds.peek(pendingBindId(handle))).toBeNull();
    });

    it('a wrong code keeps the pending binding; the right code then binds', async () => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const { handle } = await openPending(ctx);
      const { challengeToken, code } = await startAndReadCode(ctx, handle);
      const wrong = code.slice(0, -1) + (code.endsWith('0') ? '1' : '0');

      await expectRefused(ctx.service.verify({ challengeToken, code: wrong }, META), 401, 'invalid_code');
      expect(await ctx.pendingBinds.peek(pendingBindId(handle))).not.toBeNull();
      expect(ctx.audit.record).not.toHaveBeenCalled();

      const result = await ctx.service.verify({ challengeToken, code }, META);
      expect(result.returnPath).toBe('/people');
    });

    it('a code whose pending binding expired meanwhile answers invalid_challenge and binds nothing', async () => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const { handle } = await openPending(ctx);
      const { challengeToken, code } = await startAndReadCode(ctx, handle);
      await ctx.pendingBinds.take(pendingBindId(handle));

      await expectRefused(ctx.service.verify({ challengeToken, code }, META), 401, 'invalid_challenge');
      expect(ctx.identities.createExternalIdentity).not.toHaveBeenCalled();
      expect(ctx.deleteUser).not.toHaveBeenCalled();
    });

    it('an unknown challenge answers invalid_challenge', async () => {
      const ctx = setup();
      await expectRefused(ctx.service.verify({ challengeToken: 'nope', code: '12345678' }, META), 401, 'invalid_challenge');
    });

    it('a failing binding transaction answers sso_denied, keeps the pool user and logs no address', async () => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      // Drizzle wraps the driver error; its message carries the statement's parameters.
      const failure = Object.assign(new Error(`Failed query: insert ... params: ${EMAIL}`), {
        name: 'DrizzleQueryError',
        cause: Object.assign(new Error(`duplicate key ${EMAIL}`), { code: '23505' }),
      });
      ctx.identities.createExternalIdentity.mockRejectedValue(failure);
      const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      const { handle } = await openPending(ctx);

      await expectRefused(ctx.service.verify(await startAndReadCode(ctx, handle), META), 403, 'sso_denied');

      expect(ctx.deleteUser).not.toHaveBeenCalled();
      expect(ctx.identity.resolveIdentityAndCreateSession).not.toHaveBeenCalled();
      expect(auditEvent(ctx, 'auth.sign_in.failed')).toMatchObject({ orgId: 'org_sample', details: { reason: 'sso_binding' } });
      expect(error).toHaveBeenCalledTimes(1);
      const line = String(error.mock.calls[0]![0]);
      expect(line).toBe('SSO identity binding failed: DrizzleQueryError (SQLSTATE 23505)');
      expect(line).not.toContain(EMAIL);
    });

    it('a refused session (suspended user) answers sso_denied', async () => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      ctx.identity.resolveIdentityAndCreateSession.mockRejectedValue(new Error('Account is suspended or deactivated'));
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      const { handle } = await openPending(ctx);

      await expectRefused(ctx.service.verify(await startAndReadCode(ctx, handle), META), 403, 'sso_denied');

      expect(auditEvent(ctx, 'auth.sign_in.failed').details).toEqual({ reason: 'sso_session' });
    });

    it('no audit row carries the handle, the challenge token, the code or a token', async () => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const { handle, tokens } = await openPending(ctx);
      const { challengeToken, code } = await startAndReadCode(ctx, handle);
      await ctx.service.verify({ challengeToken, code }, META);

      const dump = JSON.stringify(ctx.audit.record.mock.calls);
      for (const secret of [handle, pendingBindId(handle), challengeToken, code, tokens.accessToken, tokens.idToken, tokens.refreshToken!]) {
        expect(dump).not.toContain(secret);
      }
    });
  });

  describe('resend', () => {
    it('mails a new code for the same challenge once the cooldown is over', async () => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const { handle } = await openPending(ctx);
      const { challengeToken, code: first } = await startAndReadCode(ctx, handle);

      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 61_000 });
      expect(await ctx.service.resend(challengeToken, 'sr-Cyrl')).toEqual({ emailMasked: 'm***@acme.example' });
      const mail = ctx.mailer.sent.at(-1)!;
      expect(mail).toMatchObject({ to: EMAIL, template: 'sso_bind_code', locale: 'sr-Cyrl' });
      expect(mail.params.code).not.toBe(first);

      const result = await ctx.service.verify({ challengeToken, code: mail.params.code! }, META);
      expect(result.returnPath).toBe('/people');
    });

    it('answers 429 rate_limited with retryAfter inside the cooldown', async () => {
      const ctx = setup();
      const { handle } = await openPending(ctx);
      const { challengeToken } = await startAndReadCode(ctx, handle);

      const err = await refusal(ctx.service.resend(challengeToken, 'en'));
      expect(err.getStatus()).toBe(429);
      expect(err.code).toBe('rate_limited');
      expect(err.details?.retryAfter).toBeGreaterThan(0);
      expect(ctx.mailer.sent).toHaveLength(1);
    });
  });
});
