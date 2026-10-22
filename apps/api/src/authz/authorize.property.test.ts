/**
 * Property-based tests for the authorization engine.
 *
 * Five invariants verified with fast-check (1000 runs each per AUTHZ-R-48).
 *
 * @see Section 4.5.12 of auth-strategy.md
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type {
  Principal,
  Resource,
  AuthorizationContext,
  GrantInput,
  ScopeType,
} from '@nestself/contracts';
import { ACTION_LIST } from '@nestself/contracts';
import { authorize } from './authorize.js';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const actionArb = fc.constantFrom(...ACTION_LIST);

const scopeTypeArb: fc.Arbitrary<ScopeType> = fc.constantFrom(
  'platform',
  'organization',
  'org_unit',
  'assigned_clients',
  'assigned_queues',
  'assigned_cases',
  'assigned_practice',
  'assigned_collections',
  'own',
);

const orgIdArb = fc.constantFrom('org-A', 'org-B', 'org-C');

function grantArb(
  overrides: Partial<GrantInput> = {},
): fc.Arbitrary<GrantInput> {
  return fc.record({
    id: fc.uuid(),
    subjectUserId: fc.constant('u1'),
    templateKey: fc.constant('hr_admin'),
    actions: fc.subarray([...ACTION_LIST], { minLength: 1, maxLength: 5 }),
    scopeType: scopeTypeArb,
    scopeOrgId: orgIdArb.map((v) => v as string | null),
    scopeOrgUnitId: fc.constant(null),
    includeDescendants: fc.boolean(),
    scopeRefKind: fc.constant(null),
    scopeRefId: fc.constant(null),
    conditions: fc.constant([]),
    validFrom: fc.option(
      fc.date({
        min: new Date('2020-01-01'),
        max: new Date('2030-01-01'),
      }),
      { nil: null },
    ),
    validUntil: fc.option(
      fc.date({
        min: new Date('2020-01-01'),
        max: new Date('2030-01-01'),
      }),
      { nil: null },
    ),
    delegationEnvelope: fc.constant(null),
    parentGrantId: fc.constant(null),
    revokedAt: fc.option(
      fc.date({
        min: new Date('2020-01-01'),
        max: new Date('2026-12-31'),
      }),
      { nil: null },
    ),
  }).map((g) => ({ ...g, ...overrides }));
}

function makePrincipal(overrides: Partial<Principal> = {}): Principal {
  return {
    userId: 'u1',
    displayName: 'Test',
    initials: 'T',
    locale: 'en',
    memberships: [
      {
        membershipId: 'm1',
        orgId: 'org-A',
        orgUnitId: 'ou1',
        status: 'ACTIVE',
        startDate: '2020-01-01T00:00:00.000Z',
        endDate: null,
      },
    ],
    staffTemplates: [],
    expert: null,
    context: { kind: 'organization', orgId: 'org-A' },
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

const NOW = new Date('2026-10-22T10:00:00.000Z');

function makeCtx(
  grants: readonly GrantInput[],
  overrides: Partial<AuthorizationContext> = {},
): AuthorizationContext {
  return {
    now: NOW,
    isDeactivated: false,
    isSuspended: false,
    grants,
    assignments: [],
    ancestorIds: ['ou1'],
    orgSelfApprovalAllowed: false,
    organizationTimezone: 'Europe/Belgrade',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Invariant 1: No cross-organization allow
// ---------------------------------------------------------------------------

describe('Invariant 1: No cross-organization allow', () => {
  it('a grant scoped to org A never allows access to a resource in org B', () => {
    fc.assert(
      fc.property(
        grantArb({ scopeOrgId: 'org-A', scopeType: 'organization' }),
        actionArb,
        (grant, action) => {
          const g = { ...grant, actions: [action] };
          const resource: Resource = { type: 'Item', orgId: 'org-B' };
          const ctx = makeCtx([g]);
          const decision = authorize(makePrincipal(), action, resource, ctx);
          // If allowed, the grant's orgId should match the resource orgId
          if (decision.allowed && decision.grantIds.includes(g.id)) {
            // This should never happen for org-scoped grant against different org
            expect(resource.orgId).toBe(g.scopeOrgId);
          }
        },
      ),
      { numRuns: 1000 },
    );
  });
});

// ---------------------------------------------------------------------------
// Invariant 2: Delegated never exceeds delegator
// ---------------------------------------------------------------------------

describe('Invariant 2: Delegated never exceeds delegator', () => {
  it('child grant alone never allows more than parent grant alone', () => {
    fc.assert(
      fc.property(
        actionArb,
        (action) => {
          const parentGrant: GrantInput = {
            id: 'g-parent',
            subjectUserId: 'u1',
            templateKey: 'hr_admin',
            actions: [action],
            scopeType: 'organization',
            scopeOrgId: 'org-A',
            scopeOrgUnitId: null,
            includeDescendants: false,
            scopeRefKind: null,
            scopeRefId: null,
            conditions: [],
            validFrom: null,
            validUntil: null,
            delegationEnvelope: { actions: [action] },
            parentGrantId: null,
            revokedAt: null,
          };
          const childGrant: GrantInput = {
            ...parentGrant,
            id: 'g-child',
            parentGrantId: 'g-parent',
            delegationEnvelope: null,
          };
          const resource: Resource = { type: 'Item', orgId: 'org-A' };

          // Evaluate parent alone
          const parentOnlyCtx = makeCtx([parentGrant]);
          const parentDecision = authorize(makePrincipal(), action, resource, parentOnlyCtx);

          // Evaluate child alone (parent must be in context for delegation check)
          const childOnlyCtx = makeCtx([parentGrant, childGrant]);
          const childDecision = authorize(makePrincipal(), action, resource, childOnlyCtx);

          // If child-only context allows via the child grant, parent-only must also allow
          if (childDecision.allowed && childDecision.grantIds.includes('g-child')) {
            expect(parentDecision.allowed).toBe(true);
          }
        },
      ),
      { numRuns: 1000 },
    );
  });
});

// ---------------------------------------------------------------------------
// Invariant 3: Expired never allows
// ---------------------------------------------------------------------------

describe('Invariant 3: Expired never allows', () => {
  it('a grant with validUntil in the past never produces allowed: true', () => {
    fc.assert(
      fc.property(
        actionArb,
        (action) => {
          const grant: GrantInput = {
            id: 'g-expired',
            subjectUserId: 'u1',
            templateKey: 'hr_admin',
            actions: [action],
            scopeType: 'organization',
            scopeOrgId: 'org-A',
            scopeOrgUnitId: null,
            includeDescendants: false,
            scopeRefKind: null,
            scopeRefId: null,
            conditions: [],
            validFrom: null,
            validUntil: new Date('2026-01-01T00:00:00Z'), // in the past
            delegationEnvelope: null,
            parentGrantId: null,
            revokedAt: null,
          };
          const resource: Resource = { type: 'Item', orgId: 'org-A' };
          const ctx = makeCtx([grant]);
          const decision = authorize(makePrincipal(), action, resource, ctx);
          // The expired grant should never contribute to an allow
          if (decision.grantIds.includes('g-expired')) {
            expect(decision.allowed).toBe(false);
          }
        },
      ),
      { numRuns: 1000 },
    );
  });
});

// ---------------------------------------------------------------------------
// Invariant 4: Revoked denies
// ---------------------------------------------------------------------------

describe('Invariant 4: Revoked denies after invalidation', () => {
  it('a grant with revokedAt set never produces allowed: true', () => {
    fc.assert(
      fc.property(
        actionArb,
        (action) => {
          const grant: GrantInput = {
            id: 'g-revoked',
            subjectUserId: 'u1',
            templateKey: 'hr_admin',
            actions: [action],
            scopeType: 'organization',
            scopeOrgId: 'org-A',
            scopeOrgUnitId: null,
            includeDescendants: false,
            scopeRefKind: null,
            scopeRefId: null,
            conditions: [],
            validFrom: null,
            validUntil: null,
            delegationEnvelope: null,
            parentGrantId: null,
            revokedAt: new Date('2026-10-01T00:00:00Z'),
          };
          const resource: Resource = { type: 'Item', orgId: 'org-A' };
          const ctx = makeCtx([grant]);
          const decision = authorize(makePrincipal(), action, resource, ctx);
          expect(decision.grantIds).not.toContain('g-revoked');
        },
      ),
      { numRuns: 1000 },
    );
  });
});

// ---------------------------------------------------------------------------
// Invariant 5: Confidential domain isolation
// ---------------------------------------------------------------------------

describe('Invariant 5: Confidential domain never allowed by administrative grants', () => {
  it('a grant with administrative scope never allows a confidential action', () => {
    const adminScopeTypes: ScopeType[] = [
      'platform',
      'organization',
      'org_unit',
      'assigned_clients',
      'assigned_queues',
      'assigned_practice',
      'assigned_collections',
    ];

    fc.assert(
      fc.property(
        fc.constantFrom(...adminScopeTypes),
        fc.constantFrom(
          'conversation.participate' as const,
          'conversation.read.assigned' as const,
          'notes.read.supervision' as const,
          'records.read.emergency' as const,
        ),
        (scopeType, action) => {
          const grant: GrantInput = {
            id: 'g-admin',
            subjectUserId: 'u1',
            templateKey: 'platform_owner',
            actions: [action],
            scopeType,
            scopeOrgId: 'org-A',
            scopeOrgUnitId: 'ou1',
            includeDescendants: true,
            scopeRefKind: null,
            scopeRefId: null,
            conditions: [],
            validFrom: null,
            validUntil: null,
            delegationEnvelope: null,
            parentGrantId: null,
            revokedAt: null,
          };
          const resource: Resource = {
            type: 'Conversation',
            id: 'conv1',
            orgId: 'org-A',
            isConfidential: true,
          };
          const ctx = makeCtx([grant]);
          const decision = authorize(makePrincipal(), action, resource, ctx);
          // Administrative grant should never allow confidential actions
          expect(decision.grantIds).not.toContain('g-admin');
        },
      ),
      { numRuns: 1000 },
    );
  });
});
