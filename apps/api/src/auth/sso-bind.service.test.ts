/**
 * SsoBindService unit tests: the pending binding after an unverified OIDC
 * email (phase 4 design 5.6) with the real NestselfOtpService, the real
 * PendingBindStore over the in-memory key-value store, the real
 * FederatedBindingService and fake identity provider, and repository fakes.
 * Covers Review Focus 2 (a connection or domain that stopped vouching between
 * the callback and the code), and the mobile app's `bindToken` (5.7) with the
 * real stub ID-token verifier.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiHttpException } from '../common/api-error.js';
import { LoggingMailer } from '../mailer/logging-mailer.js';
import { MailDeliveryError, oneTimeCode } from '../mailer/mailer.js';
import { FakeIdentityProvider } from '../identity/fake-identity-provider.js';
import { createFakeTokenSet } from '../identity/fake-token-factory.js';
import { InvitationMembershipActivator } from '../invitations/invitation-membership-activator.js';
import { MemoryKeyValueStore } from '../redis/memory-key-value-store.js';
import { throttleKey } from '../redis/redis-keys.js';
import { TokenCipher } from '../session/token-cipher.js';
import { FederatedBindingService } from './federated-binding.service.js';
import { StubIdTokenVerifier } from './id-token-verifier.js';
import { NestselfOtpService } from './nestself-otp.service.js';
import { PendingBindStore, pendingBindId } from './pending-bind-store.js';
import { SignInThrottle } from './sign-in-throttle.js';
import { SsoBindService } from './sso-bind.service.js';

const PROVIDER = 'org-acme-oidc';
const EMAIL = 'maria@acme.example';
const SUB = '5f0c2f4e-0000-4000-8000-000000000001';
const USERNAME = `${PROVIDER}_idp-maria`;
const META = { ip: '127.0.0.1', userAgent: 'vitest' };
const KEY = 'ab'.repeat(32);
/** Signs the mobile ID tokens the stub verifier accepts (stub mode's JWT secret). */
const STUB_JWT = new JwtService({ secret: 'stub-jwt-secret-'.padEnd(40, 'x'), signOptions: { expiresIn: '1h' } });

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
    findConnectionByProviderName: vi.fn(async (name: string) => (conn && conn.cognitoProviderName === name ? conn : null)),
    findDomainByName: vi.fn(async (name: string) => (name === 'acme.example' ? domain : null)),
    updateConnection: vi.fn().mockResolvedValue({}),
  };
  const tx = {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'membership_1' }]) }),
    }),
  };
  const dbs = { withOrgScope: vi.fn(async (_org: string, fn: (t: unknown) => Promise<unknown>) => fn(tx)) };
  /** `external_identities` as the binding writes it: a later lookup finds what an earlier verify bound. */
  const identityRows: Array<{ provider: string; subject: string; userId: string; ssoConnectionId: string | null }> = [];
  const identities = {
    findExternalIdentity: vi.fn(async (provider: string, subject: string) =>
      identityRows.find((r) => r.provider === provider && r.subject === subject) ?? null,
    ),
    findUserByEmail: vi.fn().mockResolvedValue(null),
    createUser: vi.fn().mockResolvedValue({ id: 'user_new' }),
    createExternalIdentity: vi.fn(async (row: (typeof identityRows)[number]) => {
      identityRows.push(row);
      return row;
    }),
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
  // The native email-code lock, over the same store: the address's failures are shared with sign-in.
  const throttle = new SignInThrottle(store);
  const service = new SsoBindService(
    otp, pendingBinds, throttle, store, sso as never, identities as never, dbs as never, binding, audit as never,
    principalLoader as never, identity as never, new StubIdTokenVerifier(STUB_JWT),
  );
  return {
    service, store, pendingBinds, mailer, idp, sso, dbs, tx, identities, identityRows, invitations, memberships, audit,
    principalLoader, identity, deleteUser, throttle,
  };
}

type Ctx = ReturnType<typeof setup>;

/** What the callback stores for an unverified OIDC sign-in; answers the handle and the token set. */
async function openPending(
  ctx: Ctx,
  overrides: { returnPath?: string | null; surface?: 'workspace' | 'admin'; testSignIn?: boolean } = {},
) {
  const tokens = createFakeTokenSet(SUB, USERNAME);
  const handle = await ctx.pendingBinds.open({
    connectionId: 'conn_1',
    providerName: PROVIDER,
    sub: SUB,
    username: USERNAME,
    email: EMAIL,
    surface: overrides.surface ?? 'workspace',
    returnPath: overrides.returnPath === undefined ? '/people' : overrides.returnPath,
    testSignIn: overrides.testSignIn ?? false,
    tokens,
  });
  return { handle, tokens };
}

/** `start`, then the code the mail carried. */
async function startAndReadCode(ctx: Ctx, handle: string) {
  const started = await ctx.service.start({ handle }, META);
  return { challengeToken: started.challengeToken, code: oneTimeCode(ctx.mailer.sent.at(-1)!) };
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
  beforeEach(() => {
    vi.restoreAllMocks();
    // The logging mailer reports each code it "sends" at debug level; these tests read `mailer.sent`.
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
  });
  afterEach(() => vi.useRealTimers());

  describe('start', () => {
    it('start mails a code to the pending address and keeps the record', async () => {
      const ctx = setup();
      const { handle } = await openPending(ctx);

      const started = await ctx.service.start({ handle, locale: 'hu' }, META);

      expect(started).toEqual({ challengeToken: expect.any(String), emailMasked: 'm***@acme.example' });
      expect(ctx.mailer.sent).toHaveLength(1);
      expect(ctx.mailer.sent[0]).toMatchObject({ to: EMAIL, template: 'sso_bind_code', locale: 'hu' });
      // The pending binding stays: a code lives 5 minutes, the handle 15, so a new start works
      // (once the minute between two starts of one pending sign-in has passed).
      expect(await ctx.pendingBinds.peek(pendingBindId(handle))).toMatchObject({ email: EMAIL, connectionId: 'conn_1' });
      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 61_000 });
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
      // An ordinary sign-in on an ACTIVE connection marks nothing tested.
      expect(ctx.sso.updateConnection).not.toHaveBeenCalled();
    });

    it('a staff test sign-in on a TESTING connection binds through the invitation, signs in and marks the connection tested', async () => {
      const ctx = setup({ conn: connection({ status: 'TESTING' }) });
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const { handle } = await openPending(ctx, { testSignIn: true });

      const result = await ctx.service.verify(await startAndReadCode(ctx, handle), META);

      expect(result.session.sessionId).toBe('sess_1');
      expect(ctx.invitations.accept).toHaveBeenCalledWith('inv_1', expect.any(Date), 'user_new', ctx.tx);
      expect(ctx.sso.updateConnection).toHaveBeenCalledTimes(1);
      expect(ctx.sso.updateConnection).toHaveBeenCalledWith(
        'conn_1', { lastTestedAt: expect.any(Date) }, ctx.tx, { fromStatus: 'TESTING' },
      );
      // As the callback's test path: only a sign-in that worked marks the connection tested.
      expect(ctx.identity.resolveIdentityAndCreateSession.mock.invocationCallOrder[0]!).toBeLessThan(
        ctx.sso.updateConnection.mock.invocationCallOrder[0]!,
      );
    });

    it('a staff test sign-in whose session is refused does not mark the connection tested', async () => {
      const ctx = setup({ conn: connection({ status: 'TESTING' }) });
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      ctx.identity.resolveIdentityAndCreateSession.mockRejectedValue(new Error('Account is suspended or deactivated'));
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      const { handle } = await openPending(ctx, { testSignIn: true });

      await expectRefused(ctx.service.verify(await startAndReadCode(ctx, handle), META), 403, 'sso_denied');
      expect(ctx.sso.updateConnection).not.toHaveBeenCalled();
    });

    it('a staff test sign-in never provisions JIT on a TESTING connection (no_invitation, sso_denied)', async () => {
      const ctx = setup({ conn: connection({ status: 'TESTING', jitProvisioning: true }) });
      const { handle } = await openPending(ctx, { testSignIn: true });

      await expectRefused(ctx.service.verify(await startAndReadCode(ctx, handle), META), 403, 'sso_denied');

      expect(ctx.identities.createUser).not.toHaveBeenCalled();
      expect(ctx.identities.createExternalIdentity).not.toHaveBeenCalled();
      expect(ctx.deleteUser).toHaveBeenCalledWith(USERNAME);
      expect(auditEvent(ctx, 'identity.denied').details).toMatchObject({ reason: 'no_invitation' });
      expect(ctx.sso.updateConnection).not.toHaveBeenCalled();
    });

    it('a staff test sign-in through a connection suspended meanwhile is still denied (connection_inactive)', async () => {
      const ctx = setup({ conn: connection({ status: 'SUSPENDED' }) });
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const { handle } = await openPending(ctx, { testSignIn: true });

      await expectRefused(ctx.service.verify(await startAndReadCode(ctx, handle), META), 403, 'sso_denied');

      expect(ctx.identities.createExternalIdentity).not.toHaveBeenCalled();
      expect(auditEvent(ctx, 'identity.denied').details).toMatchObject({ reason: 'connection_inactive' });
      expect(ctx.sso.updateConnection).not.toHaveBeenCalled();
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
      ['in TESTING, without a staff test sign-in', { conn: connection({ status: 'TESTING' }) }],
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
      // Nothing was bound, so the pool user is an orphan and goes (SSO-R-10).
      expect(ctx.deleteUser).toHaveBeenCalledWith(USERNAME);
      expect(ctx.sso.updateConnection).not.toHaveBeenCalled();
    });

    it.each([
      ['whose domain lost its verification', { conn: connection({ status: 'TESTING' }), domain: { connectionId: 'conn_1', verifiedAt: null, domain: 'acme.example' } }],
      ['now named for another protocol', { conn: connection({ status: 'TESTING', cognitoProviderName: 'org-acme-saml', protocol: 'SAML' }) }],
    ])('a staff test sign-in through a TESTING connection %s is still denied', async (_label, opts) => {
      const ctx = setup(opts as { conn: Conn | null; domain?: DomainRow });
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const { handle } = await openPending(ctx, { testSignIn: true });

      await expectRefused(ctx.service.verify(await startAndReadCode(ctx, handle), META), 403, 'sso_denied');

      expect(ctx.identities.createExternalIdentity).not.toHaveBeenCalled();
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

    it('a refused session (suspended user) answers sso_denied and logs the error by name only', async () => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      ctx.identity.resolveIdentityAndCreateSession.mockRejectedValue(new Error(`Account ${EMAIL} is suspended`));
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      const { handle } = await openPending(ctx);

      await expectRefused(ctx.service.verify(await startAndReadCode(ctx, handle), META), 403, 'sso_denied');

      expect(auditEvent(ctx, 'auth.sign_in.failed').details).toEqual({ reason: 'sso_session' });
      expect(warn.mock.calls.map((c) => String(c[0]))).toEqual(['SSO session creation refused: Error']);
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

  describe('limits: the address lock shared with sign-in, and a minute between starts', () => {
    const wrong = (code: string) => code.slice(0, -1) + (code.endsWith('0') ? '1' : '0');
    const failures = async (ctx: Ctx) => ctx.store.get(throttleKey('otp', EMAIL));
    async function lockAddress(ctx: Ctx) {
      for (let i = 0; i < 5; i++) await ctx.throttle.recordFailure(EMAIL);
    }

    it('start refuses a locked address with the sign-in answer (429 too_many_attempts) and mails nothing', async () => {
      const ctx = setup();
      const { handle } = await openPending(ctx);
      await lockAddress(ctx);

      await expectRefused(ctx.service.start({ handle }, META), 429, 'too_many_attempts');
      expect(ctx.mailer.sent).toHaveLength(0);
      // The refusal took no start slot: once unlocked, the code goes out at once.
      await ctx.throttle.reset(EMAIL);
      await expect(ctx.service.start({ handle }, META)).resolves.toHaveProperty('challengeToken');
    });

    it('verify refuses a locked address before it looks at the code; the challenge and the record stay', async () => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const { handle } = await openPending(ctx);
      const { challengeToken, code } = await startAndReadCode(ctx, handle);
      await lockAddress(ctx);

      await expectRefused(ctx.service.verify({ challengeToken, code }, META), 429, 'too_many_attempts');
      expect(ctx.identities.createExternalIdentity).not.toHaveBeenCalled();

      await ctx.throttle.reset(EMAIL);
      await expect(ctx.service.verify({ challengeToken, code }, META)).resolves.toHaveProperty('returnPath', '/people');
    });

    it('every wrong code counts toward the address lock, across challenges; the fifth locks start and verify', async () => {
      const ctx = setup();
      const first = await openPending(ctx);
      const second = await openPending(ctx);
      const one = await startAndReadCode(ctx, first.handle);
      const two = await startAndReadCode(ctx, second.handle);

      await expectRefused(ctx.service.verify({ ...one, code: wrong(one.code) }, META), 401, 'invalid_code');
      await expectRefused(ctx.service.verify({ ...one, code: wrong(one.code) }, META), 401, 'invalid_code');
      // The third wrong code ends the challenge (the code service's own limit) and counts too.
      await expectRefused(ctx.service.verify({ ...one, code: wrong(one.code) }, META), 429, 'too_many_attempts');
      expect(await failures(ctx)).toBe('3');

      await expectRefused(ctx.service.verify({ ...two, code: wrong(two.code) }, META), 401, 'invalid_code');
      await expectRefused(ctx.service.verify({ ...two, code: wrong(two.code) }, META), 401, 'invalid_code');
      expect(await ctx.throttle.isLocked(EMAIL)).toBe(true);

      // Locked: not even the right code, and no new code either.
      await expectRefused(ctx.service.verify(two, META), 429, 'too_many_attempts');
      await expectRefused(ctx.service.start({ handle: second.handle }, META), 429, 'too_many_attempts');
      expect(ctx.identities.createExternalIdentity).not.toHaveBeenCalled();
    });

    it('a successful verify clears the address failures', async () => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const { handle } = await openPending(ctx);
      const { challengeToken, code } = await startAndReadCode(ctx, handle);
      await expectRefused(ctx.service.verify({ challengeToken, code: wrong(code) }, META), 401, 'invalid_code');
      await expectRefused(ctx.service.verify({ challengeToken, code: wrong(code) }, META), 401, 'invalid_code');
      expect(await failures(ctx)).toBe('2');

      await ctx.service.verify({ challengeToken, code }, META);

      expect(await failures(ctx)).toBeNull();
    });

    it('a second start of one pending sign-in within a minute answers 429 rate_limited with retryAfter; after it a new code goes out', async () => {
      const ctx = setup();
      const { handle } = await openPending(ctx);
      await ctx.service.start({ handle }, META);

      const early = await refusal(ctx.service.start({ handle }, META));
      expect(early.getStatus()).toBe(429);
      expect(early.code).toBe('rate_limited');
      expect(early.details?.retryAfter).toBeGreaterThan(0);
      expect(early.details?.retryAfter).toBeLessThanOrEqual(60);
      expect(ctx.mailer.sent).toHaveLength(1);

      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 61_000 });
      await expect(ctx.service.start({ handle }, META)).resolves.toHaveProperty('challengeToken');
      expect(ctx.mailer.sent).toHaveLength(2);
    });

    it('a start whose mail is refused releases its slot, so the next start goes out at once', async () => {
      const ctx = setup();
      const { handle } = await openPending(ctx);
      vi.spyOn(ctx.mailer, 'send').mockRejectedValueOnce(new MailDeliveryError({ name: 'Throttling' }));
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

      await expectRefused(ctx.service.start({ handle }, META), 503, 'unavailable');
      await expect(ctx.service.start({ handle }, META)).resolves.toHaveProperty('challengeToken');
    });
  });

  describe('verify: the IdP account was bound meanwhile (path 1)', () => {
    /** An identity of the pending sign-in's IdP account, as an earlier binding wrote it. */
    function seedIdentity(ctx: Ctx, ssoConnectionId: string | null = 'conn_1') {
      ctx.identityRows.push({ provider: `cognito:${PROVIDER}`, subject: SUB, userId: 'user_known', ssoConnectionId });
    }
    const activeMember = [{ userId: 'user_known', orgId: 'org_sample', status: 'ACTIVE' }];

    it('two pending sign-ins of one IdP account: the second code signs in through the identity the first one bound', async () => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      // Two tabs (or a retry while the first mail was slow): two handles for the same account.
      const first = await openPending(ctx);
      const second = await openPending(ctx);
      const firstCode = await startAndReadCode(ctx, first.handle);
      const secondCode = await startAndReadCode(ctx, second.handle);

      await ctx.service.verify(firstCode, META);
      // The first verify bound the identity and activated the membership; the invitation is spent.
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(null);
      ctx.memberships.findByUserId.mockResolvedValue([{ userId: 'user_new', orgId: 'org_sample', status: 'ACTIVE' }]);
      const result = await ctx.service.verify(secondCode, META);

      expect(result).toEqual({
        returnPath: '/people',
        session: { sessionId: 'sess_1', csrfToken: 'csrf_1', absoluteExpiresAt: new Date('2026-11-01') },
      });
      expect(ctx.deleteUser).not.toHaveBeenCalled();
      expect(ctx.identities.createExternalIdentity).toHaveBeenCalledTimes(1);
      expect(ctx.identityRows).toHaveLength(1);
      expect(auditActions(ctx).filter((a) => a === 'identity.linked')).toHaveLength(1);
      expect(auditActions(ctx).filter((a) => a === 'invitation.accepted')).toHaveLength(1);
      expect(auditActions(ctx)).not.toContain('identity.denied');
      expect(ctx.identity.resolveIdentityAndCreateSession).toHaveBeenCalledTimes(2);
      expect(await ctx.pendingBinds.peek(pendingBindId(second.handle))).toBeNull();
    });

    it('an identity bound through this connection signs in even while the connection is SUSPENDED (as path 1 does)', async () => {
      const ctx = setup({ conn: connection({ status: 'SUSPENDED' }) });
      seedIdentity(ctx);
      ctx.memberships.findByUserId.mockResolvedValue(activeMember);
      const { handle, tokens } = await openPending(ctx);

      const result = await ctx.service.verify(await startAndReadCode(ctx, handle), META);

      expect(result.session.sessionId).toBe('sess_1');
      expect(ctx.identity.resolveIdentityAndCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({ idToken: tokens.idToken }), EMAIL, 'workspace', META, false, true, PROVIDER,
      );
      expect(ctx.dbs.withOrgScope).not.toHaveBeenCalled();
      expect(ctx.identities.createExternalIdentity).not.toHaveBeenCalled();
      expect(ctx.audit.record).not.toHaveBeenCalled();
      expect(ctx.deleteUser).not.toHaveBeenCalled();
    });

    it('a staff test record whose account was bound meanwhile still marks the TESTING connection tested', async () => {
      const ctx = setup({ conn: connection({ status: 'TESTING' }) });
      seedIdentity(ctx);
      ctx.memberships.findByUserId.mockResolvedValue(activeMember);
      const { handle } = await openPending(ctx, { testSignIn: true });

      await ctx.service.verify(await startAndReadCode(ctx, handle), META);

      expect(ctx.identities.createExternalIdentity).not.toHaveBeenCalled();
      expect(ctx.sso.updateConnection).toHaveBeenCalledWith(
        'conn_1', { lastTestedAt: expect.any(Date) }, ctx.tx, { fromStatus: 'TESTING' },
      );
    });

    it.each([
      ['bound through another connection', 'conn_other', activeMember],
      ['with no binding connection', null, activeMember],
      ['whose user is no ACTIVE member of the organization', 'conn_1', []],
    ])('an identity %s is refused without deleting anything (sso_provider_mismatch)', async (_label, ssoConnectionId, rows) => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      seedIdentity(ctx, ssoConnectionId);
      ctx.memberships.findByUserId.mockResolvedValue(rows);
      const { handle } = await openPending(ctx);

      await expectRefused(ctx.service.verify(await startAndReadCode(ctx, handle), META), 403, 'sso_denied');

      expect(ctx.deleteUser).not.toHaveBeenCalled();
      expect(ctx.identities.createExternalIdentity).not.toHaveBeenCalled();
      expect(ctx.identity.resolveIdentityAndCreateSession).not.toHaveBeenCalled();
      expect(auditActions(ctx)).toEqual(['auth.sign_in.failed']);
      expect(auditEvent(ctx, 'auth.sign_in.failed')).toMatchObject({
        orgId: 'org_sample',
        recordId: PROVIDER,
        result: 'DENIED',
        details: { reason: 'sso_provider_mismatch' },
      });
      expect(await ctx.pendingBinds.peek(pendingBindId(handle))).toBeNull();
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
      expect(oneTimeCode(mail)).not.toBe(first);

      const result = await ctx.service.verify({ challengeToken, code: oneTimeCode(mail) }, META);
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

  describe('bindToken: the mobile app presents its ID token (5.7)', () => {
    /** The mobile app's ID token after its own exchange (Cognito's claims), signed as the stub verifier checks. */
    function mobileIdToken(overrides: Record<string, unknown> = {}): string {
      return STUB_JWT.sign({
        sub: SUB,
        token_use: 'id',
        auth_time: Math.floor(Date.now() / 1000),
        email: EMAIL,
        email_verified: true,
        'cognito:username': USERNAME,
        identities: [{ userId: 'idp-maria', providerName: PROVIDER, providerType: 'OIDC', primary: 'true' }],
        ...overrides,
      });
    }
    const bindToken = (ctx: Ctx, idToken = mobileIdToken()) => ctx.service.bindToken({ idToken }, META);
    const activeMember = [{ userId: 'user_known', orgId: 'org_sample', status: 'ACTIVE' }];

    /** Nothing was bound and no session or pending binding was opened (`open`: a spy on `PendingBindStore.open`). */
    function expectNothingBound(ctx: Ctx, open: unknown) {
      expect(ctx.identities.createExternalIdentity).not.toHaveBeenCalled();
      expect(ctx.identity.resolveIdentityAndCreateSession).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
    }

    it('binds an invited user through the invitation and answers nothing (the app keeps its own tokens)', async () => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());

      await expect(bindToken(ctx)).resolves.toBeUndefined();

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
        via: 'sso_invitation',
        connectionId: 'conn_1',
      });
      expect(auditEvent(ctx, 'invitation.accepted')).toMatchObject({
        actorUserId: 'user_new',
        orgId: 'org_sample',
        recordId: 'inv_1',
        details: { emailNormalised: EMAIL, templateKey: 'employee', via: 'sso', connectionId: 'conn_1' },
      });
      expect(ctx.principalLoader.invalidateUser).toHaveBeenCalledWith('user_new', ['org_sample']);
      // No web session: the app signs in with its own bearer tokens.
      expect(ctx.identity.resolveIdentityAndCreateSession).not.toHaveBeenCalled();
      expect(ctx.deleteUser).not.toHaveBeenCalled();
    });

    it('provisions JIT when the connection allows it', async () => {
      const ctx = setup({ conn: connection({ jitProvisioning: true }) });

      await expect(bindToken(ctx)).resolves.toBeUndefined();

      expect(auditActions(ctx)).toEqual(['user.created', 'identity.created', 'identity.linked', 'membership.activated']);
      expect(auditEvent(ctx, 'identity.linked').details).toMatchObject({ via: 'sso_jit' });
      expect(ctx.principalLoader.invalidateUser).toHaveBeenCalledWith('user_new', ['org_sample']);
    });

    it('an IdP account bound already (on the web, or by an earlier bind-token) passes through path 1: nothing bound again', async () => {
      // Even while the OIDC provider still does not confirm the address: the binding is what vouches.
      const ctx = setup();
      ctx.identityRows.push({ provider: `cognito:${PROVIDER}`, subject: SUB, userId: 'user_known', ssoConnectionId: 'conn_1' });
      ctx.memberships.findByUserId.mockResolvedValue(activeMember);
      const open = vi.spyOn(ctx.pendingBinds, 'open');

      await expect(bindToken(ctx, mobileIdToken({ email_verified: undefined }))).resolves.toBeUndefined();

      expect(ctx.identities.findExternalIdentity).toHaveBeenCalledWith(`cognito:${PROVIDER}`, SUB);
      expect(ctx.dbs.withOrgScope).not.toHaveBeenCalled();
      expectNothingBound(ctx, open);
      expect(ctx.audit.record).not.toHaveBeenCalled();
      expect(ctx.deleteUser).not.toHaveBeenCalled();
    });

    it.each([
      ['bound through another connection', 'conn_other', activeMember],
      ['with no binding connection', null, activeMember],
      ['whose user is no ACTIVE member of the organization', 'conn_1', []],
    ])('path 1 refuses an identity %s: 403 sso_denied, sso_provider_mismatch, nothing deleted', async (_label, ssoConnectionId, rows) => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      ctx.identityRows.push({ provider: `cognito:${PROVIDER}`, subject: SUB, userId: 'user_known', ssoConnectionId });
      ctx.memberships.findByUserId.mockResolvedValue(rows);
      const open = vi.spyOn(ctx.pendingBinds, 'open');

      await expectRefused(bindToken(ctx), 403, 'sso_denied');

      expectNothingBound(ctx, open);
      expect(ctx.deleteUser).not.toHaveBeenCalled();
      expect(auditActions(ctx)).toEqual(['auth.sign_in.failed']);
      expect(auditEvent(ctx, 'auth.sign_in.failed')).toMatchObject({
        orgId: 'org_sample',
        recordId: PROVIDER,
        result: 'DENIED',
        ip: META.ip,
        details: { reason: 'sso_provider_mismatch' },
      });
    });

    it('a token without an identities claim (a native user) answers sso_denied and deletes nothing', async () => {
      const ctx = setup();
      const open = vi.spyOn(ctx.pendingBinds, 'open');

      await expectRefused(bindToken(ctx, mobileIdToken({ identities: undefined, 'cognito:username': EMAIL })), 403, 'sso_denied');

      expectNothingBound(ctx, open);
      expect(ctx.identities.findExternalIdentity).not.toHaveBeenCalled();
      expect(ctx.deleteUser).not.toHaveBeenCalled();
      expect(auditActions(ctx)).toEqual(['auth.sign_in.failed']);
      expect(auditEvent(ctx, 'auth.sign_in.failed')).toMatchObject({ orgId: null, details: { reason: 'sso_provider_mismatch' } });
    });

    it.each([
      ['in TESTING (no staff test on mobile)', { conn: connection({ status: 'TESTING' }) }],
      ['SUSPENDED', { conn: connection({ status: 'SUSPENDED' }) }],
      ['in DRAFT', { conn: connection({ status: 'DRAFT' }) }],
      ['that does not exist', { conn: null }],
    ])('a new binding through a connection %s is denied: orphan deleted, connection_inactive', async (_label, opts) => {
      const ctx = setup(opts as { conn: Conn | null });
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const open = vi.spyOn(ctx.pendingBinds, 'open');

      await expectRefused(bindToken(ctx), 403, 'sso_denied');

      expectNothingBound(ctx, open);
      expect(ctx.dbs.withOrgScope).not.toHaveBeenCalled();
      expect(ctx.deleteUser).toHaveBeenCalledWith(USERNAME);
      expect(auditEvent(ctx, 'identity.denied').details).toMatchObject({ emailNormalised: EMAIL, reason: 'connection_inactive' });
      expect(auditEvent(ctx, 'identity.denied').details).not.toHaveProperty('via');
    });

    it.each([
      ['lost its verification', { connectionId: 'conn_1', verifiedAt: null, domain: 'acme.example' }],
      ['belongs to another connection', { connectionId: 'conn_other', verifiedAt: new Date(), domain: 'acme.example' }],
    ])('an address whose domain %s binds nothing: orphan deleted, email_off_domain', async (_label, domain) => {
      const ctx = setup({ domain });
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());

      await expectRefused(bindToken(ctx), 403, 'sso_denied');

      expect(ctx.identities.createExternalIdentity).not.toHaveBeenCalled();
      expect(ctx.deleteUser).toHaveBeenCalledWith(USERNAME);
      expect(auditEvent(ctx, 'identity.denied').details).toMatchObject({ reason: 'email_off_domain' });
    });

    it.each([
      ['email_verified false', { email_verified: false }],
      ['no email_verified claim at all (Entra ID)', { email_verified: undefined }],
    ])('an OIDC address the provider did not confirm (%s) answers sso_email_unverified and keeps the pool user', async (_label, claim) => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const open = vi.spyOn(ctx.pendingBinds, 'open');

      await expectRefused(bindToken(ctx, mobileIdToken(claim)), 403, 'sso_email_unverified');

      // Confirmed once on the web, where the callback finds no identity and opens the pending binding.
      expectNothingBound(ctx, open);
      expect(ctx.dbs.withOrgScope).not.toHaveBeenCalled();
      expect(ctx.deleteUser).not.toHaveBeenCalled();
      expect(ctx.mailer.sent).toHaveLength(0);
      expect(auditActions(ctx)).toEqual(['auth.sign_in.failed']);
      expect(auditEvent(ctx, 'auth.sign_in.failed')).toMatchObject({
        orgId: 'org_sample',
        recordId: PROVIDER,
        details: { reason: 'sso_email_unverified' },
      });
    });

    it.each([
      ["the connection's claim switch is off", connection({ oidcEmailVerifiedClaimRequired: false })],
      ['the connection is SAML (the domain inference vouches)', connection({ protocol: 'SAML' })],
    ])('an unconfirmed address binds when %s', async (_label, conn) => {
      const ctx = setup({ conn });
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());

      await expect(bindToken(ctx, mobileIdToken({ email_verified: undefined }))).resolves.toBeUndefined();

      expect(ctx.identities.createExternalIdentity).toHaveBeenCalledTimes(1);
      expect(ctx.deleteUser).not.toHaveBeenCalled();
    });

    it('no invitation and JIT off: the orphan is deleted and the answer is sso_denied (no_invitation)', async () => {
      const ctx = setup();

      await expectRefused(bindToken(ctx), 403, 'sso_denied');

      expect(ctx.deleteUser).toHaveBeenCalledWith(USERNAME);
      expect(auditEvent(ctx, 'identity.denied')).toMatchObject({
        orgId: 'org_sample',
        result: 'DENIED',
        details: { emailNormalised: EMAIL, reason: 'no_invitation', connectionId: 'conn_1' },
      });
      expect(ctx.principalLoader.invalidateUser).not.toHaveBeenCalled();
    });

    it('a failing binding transaction answers sso_denied, keeps the pool user and logs the failure by name only', async () => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const failure = Object.assign(new Error(`Failed query: insert ... params: ${EMAIL}`), {
        name: 'DrizzleQueryError',
        cause: Object.assign(new Error(`duplicate key ${EMAIL}`), { code: '23505' }),
      });
      ctx.identities.createExternalIdentity.mockRejectedValue(failure);
      const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      await expectRefused(bindToken(ctx), 403, 'sso_denied');

      expect(ctx.deleteUser).not.toHaveBeenCalled();
      expect(auditEvent(ctx, 'auth.sign_in.failed')).toMatchObject({ orgId: 'org_sample', details: { reason: 'sso_binding' } });
      expect(auditActions(ctx)).not.toContain('invitation.accepted');
      expect(error.mock.calls.map((c) => String(c[0]))).toEqual(['SSO identity binding failed: DrizzleQueryError (SQLSTATE 23505)']);
    });

    it.each([
      ['an access token', () => mobileIdToken({ token_use: 'access' })],
      ['a token signed with another secret', () => new JwtService({ secret: 'y'.repeat(40) }).sign({ sub: SUB, token_use: 'id' })],
      ['not a JWT', () => 'not-a-jwt'],
    ])('%s answers 401 unauthenticated and touches nothing', async (_label, token) => {
      const ctx = setup();
      ctx.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());

      await expectRefused(bindToken(ctx, token()), 401, 'unauthenticated');

      expect(ctx.sso.findConnectionByProviderName).not.toHaveBeenCalled();
      expect(ctx.identities.findExternalIdentity).not.toHaveBeenCalled();
      expect(ctx.deleteUser).not.toHaveBeenCalled();
      expect(ctx.audit.record).not.toHaveBeenCalled();
    });

    it('no audit row carries the ID token, bound or denied', async () => {
      const bound = setup();
      bound.invitations.findPendingByEmailAndOrg.mockResolvedValue(invitation());
      const denied = setup();
      const idToken = mobileIdToken();

      await bindToken(bound, idToken);
      await expectRefused(bindToken(denied, idToken), 403, 'sso_denied');

      for (const ctx of [bound, denied]) {
        expect(ctx.audit.record).toHaveBeenCalled();
        expect(JSON.stringify(ctx.audit.record.mock.calls)).not.toContain(idToken);
      }
    });
  });
});
