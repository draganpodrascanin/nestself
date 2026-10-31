/**
 * AuthenticationGuard unit tests, including the bearer of a federated mobile
 * user (phase 4 design 5.7, Review Focus 3).
 *
 * @see T-1.6
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { AuthenticationGuard } from './authentication.guard.js';
import { FederatedBindingService } from './federated-binding.service.js';
import { ApiHttpException } from '../common/api-error.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_SESSION_RECORD = {
  sessionId: 'sess-123',
  userId: 'user-1',
  surface: 'workspace' as const,
  population: 'employee' as const,
  context: { kind: 'personal' as const },
  cognito: {
    username: 'u',
    accessToken: 'enc-at',
    idToken: 'enc-id',
    refreshToken: 'enc-rt',
    accessExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
  },
  auth: { method: 'email_otp' as const, time: new Date().toISOString(), secondFactor: false },
  lastStepUpAt: null,
  createdAt: new Date().toISOString(),
  lastActivityAt: new Date().toISOString(),
  idleExpiresAt: new Date(Date.now() + 900_000).toISOString(),
  absoluteExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  rememberDevice: false,
  ipHash: 'hash',
  userAgentFamily: 'vitest',
  csrfToken: 'csrf-tok',
};

const FAKE_LOADED_PRINCIPAL = {
  userId: 'user-1',
  displayName: 'Test User',
  initials: 'TU',
  locale: 'sr-Latn',
  memberships: [
    {
      membershipId: 'm-1',
      orgId: 'org-1',
      orgUnitId: null,
      status: 'ACTIVE' as const,
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: null,
    },
  ],
  staffTemplates: [],
  expert: null,
  isSuspended: false,
  isDeactivated: false,
  populationHints: {
    hasStaffGrants: false,
    hasExpertGrants: false,
    hasActiveMembership: true,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockContext(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => (() => {}) as unknown,
    getClass: () => class {} as unknown,
  } as unknown as ExecutionContext;
}

function createMocks() {
  return {
    reflector: { getAllAndOverride: vi.fn().mockReturnValue(false) },
    config: { get: vi.fn().mockReturnValue(0) },
    bearer: { verify: vi.fn() },
    principalLoader: { load: vi.fn() },
    sessions: { get: vi.fn(), ensureFreshAccessToken: vi.fn(async (r: unknown) => r) },
    cookies: { parse: vi.fn().mockReturnValue({ sessionId: null }) },
    identities: { findExternalIdentity: vi.fn() },
    store: { set: vi.fn(), get: vi.fn(), sAdd: vi.fn(), expire: vi.fn() },
    sso: { findConnectionByProviderName: vi.fn().mockResolvedValue(null) },
    memberships: { findByUserId: vi.fn().mockResolvedValue([]) },
    audit: { record: vi.fn().mockResolvedValue(undefined) },
  };
}

function createGuard(mocks: ReturnType<typeof createMocks>) {
  // The real path-1 check (`existingIdentityUsable`), over the membership fake.
  const binding = new FederatedBindingService(
    {} as never,
    mocks.sso as never,
    mocks.identities as never,
    {} as never,
    {} as never,
    mocks.audit as never,
    mocks.memberships as never,
  );
  return new AuthenticationGuard(
    mocks.reflector as never,
    mocks.config as never,
    mocks.bearer as never,
    mocks.principalLoader as never,
    mocks.sessions as never,
    mocks.cookies as never,
    mocks.identities as never,
    mocks.store as never,
    mocks.sso as never,
    binding,
    mocks.audit as never,
  );
}

/** Two organisations' connections: the provider prefix of a username names one of them. */
const ACME = { id: 'conn_acme', orgId: 'org-1', cognitoProviderName: 'org-acme-oidc', status: 'ACTIVE' };
const OTHER = { id: 'conn_other', orgId: 'org-2', cognitoProviderName: 'org-other-oidc', status: 'ACTIVE' };

/** What `CognitoBearerVerifier` answers for a pool access token. */
function poolBearer(username: string | undefined, overrides: Record<string, unknown> = {}) {
  return {
    userId: '',
    sub: 'pool-sub-1',
    username,
    originJti: 'family-1',
    authMethod: 'email_otp' as const,
    authTime: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

function activeMembership(orgId: string) {
  return { orgId, status: 'ACTIVE' };
}

function bearerRequest(): Record<string, unknown> {
  return {
    headers: { authorization: 'Bearer pool-access-token', 'user-agent': 'NestSelf mobile' },
    socket: { remoteAddress: '127.0.0.1' },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthenticationGuard', () => {
  let mocks: ReturnType<typeof createMocks>;
  let guard: AuthenticationGuard;

  beforeEach(() => {
    mocks = createMocks();
    guard = createGuard(mocks);
  });

  it('bypasses @Public routes', async () => {
    mocks.reflector.getAllAndOverride.mockReturnValue(true);
    const req = { headers: {} };
    const result = await guard.canActivate(mockContext(req));
    expect(result).toBe(true);
    expect(mocks.cookies.parse).not.toHaveBeenCalled();
  });

  it('authenticates via session cookie (happy path)', async () => {
    mocks.cookies.parse.mockReturnValue({ sessionId: 'sess-123' });
    mocks.sessions.get.mockResolvedValue(FAKE_SESSION_RECORD);
    mocks.principalLoader.load.mockResolvedValue(FAKE_LOADED_PRINCIPAL);

    const req: Record<string, unknown> = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
    const result = await guard.canActivate(mockContext(req));

    expect(result).toBe(true);
    expect(req['principal']).toBeDefined();
    expect((req['principal'] as { userId: string }).userId).toBe('user-1');
    expect(req['session']).toBe(FAKE_SESSION_RECORD);
    expect(req['csrfToken']).toBe('csrf-tok');
  });

  it('throws 401 when session expired', async () => {
    mocks.cookies.parse.mockReturnValue({ sessionId: 'sess-gone' });
    mocks.sessions.get.mockResolvedValue(null);

    const req = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
    await expect(guard.canActivate(mockContext(req))).rejects.toThrow(ApiHttpException);

    try {
      await guard.canActivate(mockContext(req));
    } catch (err) {
      expect((err as ApiHttpException).code).toBe('session_expired');
    }
  });

  it('throws 401 when no cookie and no bearer', async () => {
    const req = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
    await expect(guard.canActivate(mockContext(req))).rejects.toThrow(ApiHttpException);

    try {
      await guard.canActivate(mockContext(req));
    } catch (err) {
      expect((err as ApiHttpException).code).toBe('unauthenticated');
    }
  });

  it('authenticates via bearer token (happy path)', async () => {
    mocks.bearer.verify.mockResolvedValue({
      userId: '',
      sub: 'cognito-sub-1',
      originJti: null,
      authMethod: 'email_otp',
      authTime: Math.floor(Date.now() / 1000),
    });
    mocks.identities.findExternalIdentity.mockResolvedValue({
      userId: 'user-1',
    });
    mocks.principalLoader.load.mockResolvedValue(FAKE_LOADED_PRINCIPAL);

    const req: Record<string, unknown> = {
      headers: { authorization: 'Bearer valid-token' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    const result = await guard.canActivate(mockContext(req));

    expect(result).toBe(true);
    expect(req['principal']).toBeDefined();
    expect((req['principal'] as { userId: string }).userId).toBe('user-1');
    expect(mocks.bearer.verify).toHaveBeenCalledWith('valid-token');
  });

  it('throws 401 when bearer verifier rejects (revoked family)', async () => {
    mocks.bearer.verify.mockRejectedValue(
      new ApiHttpException({ status: 401, code: 'unauthenticated', message: 'Revoked family' }),
    );

    const req = {
      headers: { authorization: 'Bearer bad-token' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    await expect(guard.canActivate(mockContext(req))).rejects.toThrow(ApiHttpException);
  });

  it('throws 401 when bearer resolves to suspended user', async () => {
    mocks.bearer.verify.mockResolvedValue({
      userId: '',
      sub: 'cognito-sub-1',
      originJti: null,
      authMethod: 'email_otp',
      authTime: Math.floor(Date.now() / 1000),
    });
    mocks.identities.findExternalIdentity.mockResolvedValue({
      userId: 'user-suspended',
    });
    mocks.principalLoader.load.mockResolvedValue({
      ...FAKE_LOADED_PRINCIPAL,
      userId: 'user-suspended',
      isSuspended: true,
    });

    const req = {
      headers: { authorization: 'Bearer tok' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    await expect(guard.canActivate(mockContext(req))).rejects.toThrow(ApiHttpException);
  });

  describe('bearer of a federated mobile user (5.7)', () => {
    function connectionsByName(...connections: Array<typeof ACME>) {
      mocks.sso.findConnectionByProviderName.mockImplementation(
        async (name: string) => connections.find((c) => c.cognitoProviderName === name) ?? null,
      );
    }

    async function refused(req: Record<string, unknown>): Promise<ApiHttpException> {
      const err = await guard.canActivate(mockContext(req)).then(
        () => {
          throw new Error('expected the bearer to be refused');
        },
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(ApiHttpException);
      return err as ApiHttpException;
    }

    function signInFailedAudits() {
      return mocks.audit.record.mock.calls
        .map((c) => c[0] as Record<string, unknown>)
        .filter((e) => e['action'] === 'auth.sign_in.failed');
    }

    it('resolves a federated bearer by provider prefix and marks the principal sso with a second factor', async () => {
      connectionsByName(ACME, OTHER);
      mocks.bearer.verify.mockResolvedValue(poolBearer('org-acme-oidc_idp-ana'));
      mocks.identities.findExternalIdentity.mockResolvedValue({ userId: 'user-1', ssoConnectionId: 'conn_acme' });
      mocks.memberships.findByUserId.mockResolvedValue([activeMembership('org-1')]);
      mocks.principalLoader.load.mockResolvedValue(FAKE_LOADED_PRINCIPAL);

      const req = bearerRequest();
      expect(await guard.canActivate(mockContext(req))).toBe(true);

      expect(mocks.sso.findConnectionByProviderName).toHaveBeenCalledWith('org-acme-oidc');
      // Looked up under the connection's provider only, never as a native identity.
      expect(mocks.identities.findExternalIdentity).toHaveBeenCalledTimes(1);
      expect(mocks.identities.findExternalIdentity).toHaveBeenCalledWith('cognito:org-acme-oidc', 'pool-sub-1');
      const principal = req['principal'] as { userId: string; auth: Record<string, unknown>; tokenFamily: string | null };
      expect(principal.userId).toBe('user-1');
      // MFA is delegated to the identity provider, as for a federated web session.
      expect(principal.auth).toMatchObject({ method: 'sso', secondFactor: true, lastStepUpAt: null });
      expect(principal.tokenFamily).toBe('family-1');
      expect(mocks.audit.record).not.toHaveBeenCalled();
    });

    it('refuses a federated bearer whose identity is bound to another connection (Review Focus 3)', async () => {
      // The prefix names org-2's provider; the identity under that provider was bound through
      // org-1's connection. The user is an ACTIVE member of both, so only the binding refuses.
      connectionsByName(ACME, OTHER);
      mocks.bearer.verify.mockResolvedValue(poolBearer('org-other-oidc_idp-ana'));
      mocks.identities.findExternalIdentity.mockResolvedValue({ userId: 'user-1', ssoConnectionId: 'conn_acme' });
      mocks.memberships.findByUserId.mockResolvedValue([activeMembership('org-1'), activeMembership('org-2')]);
      mocks.principalLoader.load.mockResolvedValue(FAKE_LOADED_PRINCIPAL);

      const req = bearerRequest();
      const err = await refused(req);

      expect(err.getStatus()).toBe(401);
      expect(err.code).toBe('unauthenticated');
      expect(req['principal']).toBeUndefined();
      expect(mocks.principalLoader.load).not.toHaveBeenCalled();
      expect(mocks.identities.findExternalIdentity).toHaveBeenCalledWith('cognito:org-other-oidc', 'pool-sub-1');
      expect(signInFailedAudits()).toEqual([
        expect.objectContaining({
          action: 'auth.sign_in.failed',
          actorUserId: null,
          orgId: 'org-2',
          recordType: 'auth_attempt',
          recordId: 'org-other-oidc',
          result: 'DENIED',
          ip: '127.0.0.1',
          userAgent: 'NestSelf mobile',
          details: { reason: 'sso_provider_mismatch' },
        }),
      ]);
    });

    it.each([
      ['has no identity under that provider', null, [activeMembership('org-1')]],
      ['has an identity without a binding connection', { userId: 'user-1', ssoConnectionId: null }, [activeMembership('org-1')]],
      [
        "is no ACTIVE member of the connection's organisation",
        { userId: 'user-1', ssoConnectionId: 'conn_acme' },
        [{ orgId: 'org-1', status: 'INVITED' }, activeMembership('org-2')],
      ],
    ])('refuses a federated bearer that %s, with no native fallback', async (_label, identity, memberships) => {
      connectionsByName(ACME, OTHER);
      mocks.bearer.verify.mockResolvedValue(poolBearer('org-acme-oidc_idp-ana'));
      mocks.identities.findExternalIdentity.mockResolvedValue(identity);
      mocks.memberships.findByUserId.mockResolvedValue(memberships);
      mocks.principalLoader.load.mockResolvedValue(FAKE_LOADED_PRINCIPAL);

      const req = bearerRequest();
      const err = await refused(req);

      expect(err.getStatus()).toBe(401);
      expect(err.code).toBe('unauthenticated');
      expect(req['principal']).toBeUndefined();
      expect(mocks.identities.findExternalIdentity).toHaveBeenCalledTimes(1);
      expect(mocks.identities.findExternalIdentity).not.toHaveBeenCalledWith('cognito', expect.anything());
      expect(signInFailedAudits()).toEqual([
        expect.objectContaining({ orgId: 'org-1', recordId: 'org-acme-oidc', details: { reason: 'sso_provider_mismatch' } }),
      ]);
    });

    it.each([
      ['an email address', 'ana@acme.example'],
      ['an email address with an underscore whose prefix names no connection', 'ana_maria@acme.example'],
    ])('a native bearer still resolves under provider cognito (username: %s)', async (_label, username) => {
      connectionsByName(ACME, OTHER);
      mocks.bearer.verify.mockResolvedValue(poolBearer(username));
      mocks.identities.findExternalIdentity.mockResolvedValue({ userId: 'user-1', ssoConnectionId: null });
      mocks.principalLoader.load.mockResolvedValue(FAKE_LOADED_PRINCIPAL);

      const req = bearerRequest();
      expect(await guard.canActivate(mockContext(req))).toBe(true);

      expect(mocks.identities.findExternalIdentity).toHaveBeenCalledTimes(1);
      expect(mocks.identities.findExternalIdentity).toHaveBeenCalledWith('cognito', 'pool-sub-1');
      const principal = req['principal'] as { userId: string; auth: Record<string, unknown> };
      expect(principal.userId).toBe('user-1');
      expect(principal.auth).toMatchObject({ method: 'email_otp', secondFactor: false });
      expect(mocks.memberships.findByUserId).not.toHaveBeenCalled();
      expect(mocks.audit.record).not.toHaveBeenCalled();
    });

    it('a bearer without a username claim resolves natively without a connection lookup', async () => {
      mocks.bearer.verify.mockResolvedValue(poolBearer(undefined));
      mocks.identities.findExternalIdentity.mockResolvedValue({ userId: 'user-1', ssoConnectionId: null });
      mocks.principalLoader.load.mockResolvedValue(FAKE_LOADED_PRINCIPAL);

      const req = bearerRequest();
      expect(await guard.canActivate(mockContext(req))).toBe(true);

      expect(mocks.sso.findConnectionByProviderName).not.toHaveBeenCalled();
      expect(mocks.identities.findExternalIdentity).toHaveBeenCalledWith('cognito', 'pool-sub-1');
    });
  });
});
