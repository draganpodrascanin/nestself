/**
 * AuthorizationService.require: the 403 / 404 answer for a denial, the
 * `denyAs: 'not_found'` option for reads of confidential records, and the
 * step-up check that follows an allowed decision (CONF-R-03, AUTHZ-R-61).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Principal, Resource } from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import { AuthorizationService } from './authorization.service.js';

vi.mock('./authorize.js', () => ({
  authorize: vi.fn(),
}));

import { authorize } from './authorize.js';
const mockAuthorize = vi.mocked(authorize);

const MEMBER = {
  userId: 'user-1',
  displayName: 'Test',
  initials: 'T',
  locale: 'sr-Latn',
  memberships: [
    { membershipId: 'm-1', orgId: 'org-1', orgUnitId: null, status: 'ACTIVE' as const, startDate: '2026-01-01', endDate: null },
  ],
  staffTemplates: [],
  expert: null,
  context: { kind: 'organization' as const, orgId: 'org-1' },
  auth: { method: 'email_otp' as const, time: new Date().toISOString(), secondFactor: false, lastStepUpAt: null },
  sessionId: 'sess-1',
  tokenFamily: null,
} as unknown as Principal;

/** No membership in the resource's organisation and no staff template: the organisation is invisible to this caller. */
const OUTSIDER = { ...MEMBER, memberships: [] } as unknown as Principal;

const RESOURCE: Resource = {
  type: 'conversation',
  id: 'case-1',
  orgId: 'org-1',
  ownerId: 'user-2',
  isConfidential: true,
};

const ACTION = 'conversation.read.assigned';

const DENIED = { allowed: false, grantIds: [], assignmentIds: [], denialReason: 'no_matching_assignment', explanation: [] };
const ALLOWED = { allowed: true, grantIds: ['g-1'], assignmentIds: ['a-1'], denialReason: null, explanation: [] };

/** What every denial writes, whichever status it is answered with. */
const DENIAL_AUDIT_ROW = {
  action: 'access.denied',
  actorUserId: 'user-1',
  actorKind: 'USER',
  orgId: 'org-1',
  recordType: 'conversation',
  recordId: 'case-1',
  result: 'DENIED',
  details: {
    actionAttempted: ACTION,
    resourceType: 'conversation',
    resourceId: 'case-1',
    reason: 'no_matching_assignment',
  },
};

function setup() {
  const contextLoader = { build: vi.fn().mockResolvedValue({}) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const store = { get: vi.fn().mockResolvedValue(null) };
  const service = new AuthorizationService(contextLoader as never, audit as never, store as never);
  return { contextLoader, audit, store, service };
}

async function rejection(promise: Promise<unknown>): Promise<ApiHttpException> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiHttpException);
  return err as ApiHttpException;
}

describe('AuthorizationService.require', () => {
  let ctx: ReturnType<typeof setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = setup();
  });

  it('resolves on an allowed decision without auditing', async () => {
    mockAuthorize.mockReturnValue(ALLOWED);

    await expect(ctx.service.require(MEMBER, ACTION, RESOURCE)).resolves.toBeUndefined();
    expect(mockAuthorize).toHaveBeenCalledWith(MEMBER, ACTION, RESOURCE, expect.anything());
    expect(ctx.audit.record).not.toHaveBeenCalled();
  });

  describe('a denial', () => {
    beforeEach(() => {
      mockAuthorize.mockReturnValue(DENIED);
    });

    it('answers 403 forbidden when the caller can see the organisation, and audits it', async () => {
      const err = await rejection(ctx.service.require(MEMBER, ACTION, RESOURCE));

      expect(err.getStatus()).toBe(403);
      expect(err.code).toBe('forbidden');
      expect(ctx.audit.record).toHaveBeenCalledOnce();
      expect(ctx.audit.record).toHaveBeenCalledWith(DENIAL_AUDIT_ROW);
    });

    it('answers 404 not_found when the caller cannot see the organisation, and audits it', async () => {
      const err = await rejection(ctx.service.require(OUTSIDER, ACTION, RESOURCE));

      expect(err.getStatus()).toBe(404);
      expect(err.code).toBe('not_found');
      expect(err.message).toBe('Resource not found');
      expect(ctx.audit.record).toHaveBeenCalledWith(DENIAL_AUDIT_ROW);
    });

    it("denyAs 'not_found' answers 404 even when the caller can see the organisation", async () => {
      const err = await rejection(ctx.service.require(MEMBER, ACTION, RESOURCE, { denyAs: 'not_found' }));

      expect(err.getStatus()).toBe(404);
      expect(err.code).toBe('not_found');
      expect(err.message).toBe('Resource not found');
    });

    it("denyAs 'not_found' is the same error as the no-visibility 404 (status, code, message, details)", async () => {
      const invisible = await rejection(ctx.service.require(OUTSIDER, ACTION, RESOURCE));
      const forced = await rejection(ctx.service.require(MEMBER, ACTION, RESOURCE, { denyAs: 'not_found' }));

      expect({ status: forced.getStatus(), code: forced.code, message: forced.message, details: forced.details }).toEqual({
        status: invisible.getStatus(),
        code: invisible.code,
        message: invisible.message,
        details: invisible.details,
      });
    });

    it("denyAs 'not_found' still writes the audit row, unchanged", async () => {
      await rejection(ctx.service.require(MEMBER, ACTION, RESOURCE, { denyAs: 'not_found' }));

      expect(ctx.audit.record).toHaveBeenCalledOnce();
      expect(ctx.audit.record).toHaveBeenCalledWith(DENIAL_AUDIT_ROW);
    });
  });

  describe("denyAs 'not_found' on an allowed decision", () => {
    it('does not change the outcome: it resolves', async () => {
      mockAuthorize.mockReturnValue(ALLOWED);

      await expect(ctx.service.require(MEMBER, ACTION, RESOURCE, { denyAs: 'not_found' })).resolves.toBeUndefined();
      expect(ctx.audit.record).not.toHaveBeenCalled();
    });

    it('keeps a stale step-up as 403 step_up_required, never a 404', async () => {
      mockAuthorize.mockReturnValue(ALLOWED);
      const stale = {
        ...MEMBER,
        auth: { ...MEMBER.auth, time: new Date(Date.now() - 20 * 60_000).toISOString() },
      } as unknown as Principal;

      const err = await rejection(ctx.service.require(stale, ACTION, RESOURCE, { denyAs: 'not_found' }));

      expect(err.getStatus()).toBe(403);
      expect(err.code).toBe('step_up_required');
      expect(err.details).toMatchObject({ stepUpClass: 'restricted', maxAge: 900 });
      expect(ctx.audit.record).not.toHaveBeenCalled();
    });
  });
});
