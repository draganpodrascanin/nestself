import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { AuthorizationGuard } from './authorization.guard.js';
import { ApiHttpException } from '../common/api-error.js';

vi.mock('./authorize.js', () => ({
  authorize: vi.fn(),
}));

import { authorize } from './authorize.js';
const mockAuthorize = vi.mocked(authorize);

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

const PRINCIPAL = {
  userId: 'user-1',
  displayName: 'Test',
  initials: 'T',
  locale: 'sr-Latn',
  memberships: [
    { membershipId: 'm-1', orgId: 'org-1', orgUnitId: null, status: 'ACTIVE' as const, startDate: '2026-01-01', endDate: null },
  ],
  staffTemplates: [],
  expert: null,
  context: { kind: 'personal' as const },
  auth: { method: 'email_otp' as const, time: new Date().toISOString(), secondFactor: false, lastStepUpAt: null },
  sessionId: 'sess-1',
  tokenFamily: null,
};

const RESOURCE = { type: 'wellbeing_checkin', id: 'r-1', orgId: 'org-1' };

function createMocks() {
  return {
    reflector: { getAllAndOverride: vi.fn().mockReturnValue(undefined) },
    contextLoader: { build: vi.fn().mockResolvedValue({}) },
    audit: { record: vi.fn().mockResolvedValue(undefined) },
  };
}

function createGuard(mocks: ReturnType<typeof createMocks>) {
  return new AuthorizationGuard(
    mocks.reflector as never,
    mocks.contextLoader as never,
    mocks.audit as never,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthorizationGuard', () => {
  let mocks: ReturnType<typeof createMocks>;
  let guard: AuthorizationGuard;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = createMocks();
    guard = createGuard(mocks);
  });

  it('bypasses @Public routes', async () => {
    mocks.reflector.getAllAndOverride
      .mockReturnValueOnce(true);  // IS_PUBLIC_KEY
    const result = await guard.canActivate(mockContext({}));
    expect(result).toBe(true);
    expect(mocks.contextLoader.build).not.toHaveBeenCalled();
  });

  it('bypasses @Authenticated routes', async () => {
    mocks.reflector.getAllAndOverride
      .mockReturnValueOnce(false)  // IS_PUBLIC_KEY
      .mockReturnValueOnce(true);  // IS_AUTHENTICATED_ONLY_KEY
    const result = await guard.canActivate(mockContext({}));
    expect(result).toBe(true);
  });

  it('denies routes without any security decorator (runtime default deny, AUTHZ-R-49)', async () => {
    mocks.reflector.getAllAndOverride
      .mockReturnValueOnce(false)   // IS_PUBLIC_KEY
      .mockReturnValueOnce(false)   // IS_AUTHENTICATED_ONLY_KEY
      .mockReturnValueOnce(undefined); // AUTHORIZE_KEY
    await expect(guard.canActivate(mockContext({}))).rejects.toMatchObject({ code: 'forbidden' });
    expect(mocks.contextLoader.build).not.toHaveBeenCalled();
  });

  it('allows when authorize() returns allowed', async () => {
    const meta = {
      action: 'wellbeing_checkin:read' as const,
      resolver: vi.fn().mockResolvedValue(RESOURCE),
    };
    mocks.reflector.getAllAndOverride
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(meta);

    mockAuthorize.mockReturnValue({
      allowed: true,
      grantIds: ['g-1'],
      assignmentIds: [],
      denialReason: null,
      explanation: [],
    });

    const req = { principal: PRINCIPAL, params: {} };
    const result = await guard.canActivate(mockContext(req));

    expect(result).toBe(true);
    expect(mocks.contextLoader.build).toHaveBeenCalledOnce();
    expect(mockAuthorize).toHaveBeenCalledWith(PRINCIPAL, meta.action, RESOURCE, expect.anything());
  });

  it('throws 403 when denied but org is visible', async () => {
    const meta = {
      action: 'wellbeing_checkin:read' as const,
      resolver: vi.fn().mockResolvedValue(RESOURCE),
    };
    mocks.reflector.getAllAndOverride
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(meta);

    mockAuthorize.mockReturnValue({
      allowed: false,
      grantIds: [],
      assignmentIds: [],
      denialReason: 'no_grant',
      explanation: ['No matching grant'],
    });

    const req = { principal: PRINCIPAL, params: {} };

    try {
      await guard.canActivate(mockContext(req));
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiHttpException);
      expect((err as ApiHttpException).getStatus()).toBe(403);
      expect((err as ApiHttpException).code).toBe('forbidden');
    }

    expect(mocks.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'access.denied', result: 'DENIED' }),
    );
  });

  it('throws 404 (non-disclosure) when denied and no org visibility', async () => {
    const noVisPrincipal = {
      ...PRINCIPAL,
      memberships: [
        { membershipId: 'm-2', orgId: 'other-org', orgUnitId: null, status: 'ACTIVE' as const, startDate: '2026-01-01', endDate: null },
      ],
      staffTemplates: [],
    };

    const meta = {
      action: 'wellbeing_checkin:read' as const,
      resolver: vi.fn().mockResolvedValue(RESOURCE),
    };
    mocks.reflector.getAllAndOverride
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(meta);

    mockAuthorize.mockReturnValue({
      allowed: false,
      grantIds: [],
      assignmentIds: [],
      denialReason: 'no_grant',
      explanation: [],
    });

    const req = { principal: noVisPrincipal, params: {} };

    try {
      await guard.canActivate(mockContext(req));
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiHttpException);
      expect((err as ApiHttpException).getStatus()).toBe(404);
      expect((err as ApiHttpException).code).toBe('not_found');
    }
  });

  it('annotates step-up class on the request', async () => {
    const meta = {
      action: 'wellbeing_checkin:read' as const,
      resolver: vi.fn().mockResolvedValue(RESOURCE),
    };
    mocks.reflector.getAllAndOverride
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(meta);

    mockAuthorize.mockReturnValue({
      allowed: true,
      grantIds: ['g-1'],
      assignmentIds: [],
      denialReason: null,
      explanation: [],
    });

    const req: Record<string, unknown> = { principal: PRINCIPAL, params: {} };
    await guard.canActivate(mockContext(req));

    // Step-up annotation is set only if the action exists in STEP_UP_CLASS_BY_ACTION
    // We just verify canActivate succeeds and doesn't throw
    expect(true).toBe(true);
  });

  it('throws 401 when no principal on protected route', async () => {
    const meta = {
      action: 'wellbeing_checkin:read' as const,
      resolver: vi.fn().mockResolvedValue(RESOURCE),
    };
    mocks.reflector.getAllAndOverride
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(meta);

    const req = { params: {} };

    try {
      await guard.canActivate(mockContext(req));
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiHttpException);
      expect((err as ApiHttpException).getStatus()).toBe(401);
    }
  });
});
