import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextLoader } from './context-loader.js';

function createMocks() {
  return {
    principalLoader: {
      load: vi.fn().mockResolvedValue({
        isSuspended: false,
        isDeactivated: false,
      }),
      loadGrants: vi.fn().mockResolvedValue([]),
      loadAssignments: vi.fn().mockResolvedValue([]),
      loadOrgTree: vi.fn().mockResolvedValue({
        ancestorIds: [],
        selfApprovalAllowed: false,
        timezone: 'Europe/Belgrade',
        status: 'ACTIVE',
      }),
    },
    authzRepo: {
      findAncestorIds: vi.fn().mockResolvedValue([]),
      findActiveEmergencyAccess: vi.fn().mockResolvedValue([]),
    },
  };
}

const PRINCIPAL = {
  userId: 'user-1',
  displayName: 'Test',
  initials: 'T',
  locale: 'sr-Latn',
  memberships: [],
  staffTemplates: [],
  expert: null,
  context: { kind: 'personal' as const },
  auth: { method: 'email_otp' as const, time: new Date().toISOString(), secondFactor: false, lastStepUpAt: null },
  sessionId: 'sess-1',
  tokenFamily: null,
};

describe('ContextLoader', () => {
  let mocks: ReturnType<typeof createMocks>;
  let loader: ContextLoader;

  beforeEach(() => {
    mocks = createMocks();
    loader = new ContextLoader(mocks.principalLoader as never, mocks.authzRepo as never);
  });

  it('builds context with grants, assignments, and org tree', async () => {
    const resource = { type: 'wellbeing_checkin', id: 'r-1', orgId: 'org-1' };
    const ctx = await loader.build(PRINCIPAL, resource);

    expect(ctx.grants).toEqual([]);
    expect(ctx.assignments).toEqual([]);
    expect(ctx.organizationTimezone).toBe('Europe/Belgrade');
    expect(ctx.isSuspended).toBe(false);
    expect(ctx.isDeactivated).toBe(false);
    expect(mocks.principalLoader.loadGrants).toHaveBeenCalledWith('user-1', 'org-1');
    expect(mocks.principalLoader.loadAssignments).toHaveBeenCalledWith('user-1');
    expect(mocks.principalLoader.loadOrgTree).toHaveBeenCalledWith('org-1');
  });

  it('loads ancestor ids when resource has orgUnitId', async () => {
    mocks.authzRepo.findAncestorIds.mockResolvedValue(['root-ou', 'parent-ou']);
    const resource = { type: 'wellbeing_checkin', id: 'r-1', orgId: 'org-1', orgUnitId: 'child-ou' };

    const ctx = await loader.build(PRINCIPAL, resource);

    expect(ctx.ancestorIds).toContain('root-ou');
    expect(ctx.ancestorIds).toContain('parent-ou');
    expect(mocks.authzRepo.findAncestorIds).toHaveBeenCalledWith('child-ou');
  });

  it('loads emergency access for confidential actions (AUTHZ-R-46)', async () => {
    mocks.authzRepo.findActiveEmergencyAccess.mockResolvedValue([
      {
        id: 'ea-1',
        userId: 'user-1',
        scopeKind: 'ORG',
        scopeId: 'org-1',
        grantedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
        revokedAt: null,
      },
    ]);

    const resource = { type: 'wellbeing_checkin', id: 'r-1', orgId: 'org-1' };
    const ctx = await loader.build(PRINCIPAL, resource, {
      action: 'records.read.emergency',
    });

    expect(ctx.emergencyAccess).toBeDefined();
    expect(ctx.emergencyAccess).toHaveLength(1);
    expect(ctx.emergencyAccess![0]!.id).toBe('ea-1');
  });

  it('does NOT load emergency access for non-confidential actions', async () => {
    const resource = { type: 'wellbeing_checkin', id: 'r-1', orgId: 'org-1' };
    const ctx = await loader.build(PRINCIPAL, resource, {
      action: 'wellbeing_checkin:read',
    });

    expect(ctx.emergencyAccess).toBeUndefined();
    expect(mocks.authzRepo.findActiveEmergencyAccess).not.toHaveBeenCalled();
  });

  it('uses "platform" as orgId when resource has none', async () => {
    const resource = { type: 'system', id: 's-1' };
    await loader.build(PRINCIPAL, resource);
    expect(mocks.principalLoader.loadGrants).toHaveBeenCalledWith('user-1', 'platform');
  });
});
