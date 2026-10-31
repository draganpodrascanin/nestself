/**
 * AuthorizationService.require: the invalid_context / org_context_expired
 * mapping of a denial under an expired organisation context (I2).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthorizationService } from './authorization.service.js';
import type { ApiHttpException } from '../common/api-error.js';

vi.mock('./authorize.js', () => ({
  authorize: vi.fn(),
}));

import { authorize } from './authorize.js';
const mockAuthorize = vi.mocked(authorize);

const BASE_PRINCIPAL = {
  userId: 'user-1',
  displayName: 'Test',
  initials: 'T',
  locale: 'sr-Latn',
  memberships: [
    {
      membershipId: 'm-1', orgId: 'org-1', orgUnitId: null,
      status: 'ENDED' as const, startDate: '2026-01-01', endDate: '2026-02-01',
    },
  ],
  staffTemplates: [],
  expert: null,
  context: { kind: 'personal' as const },
  auth: { method: 'email_otp' as const, time: new Date().toISOString(), secondFactor: false, lastStepUpAt: null },
  sessionId: 'sess-1',
  tokenFamily: null,
};

const RESOURCE = { type: 'wellbeing_checkin', id: 'r-1', orgId: 'org-1' };
const ACTION = 'program.overview' as const;

describe('AuthorizationService.require (invalid_context mapping)', () => {
  let audit: { record: ReturnType<typeof vi.fn> };
  let service: AuthorizationService;

  beforeEach(() => {
    vi.clearAllMocks();
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    service = new AuthorizationService(
      { build: vi.fn().mockResolvedValue({}) } as never,
      audit as never,
      { get: vi.fn().mockResolvedValue(null) } as never,
    );
    mockAuthorize.mockReturnValue({
      allowed: false, grantIds: [], assignmentIds: [], denialReason: 'invalid_context', explanation: [],
    });
  });

  async function denial(context: unknown): Promise<ApiHttpException> {
    try {
      await service.require({ ...BASE_PRINCIPAL, context } as never, ACTION, RESOURCE);
    } catch (err) {
      return err as ApiHttpException;
    }
    return expect.unreachable('Should have thrown');
  }

  it('organization context with an ended membership: 403 org_context_expired (not 404), audited', async () => {
    const err = await denial({ kind: 'organization', orgId: 'org-1' });
    expect(err.getStatus()).toBe(403);
    expect(err.code).toBe('org_context_expired');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'DENIED', details: expect.objectContaining({ reason: 'org_context_expired' }) }),
    );
  });

  it('personal context with an orgId: 403 org_context_expired', async () => {
    const err = await denial({ kind: 'personal', orgId: 'org-1' });
    expect(err.getStatus()).toBe(403);
    expect(err.code).toBe('org_context_expired');
  });

  it.each([{ kind: 'personal' }, { kind: 'expert' }, { kind: 'operations' }])(
    '%j keeps invalid_context',
    async (context) => {
      const err = await denial(context);
      expect(err.getStatus()).toBe(403);
      expect(err.code).toBe('invalid_context');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ details: expect.objectContaining({ reason: 'invalid_context' }) }),
      );
    },
  );

  it('a non-context denial without org visibility still answers 404', async () => {
    mockAuthorize.mockReturnValue({
      allowed: false, grantIds: [], assignmentIds: [], denialReason: 'no_grant', explanation: [],
    });
    const err = await denial({ kind: 'organization', orgId: 'org-1' });
    expect(err.getStatus()).toBe(404);
    expect(err.code).toBe('not_found');
  });
});
