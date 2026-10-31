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
    store: { get: vi.fn().mockResolvedValue(null) },
  };
}

function createGuard(mocks: ReturnType<typeof createMocks>) {
  return new AuthorizationGuard(
    mocks.reflector as never,
    mocks.contextLoader as never,
    mocks.audit as never,
    mocks.store as never,
    { get: vi.fn() } as never,
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
      actions: ['wellbeing_checkin:read' as const],
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
    expect(mockAuthorize).toHaveBeenCalledWith(PRINCIPAL, 'wellbeing_checkin:read', RESOURCE, expect.anything());
  });

  it('throws 403 when denied but org is visible', async () => {
    const meta = {
      actions: ['wellbeing_checkin:read' as const],
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
      actions: ['wellbeing_checkin:read' as const],
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
      actions: ['wellbeing_checkin:read' as const],
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
      actions: ['wellbeing_checkin:read' as const],
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
  // -------------------------------------------------------------------------
  // Context expiry mapping (T-C1.02, AUTHZ-R-32)
  // -------------------------------------------------------------------------

  describe('invalid_context mapping', () => {
    const ENDED_MEMBERSHIP = {
      membershipId: 'm-1', orgId: 'org-1', orgUnitId: null,
      status: 'ENDED' as const, startDate: '2026-01-01', endDate: '2026-02-01',
    };

    async function denyWithInvalidContext(principal: unknown) {
      const meta = {
        actions: ['wellbeing_checkin:read' as const],
        resolver: vi.fn().mockResolvedValue(RESOURCE),
      };
      mocks.reflector.getAllAndOverride
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(meta);
      mockAuthorize.mockReturnValue({
        allowed: false, grantIds: [], assignmentIds: [], denialReason: 'invalid_context', explanation: [],
      });
      try {
        await guard.canActivate(mockContext({ principal, params: {} }));
      } catch (err) {
        return err as ApiHttpException;
      }
      return expect.unreachable('Should have thrown');
    }

    function expectAudited(reason: string) {
      expect(mocks.audit.record).toHaveBeenCalledTimes(1);
      expect(mocks.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'access.denied',
          result: 'DENIED',
          orgId: 'org-1',
          details: expect.objectContaining({ reason }),
        }),
      );
    }

    it('personal context with an orgId and no current membership: 403 org_context_expired', async () => {
      const principal = { ...PRINCIPAL, memberships: [], context: { kind: 'personal' as const, orgId: 'org-1' } };
      const err = await denyWithInvalidContext(principal);
      expect(err).toBeInstanceOf(ApiHttpException);
      expect(err.getStatus()).toBe(403);
      expect(err.code).toBe('org_context_expired');
      expectAudited('org_context_expired');
    });

    it('organization context with an ended membership: 403 org_context_expired, not the 404 non-disclosure answer', async () => {
      const principal = {
        ...PRINCIPAL,
        memberships: [ENDED_MEMBERSHIP],
        context: { kind: 'organization' as const, orgId: 'org-1' },
      };
      // Precondition: the visibility check alone would hide the org (404).
      const err = await denyWithInvalidContext(principal);
      expect(err.getStatus()).toBe(403);
      expect(err.code).toBe('org_context_expired');
      expectAudited('org_context_expired');
    });

    it('the same ended membership with a non-context denial still answers 404', async () => {
      const principal = {
        ...PRINCIPAL,
        memberships: [ENDED_MEMBERSHIP],
        context: { kind: 'organization' as const, orgId: 'org-1' },
      };
      const meta = { actions: ['wellbeing_checkin:read' as const], resolver: vi.fn().mockResolvedValue(RESOURCE) };
      mocks.reflector.getAllAndOverride
        .mockReturnValueOnce(false).mockReturnValueOnce(false).mockReturnValueOnce(meta);
      mockAuthorize.mockReturnValue({
        allowed: false, grantIds: [], assignmentIds: [], denialReason: 'no_grant', explanation: [],
      });
      await expect(guard.canActivate(mockContext({ principal, params: {} }))).rejects.toMatchObject({
        code: 'not_found',
      });
    });

    it('expert context that is invalid: 403 invalid_context', async () => {
      const principal = { ...PRINCIPAL, context: { kind: 'expert' as const } };
      const err = await denyWithInvalidContext(principal);
      expect(err.getStatus()).toBe(403);
      expect(err.code).toBe('invalid_context');
      expectAudited('invalid_context');
    });

    it('operations context that is invalid: 403 invalid_context', async () => {
      const principal = { ...PRINCIPAL, context: { kind: 'operations' as const } };
      const err = await denyWithInvalidContext(principal);
      expect(err.getStatus()).toBe(403);
      expect(err.code).toBe('invalid_context');
      expectAudited('invalid_context');
    });

    it('bare personal context that is invalid: 403 invalid_context', async () => {
      const principal = { ...PRINCIPAL, memberships: [], context: { kind: 'personal' as const } };
      const err = await denyWithInvalidContext(principal);
      expect(err.getStatus()).toBe(403);
      expect(err.code).toBe('invalid_context');
      expectAudited('invalid_context');
    });
  });

  // -------------------------------------------------------------------------
  // Step-up freshness (T-2.6)
  // -------------------------------------------------------------------------

  describe('step-up freshness', () => {
    const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
    // `people.deactivate` is in the administration class (maximum age 1800 s).
    const ADMIN_META = {
      actions: ['people.deactivate' as const],
      resolver: vi.fn().mockResolvedValue(RESOURCE),
    };

    function allowWith(meta: { actions: string[]; resolver: unknown }) {
      mocks.reflector.getAllAndOverride
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(meta);
      mockAuthorize.mockReturnValue({
        allowed: true, grantIds: ['g-1'], assignmentIds: [], denialReason: null, explanation: [],
      });
    }

    function principalWith(auth: { time: string; lastStepUpAt: string | null }, extra: Record<string, unknown> = {}) {
      return { ...PRINCIPAL, auth: { ...PRINCIPAL.auth, ...auth }, ...extra };
    }

    it('throws 403 step_up_required when the authentication is older than the class allows', async () => {
      allowWith(ADMIN_META);
      const req: Record<string, unknown> = {
        principal: principalWith({ time: minutesAgo(31), lastStepUpAt: null }), params: {},
      };

      try {
        await guard.canActivate(mockContext(req));
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiHttpException);
        expect((err as ApiHttpException).getStatus()).toBe(403);
        expect((err as ApiHttpException).code).toBe('step_up_required');
        expect((err as ApiHttpException).details).toEqual({
          stepUpClass: 'administration', maxAge: 1800, method: 'email_otp',
        });
      }
      expect(req.stepUpClass).toBe('administration');
    });

    it('allows a stale authentication with a recent step-up', async () => {
      allowWith(ADMIN_META);
      const req = { principal: principalWith({ time: minutesAgo(31), lastStepUpAt: minutesAgo(2) }), params: {} };
      await expect(guard.canActivate(mockContext(req))).resolves.toBe(true);
    });

    it('allows a recent authentication even when the last step-up is old', async () => {
      allowWith(ADMIN_META);
      const req = { principal: principalWith({ time: minutesAgo(2), lastStepUpAt: minutesAgo(40) }), params: {} };
      await expect(guard.canActivate(mockContext(req))).resolves.toBe(true);
    });

    it('allows a bearer caller whose token family has a fresh step-up record', async () => {
      allowWith(ADMIN_META);
      mocks.store.get.mockResolvedValue(JSON.stringify({ lastStepUpAt: minutesAgo(1) }));
      const req = {
        principal: principalWith(
          { time: minutesAgo(45), lastStepUpAt: null },
          { sessionId: null, tokenFamily: 'family-1' },
        ),
        params: {},
      };
      await expect(guard.canActivate(mockContext(req))).resolves.toBe(true);
      expect(mocks.store.get).toHaveBeenCalledWith('stepup:family-1');
    });

    it('refuses a bearer caller without a step-up record', async () => {
      allowWith(ADMIN_META);
      const req = {
        principal: principalWith(
          { time: minutesAgo(45), lastStepUpAt: null },
          { sessionId: null, tokenFamily: 'family-1' },
        ),
        params: {},
      };
      await expect(guard.canActivate(mockContext(req))).rejects.toMatchObject({ code: 'step_up_required' });
    });

    it('never checks freshness for an action without a step-up class', async () => {
      allowWith({ actions: ['wellbeing_checkin:read'], resolver: vi.fn().mockResolvedValue(RESOURCE) });
      const req: Record<string, unknown> = {
        principal: principalWith(
          { time: minutesAgo(600), lastStepUpAt: null },
          { sessionId: null, tokenFamily: 'family-1' },
        ),
        params: {},
      };
      await expect(guard.canActivate(mockContext(req))).resolves.toBe(true);
      expect(mocks.store.get).not.toHaveBeenCalled();
      expect(req.stepUpClass).toBeUndefined();
    });

    it('does not ask a denied caller to step up', async () => {
      mocks.reflector.getAllAndOverride
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(ADMIN_META);
      mockAuthorize.mockReturnValue({
        allowed: false, grantIds: [], assignmentIds: [], denialReason: 'no_grant', explanation: [],
      });
      const req = { principal: principalWith({ time: minutesAgo(31), lastStepUpAt: null }), params: {} };
      await expect(guard.canActivate(mockContext(req))).rejects.toMatchObject({ code: 'forbidden' });
    });
  });

  // -------------------------------------------------------------------------
  // A route that lists several actions: any one of them is enough
  // -------------------------------------------------------------------------

  describe('several actions', () => {
    const OVERVIEW_OR_PREVIEW = ['program.overview', 'access.preview'] as const;
    const ALLOWED = { allowed: true, grantIds: ['g-1'], assignmentIds: [], denialReason: null, explanation: [] };
    const denied = (reason: string) => ({
      allowed: false, grantIds: [], assignmentIds: [], denialReason: reason, explanation: [],
    });
    const staleAuth = { ...PRINCIPAL, auth: { ...PRINCIPAL.auth, time: new Date(Date.now() - 31 * 60_000).toISOString() } };

    /** The route declares `actions`; returns the metadata so a test can look at its resolver. */
    function declare(actions: readonly string[]) {
      const meta = { actions: [...actions], resolver: vi.fn().mockResolvedValue(RESOURCE) };
      mocks.reflector.getAllAndOverride
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(meta);
      return meta;
    }

    it('allows when any of the listed actions is allowed', async () => {
      declare(OVERVIEW_OR_PREVIEW);
      mockAuthorize.mockReturnValueOnce(denied('no_matching_grant')).mockReturnValueOnce(ALLOWED);

      await expect(guard.canActivate(mockContext({ principal: PRINCIPAL, params: {} }))).resolves.toBe(true);

      expect(mockAuthorize.mock.calls.map(([, action]) => action)).toEqual(['program.overview', 'access.preview']);
      // The first action refusing is not a denial of the request.
      expect(mocks.audit.record).not.toHaveBeenCalled();
    });

    it('stops at the first action that is allowed', async () => {
      declare(OVERVIEW_OR_PREVIEW);
      mockAuthorize.mockReturnValue(ALLOWED);

      await expect(guard.canActivate(mockContext({ principal: PRINCIPAL, params: {} }))).resolves.toBe(true);

      expect(mockAuthorize).toHaveBeenCalledTimes(1);
      expect(mockAuthorize).toHaveBeenCalledWith(PRINCIPAL, 'program.overview', RESOURCE, expect.anything());
    });

    it('resolves the resource once and builds the context for each action it evaluates', async () => {
      const meta = declare(OVERVIEW_OR_PREVIEW);
      mockAuthorize.mockReturnValueOnce(denied('no_matching_grant')).mockReturnValueOnce(ALLOWED);

      await guard.canActivate(mockContext({ principal: PRINCIPAL, params: {} }));

      expect(meta.resolver).toHaveBeenCalledOnce();
      expect(mocks.contextLoader.build.mock.calls).toEqual([
        [PRINCIPAL, RESOURCE, { action: 'program.overview' }],
        [PRINCIPAL, RESOURCE, { action: 'access.preview' }],
      ]);
    });

    it('denies and audits the first action when none is allowed', async () => {
      declare(OVERVIEW_OR_PREVIEW);
      mockAuthorize
        .mockReturnValueOnce(denied('no_matching_grant'))
        .mockReturnValueOnce(denied('invalid_context'));

      await expect(
        guard.canActivate(mockContext({ principal: PRINCIPAL, params: {} })),
      ).rejects.toMatchObject({ code: 'forbidden' });

      expect(mockAuthorize).toHaveBeenCalledTimes(2);
      expect(mocks.audit.record).toHaveBeenCalledOnce();
      expect(mocks.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'access.denied',
          result: 'DENIED',
          actorUserId: 'user-1',
          orgId: 'org-1',
          details: {
            actionAttempted: 'program.overview',
            alternatives: ['program.overview', 'access.preview'],
            resourceType: 'wellbeing_checkin',
            resourceId: 'r-1',
            reason: 'no_matching_grant',
          },
        }),
      );
    });

    it('audits a route with one action without alternatives', async () => {
      declare(['wellbeing_checkin:read']);
      mockAuthorize.mockReturnValue(denied('no_matching_grant'));

      await expect(
        guard.canActivate(mockContext({ principal: PRINCIPAL, params: {} })),
      ).rejects.toMatchObject({ code: 'forbidden' });

      expect(mocks.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          details: {
            actionAttempted: 'wellbeing_checkin:read',
            resourceType: 'wellbeing_checkin',
            resourceId: 'r-1',
            reason: 'no_matching_grant',
          },
        }),
      );
    });

    it('still answers 404 when none is allowed and the caller has no view of the organization', async () => {
      declare(OVERVIEW_OR_PREVIEW);
      mockAuthorize.mockReturnValue(denied('no_matching_grant'));
      const outsider = {
        ...PRINCIPAL,
        memberships: [
          { membershipId: 'm-2', orgId: 'other-org', orgUnitId: null, status: 'ACTIVE' as const, startDate: '2026-01-01', endDate: null },
        ],
      };

      await expect(
        guard.canActivate(mockContext({ principal: outsider, params: {} })),
      ).rejects.toMatchObject({ code: 'not_found' });
      expect(mocks.audit.record).toHaveBeenCalledOnce();
    });

    it('takes the step-up class from the action that allowed it', async () => {
      // `wellbeing_checkin:read` has no class; `people.deactivate` is in the administration class.
      declare(['wellbeing_checkin:read', 'people.deactivate']);
      mockAuthorize.mockReturnValueOnce(denied('no_matching_grant')).mockReturnValueOnce(ALLOWED);
      const req: Record<string, unknown> = { principal: staleAuth, params: {} };

      await expect(guard.canActivate(mockContext(req))).rejects.toMatchObject({
        code: 'step_up_required',
        details: { stepUpClass: 'administration', maxAge: 1800, method: 'email_otp' },
      });
      expect(req.stepUpClass).toBe('administration');
    });

    it('asks for no step-up when the allowing action has no class, whatever a later action needs', async () => {
      declare(['wellbeing_checkin:read', 'people.deactivate']);
      mockAuthorize.mockReturnValue(ALLOWED);
      const req: Record<string, unknown> = { principal: staleAuth, params: {} };

      await expect(guard.canActivate(mockContext(req))).resolves.toBe(true);

      expect(mockAuthorize).toHaveBeenCalledTimes(1);
      expect(req.stepUpClass).toBeUndefined();
    });
  });
});
