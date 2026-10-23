/**
 * AuthenticationGuard unit tests.
 *
 * @see T-1.6
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { AuthenticationGuard } from './authentication.guard.js';
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
  };
}

function createGuard(mocks: ReturnType<typeof createMocks>) {
  return new AuthenticationGuard(
    mocks.reflector as never,
    mocks.config as never,
    mocks.bearer as never,
    mocks.principalLoader as never,
    mocks.sessions as never,
    mocks.cookies as never,
    mocks.identities as never,
    mocks.store as never,
  );
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
});
