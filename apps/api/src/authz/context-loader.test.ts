import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Principal } from '@nestself/contracts';
import { ContextLoader } from './context-loader.js';
import { PrincipalLoader } from '../principal/principal-loader.js';
import { authorize } from './authorize.js';

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

const PRINCIPAL: Principal = {
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

describe('ContextLoader with the real PrincipalLoader (delegated grants)', () => {
  const grantRow = (id: string, subjectUserId: string, actions: string[], parentGrantId: string | null) => ({
    id,
    subjectUserId,
    templateKey: parentGrantId ? null : 'hr_admin',
    actions,
    scopeType: 'organization',
    scopeOrgId: 'org-1',
    scopeOrgUnitId: null,
    includeDescendants: false,
    scopeRefKind: null,
    scopeRefId: null,
    conditions: [],
    validFrom: new Date('2026-01-01'),
    validUntil: null,
    delegationEnvelope: null,
    parentGrantId,
    revokedAt: null as Date | null,
  });

  function build(root: ReturnType<typeof grantRow>) {
    const child = grantRow('g-child', 'user-1', ['people.invite'], 'g-root');
    const authzRepo = {
      findGrantsForOrg: vi.fn().mockResolvedValue([child]),
      findDelegationAncestors: vi.fn().mockResolvedValue([root]),
      findActiveAssignments: vi.fn().mockResolvedValue([]),
      findOrgSettings: vi.fn().mockResolvedValue({ selfApprovalAllowed: false, timezone: 'UTC', status: 'ACTIVE' }),
      findClosureForOrg: vi.fn().mockResolvedValue([]),
      findAncestorIds: vi.fn().mockResolvedValue([]),
      findActiveEmergencyAccess: vi.fn().mockResolvedValue([]),
    };
    const cache = { get: vi.fn().mockResolvedValue(null), set: vi.fn(), del: vi.fn(), purgeLru: vi.fn() };
    const principalLoader = new PrincipalLoader({} as never, authzRepo as never, cache as never, { publish: vi.fn() } as never);
    return { loader: new ContextLoader(principalLoader, authzRepo as never), authzRepo };
  }

  const delegatee: Principal = {
    ...PRINCIPAL,
    context: { kind: 'organization', orgId: 'org-1' },
    memberships: [
      { membershipId: 'm-1', orgId: 'org-1', orgName: 'Org 1', orgUnitId: null, status: 'ACTIVE', startDate: '2026-01-01T00:00:00.000Z', endDate: null },
    ],
  };
  const invitation = { type: 'Invitation', orgId: 'org-1' };
  const loaded = { isSuspended: false, isDeactivated: false } as never;

  it("loads the delegated grant's ancestor chain so the delegatee is allowed the delegated action only", async () => {
    const { loader, authzRepo } = build(grantRow('g-root', 'user-2', ['people.invite', 'people.move'], null));
    const ctx = await loader.build(delegatee, invitation, { loadedPrincipal: loaded });

    expect(authzRepo.findDelegationAncestors).toHaveBeenCalledWith(['g-child']);
    expect(ctx.grants.map((g) => g.id)).toEqual(['g-child', 'g-root']);
    expect(authorize(delegatee, 'people.invite', invitation, ctx)).toMatchObject({ allowed: true, grantIds: ['g-child'] });
    expect(authorize(delegatee, 'people.move', invitation, ctx)).toMatchObject({
      allowed: false,
      denialReason: 'no_matching_grant',
    });
  });

  it('denies the delegated action when the ancestor is revoked', async () => {
    const root = grantRow('g-root', 'user-2', ['people.invite'], null);
    root.revokedAt = new Date('2026-02-01');
    const { loader } = build(root);
    const ctx = await loader.build(delegatee, invitation, { loadedPrincipal: loaded });

    expect(authorize(delegatee, 'people.invite', invitation, ctx)).toMatchObject({
      allowed: false,
      denialReason: 'delegation_parent_revoked',
    });
  });
});
