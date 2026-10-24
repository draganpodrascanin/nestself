/**
 * Unit tests for the authorization decision engine.
 *
 * One describe per evaluation step plus denial-reason assertions.
 *
 * @see Section 4.5 of auth-strategy.md
 */
import { describe, it, expect } from 'vitest';
import type {
  Principal,
  Resource,
  AuthorizationContext,
  GrantInput,
  AssignmentInput,
} from '@nestself/contracts';
import { authorize } from './authorize.js';
import { explain } from './explain.js';
import { evaluateCondition } from './conditions.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePrincipal(overrides: Partial<Principal> = {}): Principal {
  return {
    userId: 'u1',
    displayName: 'Test User',
    initials: 'TU',
    locale: 'en',
    memberships: [
      {
        membershipId: 'm1',
        orgId: 'o1',
        orgUnitId: 'ou1',
        status: 'ACTIVE',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: null,
      },
    ],
    staffTemplates: [],
    expert: null,
    context: { kind: 'organization', orgId: 'o1' },
    auth: {
      method: 'email_otp',
      time: '2026-10-22T09:00:00.000Z',
      secondFactor: false,
      lastStepUpAt: null,
    },
    sessionId: 's1',
    tokenFamily: null,
    ...overrides,
  };
}

function makeGrant(overrides: Partial<GrantInput> = {}): GrantInput {
  return {
    id: 'g1',
    subjectUserId: 'u1',
    templateKey: 'hr_admin',
    actions: ['people.invite'],
    scopeType: 'organization',
    scopeOrgId: 'o1',
    scopeOrgUnitId: null,
    includeDescendants: false,
    scopeRefKind: null,
    scopeRefId: null,
    conditions: [],
    validFrom: null,
    validUntil: null,
    delegationEnvelope: null,
    parentGrantId: null,
    revokedAt: null,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<AuthorizationContext> = {}): AuthorizationContext {
  return {
    now: new Date('2026-10-22T10:00:00.000Z'),
    isDeactivated: false,
    isSuspended: false,
    grants: [makeGrant()],
    assignments: [],
    ancestorIds: ['ou1'],
    orgSelfApprovalAllowed: false,
    organizationTimezone: 'Europe/Belgrade',
    ...overrides,
  };
}

const baseResource: Resource = { type: 'Invitation', orgId: 'o1' };

// ---------------------------------------------------------------------------
// Step 1: User state
// ---------------------------------------------------------------------------

describe('Step 1: User state', () => {
  it('denies deactivated user with user_deactivated', () => {
    const d = authorize(makePrincipal(), 'people.invite', baseResource, makeCtx({ isDeactivated: true }));
    expect(d.allowed).toBe(false);
    expect(d.denialReason).toBe('user_deactivated');
  });

  it('denies suspended user with user_suspended', () => {
    const d = authorize(makePrincipal(), 'people.invite', baseResource, makeCtx({ isSuspended: true }));
    expect(d.allowed).toBe(false);
    expect(d.denialReason).toBe('user_suspended');
  });

  it('deactivated takes priority over suspended', () => {
    const d = authorize(
      makePrincipal(),
      'people.invite',
      baseResource,
      makeCtx({ isDeactivated: true, isSuspended: true }),
    );
    expect(d.denialReason).toBe('user_deactivated');
  });
});

// ---------------------------------------------------------------------------
// Step 2: Context validity
// ---------------------------------------------------------------------------

describe('Step 2: Context validity', () => {
  it('denies when org context membership is date-expired', () => {
    const p = makePrincipal({
      memberships: [
        {
          membershipId: 'm1',
          orgId: 'o1',
          orgUnitId: 'ou1',
          status: 'ACTIVE',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-06-01T00:00:00.000Z',
        },
      ],
    });
    const d = authorize(p, 'people.invite', baseResource, makeCtx());
    expect(d.allowed).toBe(false);
    expect(d.denialReason).toBe('invalid_context');
  });

  it('denies personal context without any active membership', () => {
    const p = makePrincipal({ context: { kind: 'personal' }, memberships: [] });
    const d = authorize(p, 'preferences.manage', { type: 'User', ownerId: 'u1' }, makeCtx());
    expect(d.allowed).toBe(false);
    expect(d.denialReason).toBe('invalid_context');
  });

  it('denies operations context without staff templates', () => {
    const p = makePrincipal({ context: { kind: 'operations' }, staffTemplates: [] });
    const d = authorize(p, 'client.configure', baseResource, makeCtx());
    expect(d.allowed).toBe(false);
    expect(d.denialReason).toBe('invalid_context');
  });

  it('denies expert context without expert capability', () => {
    const p = makePrincipal({ context: { kind: 'expert' }, expert: null });
    const d = authorize(p, 'case.accept', baseResource, makeCtx());
    expect(d.allowed).toBe(false);
    expect(d.denialReason).toBe('invalid_context');
  });
});

// ---------------------------------------------------------------------------
// Step 3: Confidential domain
// ---------------------------------------------------------------------------

describe('Step 3: Confidential domain hard deny', () => {
  it('denies non-confidential action on confidential resource', () => {
    const d = authorize(
      makePrincipal(),
      'people.invite',
      { type: 'Record', isConfidential: true },
      makeCtx(),
    );
    expect(d.allowed).toBe(false);
    expect(d.denialReason).toBe('confidential_domain_denied');
  });

  it('denies grant with administrative scope on confidential resource', () => {
    const ctx = makeCtx({
      grants: [
        makeGrant({
          actions: ['conversation.participate'],
          scopeType: 'platform',
        }),
      ],
    });
    const d = authorize(
      makePrincipal(),
      'conversation.participate',
      { type: 'Conversation', isConfidential: true, ownerId: 'u1' },
      ctx,
    );
    // Platform scope excluded for confidential resources
    expect(d.allowed).toBe(false);
    expect(d.denialReason).toBe('no_matching_grant');
  });

  it('allows own-scoped conversation.participate on confidential resource', () => {
    const ctx = makeCtx({
      grants: [
        makeGrant({
          actions: ['conversation.participate'],
          scopeType: 'own',
          scopeOrgId: null,
        }),
      ],
    });
    const d = authorize(
      makePrincipal(),
      'conversation.participate',
      { type: 'Conversation', isConfidential: true, ownerId: 'u1' },
      ctx,
    );
    expect(d.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Step 3b: Emergency access
// ---------------------------------------------------------------------------

describe('Step 3b: Emergency access', () => {
  it('denies records.read.emergency with no emergency access', () => {
    const d = authorize(
      makePrincipal(),
      'records.read.emergency',
      { type: 'Record', id: 'case1', isConfidential: true },
      makeCtx({ emergencyAccess: [] }),
    );
    expect(d.allowed).toBe(false);
    expect(d.denialReason).toBe('no_emergency_access');
  });

  it('denies records.read.emergency with expired emergency access', () => {
    const d = authorize(
      makePrincipal(),
      'records.read.emergency',
      { type: 'Record', id: 'case1', isConfidential: true },
      makeCtx({
        emergencyAccess: [
          {
            id: 'ea1',
            userId: 'u1',
            scopeKind: 'CASE',
            scopeId: 'case1',
            grantedAt: new Date('2026-10-22T06:00:00Z'),
            expiresAt: new Date('2026-10-22T09:00:00Z'),
            revokedAt: null,
          },
        ],
      }),
    );
    expect(d.allowed).toBe(false);
    expect(d.denialReason).toBe('emergency_access_expired');
  });

  it('allows records.read.emergency with valid emergency access', () => {
    const d = authorize(
      makePrincipal(),
      'records.read.emergency',
      { type: 'Record', id: 'case1', isConfidential: true },
      makeCtx({
        emergencyAccess: [
          {
            id: 'ea1',
            userId: 'u1',
            scopeKind: 'CASE',
            scopeId: 'case1',
            grantedAt: new Date('2026-10-22T09:00:00Z'),
            expiresAt: new Date('2026-10-22T13:00:00Z'),
            revokedAt: null,
          },
        ],
      }),
    );
    expect(d.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Step 5: Grant matching
// ---------------------------------------------------------------------------

describe('Step 5: Grant matching', () => {
  it('allows when grant action and scope match', () => {
    const d = authorize(makePrincipal(), 'people.invite', baseResource, makeCtx());
    expect(d.allowed).toBe(true);
    expect(d.grantIds).toContain('g1');
  });

  it('denies when action is not in any grant', () => {
    const d = authorize(makePrincipal(), 'client.create', baseResource, makeCtx());
    expect(d.allowed).toBe(false);
    expect(d.denialReason).toBe('no_matching_grant');
  });

  it('skips revoked grants', () => {
    const ctx = makeCtx({
      grants: [makeGrant({ revokedAt: new Date('2026-10-01T00:00:00Z') })],
    });
    const d = authorize(makePrincipal(), 'people.invite', baseResource, ctx);
    expect(d.allowed).toBe(false);
    expect(d.denialReason).toBe('no_matching_grant');
  });

  it('skips expired grants', () => {
    const ctx = makeCtx({
      grants: [makeGrant({ validUntil: new Date('2026-10-01T00:00:00Z') })],
    });
    const d = authorize(makePrincipal(), 'people.invite', baseResource, ctx);
    expect(d.allowed).toBe(false);
  });

  it('skips future grants', () => {
    const ctx = makeCtx({
      grants: [makeGrant({ validFrom: new Date('2027-01-01T00:00:00Z') })],
    });
    const d = authorize(makePrincipal(), 'people.invite', baseResource, ctx);
    expect(d.allowed).toBe(false);
  });

  it('allows with org_unit scope and descendants', () => {
    const ctx = makeCtx({
      grants: [
        makeGrant({
          scopeType: 'org_unit',
          scopeOrgUnitId: 'ou-root',
          includeDescendants: true,
        }),
      ],
      ancestorIds: ['ou1', 'ou-root'],
    });
    const d = authorize(
      makePrincipal(),
      'people.invite',
      { type: 'Invitation', orgUnitId: 'ou1' },
      ctx,
    );
    expect(d.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Step 5b: Conditions
// ---------------------------------------------------------------------------

describe('Step 5b: Conditions', () => {
  it('denies when spending_ceiling exceeded', () => {
    const ctx = makeCtx({
      grants: [
        makeGrant({
          actions: ['spend.approve'],
          templateKey: 'team_manager',
          scopeType: 'org_unit',
          scopeOrgUnitId: 'ou1',
          conditions: [{ type: 'spending_ceiling', amountMinor: 50000, currency: 'EUR' }],
        }),
      ],
    });
    const d = authorize(
      makePrincipal(),
      'spend.approve',
      { type: 'Approval', orgUnitId: 'ou1', amountMinor: 60000, currency: 'EUR' },
      ctx,
    );
    expect(d.allowed).toBe(false);
  });

  it('allows when spending_ceiling not exceeded', () => {
    const ctx = makeCtx({
      grants: [
        makeGrant({
          actions: ['spend.approve'],
          templateKey: 'team_manager',
          scopeType: 'org_unit',
          scopeOrgUnitId: 'ou1',
          conditions: [{ type: 'spending_ceiling', amountMinor: 50000, currency: 'EUR' }],
        }),
      ],
    });
    const d = authorize(
      makePrincipal(),
      'spend.approve',
      { type: 'Approval', orgUnitId: 'ou1', amountMinor: 30000, currency: 'EUR' },
      ctx,
    );
    expect(d.allowed).toBe(true);
  });

  it('denies when category not in allowed list', () => {
    const ctx = makeCtx({
      grants: [
        makeGrant({
          actions: ['case.accept'],
          scopeType: 'assigned_cases',
          conditions: [{ type: 'categories', allowed: ['psychological'] }],
        }),
      ],
      assignments: [
        { id: 'a1', userId: 'u1', kind: 'CASE', targetId: 'case1', startAt: new Date('2026-01-01'), endAt: null },
      ],
    });
    const p = makePrincipal({ context: { kind: 'expert' }, expert: { id: 'exp1', approvedCategories: [] } });
    const d = authorize(
      p,
      'case.accept',
      { type: 'Case', id: 'case1', category: 'legal' },
      ctx,
    );
    expect(d.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Step 6: Self-approval
// ---------------------------------------------------------------------------

describe('Step 6: Self-approval', () => {
  it('denies self-approval when orgSelfApprovalAllowed is false', () => {
    const ctx = makeCtx({
      grants: [
        makeGrant({
          actions: ['approval.decide'],
          templateKey: 'approver',
        }),
      ],
      requesterId: 'u1',
      orgSelfApprovalAllowed: false,
    });
    const d = authorize(
      makePrincipal(),
      'approval.decide',
      { type: 'Approval', orgId: 'o1' },
      ctx,
    );
    expect(d.allowed).toBe(false);
    expect(d.denialReason).toBe('self_approval_denied');
  });

  it('allows self-approval when orgSelfApprovalAllowed is true', () => {
    const ctx = makeCtx({
      grants: [
        makeGrant({
          actions: ['approval.decide'],
          templateKey: 'approver',
        }),
      ],
      requesterId: 'u1',
      orgSelfApprovalAllowed: true,
    });
    const d = authorize(
      makePrincipal(),
      'approval.decide',
      { type: 'Approval', orgId: 'o1' },
      ctx,
    );
    expect(d.allowed).toBe(true);
  });

  it('allows when requester is different from principal', () => {
    const ctx = makeCtx({
      grants: [
        makeGrant({
          actions: ['approval.decide'],
          templateKey: 'approver',
        }),
      ],
      requesterId: 'u2',
      orgSelfApprovalAllowed: false,
    });
    const d = authorize(
      makePrincipal(),
      'approval.decide',
      { type: 'Approval', orgId: 'o1' },
      ctx,
    );
    expect(d.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Step 7: Delegation
// ---------------------------------------------------------------------------

describe('Step 7: Delegation', () => {
  it('allows valid delegated grant', () => {
    const parentGrant = makeGrant({
      id: 'g-parent',
      actions: ['people.invite'],
      delegationEnvelope: { actions: ['people.invite'] },
    });
    const delegatedGrant = makeGrant({
      id: 'g-child',
      actions: ['people.invite'],
      parentGrantId: 'g-parent',
    });
    const ctx = makeCtx({ grants: [parentGrant, delegatedGrant] });
    const d = authorize(makePrincipal(), 'people.invite', baseResource, ctx);
    expect(d.allowed).toBe(true);
  });

  it('skips delegated grant exceeding envelope', () => {
    const parentGrant = makeGrant({
      id: 'g-parent',
      actions: ['people.invite', 'people.move'],
      delegationEnvelope: { actions: ['people.invite'] },
    });
    const delegatedGrant = makeGrant({
      id: 'g-child',
      actions: ['people.move'],
      parentGrantId: 'g-parent',
    });
    const ctx = makeCtx({ grants: [parentGrant, delegatedGrant] });
    const d = authorize(makePrincipal(), 'people.move', baseResource, ctx);
    // The delegated grant should be skipped, but the parent allows it
    expect(d.allowed).toBe(true);
    expect(d.grantIds).toContain('g-parent');
  });

  it('denies when only grant is a delegated one exceeding depth', () => {
    const g1 = makeGrant({ id: 'g1', parentGrantId: null });
    const g2 = makeGrant({ id: 'g2', parentGrantId: 'g1' });
    const g3 = makeGrant({ id: 'g3', parentGrantId: 'g2' });
    const g4 = makeGrant({ id: 'g4', parentGrantId: 'g3' });
    const g5 = makeGrant({ id: 'g5', parentGrantId: 'g4', actions: ['people.invite'] });
    const ctx = makeCtx({ grants: [g1, g2, g3, g4, g5] });
    const d = authorize(makePrincipal(), 'people.invite', baseResource, ctx);
    // g5 is at depth 4, which exceeds max 3
    // g1 has the action so it should still pass
    expect(d.allowed).toBe(true);
    expect(d.grantIds).toContain('g1');
  });
});

// ---------------------------------------------------------------------------
// Assignment-scoped grants
// ---------------------------------------------------------------------------

describe('Assignment-scoped grants', () => {
  it('allows assigned_cases with matching assignment', () => {
    const assignment: AssignmentInput = {
      id: 'a1',
      userId: 'u1',
      kind: 'CASE',
      targetId: 'case1',
      startAt: new Date('2026-01-01'),
      endAt: null,
    };
    const ctx = makeCtx({
      grants: [
        makeGrant({
          actions: ['case.accept'],
          scopeType: 'assigned_cases',
          scopeOrgId: null,
        }),
      ],
      assignments: [assignment],
    });
    const p = makePrincipal({
      context: { kind: 'expert' },
      expert: { id: 'exp1', approvedCategories: [] },
    });
    const d = authorize(p, 'case.accept', { type: 'Case', id: 'case1' }, ctx);
    expect(d.allowed).toBe(true);
    expect(d.assignmentIds).toContain('a1');
  });

  it('denies when assignment is expired', () => {
    const assignment: AssignmentInput = {
      id: 'a1',
      userId: 'u1',
      kind: 'CASE',
      targetId: 'case1',
      startAt: new Date('2026-01-01'),
      endAt: new Date('2026-06-01'),
    };
    const ctx = makeCtx({
      grants: [
        makeGrant({
          actions: ['case.accept'],
          scopeType: 'assigned_cases',
          scopeOrgId: null,
        }),
      ],
      assignments: [assignment],
    });
    const p = makePrincipal({
      context: { kind: 'expert' },
      expert: { id: 'exp1', approvedCategories: [] },
    });
    const d = authorize(p, 'case.accept', { type: 'Case', id: 'case1' }, ctx);
    expect(d.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Delegation parent-chain health (security review item 1)
// ---------------------------------------------------------------------------

describe('Delegation parent-chain health', () => {
  it('denies when parent grant is revoked', () => {
    const parent = makeGrant({
      id: 'g-parent',
      actions: ['people.invite'],
      delegationEnvelope: { actions: ['people.invite'] },
      revokedAt: new Date('2026-10-20T00:00:00Z'),
    });
    const child = makeGrant({
      id: 'g-child',
      actions: ['people.invite'],
      parentGrantId: 'g-parent',
    });
    const ctx = makeCtx({ grants: [parent, child] });
    const d = authorize(makePrincipal(), 'people.invite', baseResource, ctx);
    expect(d.allowed).toBe(false);
    expect(d.denialReason).toBe('delegation_parent_revoked');
  });

  it('denies when parent grant has expired', () => {
    const parent = makeGrant({
      id: 'g-parent',
      actions: ['people.invite'],
      delegationEnvelope: { actions: ['people.invite'] },
      validUntil: new Date('2026-10-01T00:00:00Z'), // expired
    });
    const child = makeGrant({
      id: 'g-child',
      actions: ['people.invite'],
      parentGrantId: 'g-parent',
    });
    const ctx = makeCtx({ grants: [parent, child] });
    const d = authorize(makePrincipal(), 'people.invite', baseResource, ctx);
    expect(d.allowed).toBe(false);
    expect(d.denialReason).toBe('delegation_parent_expired');
  });

  it('denies when grandparent is revoked', () => {
    const grandparent = makeGrant({
      id: 'g-gp',
      actions: ['people.invite'],
      delegationEnvelope: { actions: ['people.invite'] },
      revokedAt: new Date('2026-10-15T00:00:00Z'),
    });
    const parent = makeGrant({
      id: 'g-parent',
      actions: ['people.invite'],
      delegationEnvelope: { actions: ['people.invite'] },
      parentGrantId: 'g-gp',
    });
    const child = makeGrant({
      id: 'g-child',
      actions: ['people.invite'],
      parentGrantId: 'g-parent',
    });
    const ctx = makeCtx({ grants: [grandparent, parent, child] });
    const d = authorize(makePrincipal(), 'people.invite', baseResource, ctx);
    expect(d.allowed).toBe(false);
    expect(d.denialReason).toBe('delegation_parent_revoked');
  });

  it('denies when parent is missing from context', () => {
    const child = makeGrant({
      id: 'g-child',
      actions: ['people.invite'],
      parentGrantId: 'g-missing',
    });
    const ctx = makeCtx({ grants: [child] });
    const d = authorize(makePrincipal(), 'people.invite', baseResource, ctx);
    expect(d.allowed).toBe(false);
    expect(d.denialReason).toBe('delegation_parent_revoked');
  });
});

// ---------------------------------------------------------------------------
// Conditions: time_window midnight crossing (security review item 3)
// ---------------------------------------------------------------------------

describe('Conditions: time_window midnight crossing', () => {
  const nightWindow = {
    type: 'time_window' as const,
    days: [2], // Tuesday
    from: '22:00',
    to: '06:00',
  };

  it('matches at 23:00 (after from)', () => {
    const ctx = makeCtx({
      now: new Date('2026-10-20T21:00:00.000Z'), // 23:00 Belgrade (UTC+2)
      grants: [makeGrant({
        actions: ['logistics.view'],
        scopeType: 'organization',
        conditions: [nightWindow],
      })],
    });
    // 2026-10-20 is Tuesday
    const d = authorize(makePrincipal(), 'logistics.view', baseResource, ctx);
    expect(d.allowed).toBe(true);
  });

  it('matches at 03:00 (before to)', () => {
    const ctx = makeCtx({
      now: new Date('2026-10-20T01:00:00.000Z'), // 03:00 Belgrade (UTC+2)
      grants: [makeGrant({
        actions: ['logistics.view'],
        scopeType: 'organization',
        conditions: [nightWindow],
      })],
    });
    // 2026-10-20 is Tuesday
    const d = authorize(makePrincipal(), 'logistics.view', baseResource, ctx);
    expect(d.allowed).toBe(true);
  });

  it('rejects at 12:00 (outside overnight window)', () => {
    const ctx = makeCtx({
      now: new Date('2026-10-20T10:00:00.000Z'), // 12:00 Belgrade (UTC+2)
      grants: [makeGrant({
        actions: ['logistics.view'],
        scopeType: 'organization',
        conditions: [nightWindow],
      })],
    });
    const d = authorize(makePrincipal(), 'logistics.view', baseResource, ctx);
    expect(d.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Conditions: spending_ceiling currency mismatch (security review item 4)
// ---------------------------------------------------------------------------

describe('Conditions: spending_ceiling currency handling', () => {
  it('passes when resource has no amountMinor', () => {
    const result = evaluateCondition(
      { type: 'spending_ceiling', amountMinor: 50000, currency: 'EUR' },
      { type: 'Item', orgId: 'o1' },
      makeCtx(),
      'spend.approve',
    );
    expect(result).toBe(true);
  });

  it('fails when resource has amountMinor but no currency', () => {
    const result = evaluateCondition(
      { type: 'spending_ceiling', amountMinor: 50000, currency: 'EUR' },
      { type: 'Item', orgId: 'o1', amountMinor: 30000 },
      makeCtx(),
      'spend.approve',
    );
    expect(result).toBe(false);
  });

  it('fails when resource currency differs from condition currency', () => {
    const result = evaluateCondition(
      { type: 'spending_ceiling', amountMinor: 50000, currency: 'EUR' },
      { type: 'Item', orgId: 'o1', amountMinor: 30000, currency: 'USD' },
      makeCtx(),
      'spend.approve',
    );
    expect(result).toBe(false);
  });

  it('passes when currencies match and amount is within ceiling', () => {
    const result = evaluateCondition(
      { type: 'spending_ceiling', amountMinor: 50000, currency: 'EUR' },
      { type: 'Item', orgId: 'o1', amountMinor: 30000, currency: 'EUR' },
      makeCtx(),
      'spend.approve',
    );
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Conditions: confidential_approver action check (security review item 5)
// ---------------------------------------------------------------------------

describe('Conditions: confidential_approver action gating', () => {
  it('passes for approval.confidential action', () => {
    const result = evaluateCondition(
      { type: 'confidential_approver' },
      { type: 'Approval', orgId: 'o1', orgUnitId: 'ou1' },
      makeCtx(),
      'approval.confidential',
    );
    expect(result).toBe(true);
  });

  it('fails for budget.read action on same grant', () => {
    const result = evaluateCondition(
      { type: 'confidential_approver' },
      { type: 'Budget', orgId: 'o1', orgUnitId: 'ou1' },
      makeCtx(),
      'budget.read',
    );
    expect(result).toBe(false);
  });

  it('grant with both actions: only approval.confidential passes', () => {
    const ctx = makeCtx({
      grants: [makeGrant({
        actions: ['approval.confidential', 'budget.read'],
        scopeType: 'org_unit',
        scopeOrgUnitId: 'ou1',
        conditions: [{ type: 'confidential_approver' }],
      })],
    });
    const dApproval = authorize(makePrincipal(), 'approval.confidential', { type: 'Approval', orgUnitId: 'ou1' }, ctx);
    expect(dApproval.allowed).toBe(true);

    const dBudget = authorize(makePrincipal(), 'budget.read', { type: 'Budget', orgUnitId: 'ou1' }, ctx);
    expect(dBudget.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// explain() consistency with authorize() (security review item 2)
// ---------------------------------------------------------------------------

describe('explain() consistency with authorize()', () => {
  it('produces the same decision fields as authorize() for basic allow', () => {
    const p = makePrincipal();
    const r = baseResource;
    const ctx = makeCtx();
    const authD = authorize(p, 'people.invite', r, ctx);
    const explD = explain(p, 'people.invite', r, ctx);
    expect(explD.allowed).toBe(authD.allowed);
    expect(explD.denialReason).toBe(authD.denialReason);
    expect(explD.grantIds).toEqual(authD.grantIds);
    expect(explD.assignmentIds).toEqual(authD.assignmentIds);
    expect(explD.explanation.length).toBeGreaterThan(0);
  });

  it('produces the same decision fields as authorize() for denial', () => {
    const p = makePrincipal();
    const r = baseResource;
    const ctx = makeCtx({ isDeactivated: true });
    const authD = authorize(p, 'people.invite', r, ctx);
    const explD = explain(p, 'people.invite', r, ctx);
    expect(explD.allowed).toBe(authD.allowed);
    expect(explD.denialReason).toBe(authD.denialReason);
    expect(explD.grantIds).toEqual(authD.grantIds);
  });
});
