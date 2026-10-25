import { describe, expect, it } from 'vitest';
import type { AuthorizationContext, GrantInput, Principal } from '@nestself/contracts';
import { effectiveActions } from './effective-access.js';

const principal: Principal = {
  userId: 'u1',
  displayName: 'Test User',
  initials: 'TU',
  locale: 'en',
  memberships: [
    {
      membershipId: 'm1',
      orgId: 'o1',
      orgName: 'Org o1',
      orgUnitId: 'ou1',
      status: 'ACTIVE',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: null,
    },
  ],
  staffTemplates: [],
  expert: null,
  context: { kind: 'organization', orgId: 'o1' },
  auth: { method: 'email_otp', time: '2026-10-22T09:00:00.000Z', secondFactor: false, lastStepUpAt: null },
  sessionId: 's1',
  tokenFamily: null,
};

const grant = (overrides: Partial<GrantInput>): GrantInput => ({
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
});

const ctx = (grants: GrantInput[]): AuthorizationContext => ({
  now: new Date('2026-10-22T10:00:00.000Z'),
  isDeactivated: false,
  isSuspended: false,
  grants,
  assignments: [],
  // As GET /auth/me builds it: no real resource, so no ancestors loaded.
  ancestorIds: [],
  orgSelfApprovalAllowed: false,
  organizationTimezone: 'Europe/Belgrade',
});

describe('effectiveActions', () => {
  it('lists the actions of an organization-scoped grant', () => {
    const actions = effectiveActions(principal, ctx([grant({ actions: ['people.invite', 'program.overview'] })]));
    expect(actions.sort()).toEqual(['people.invite', 'program.overview']);
  });

  it('includes a descendant-scoped org-unit grant although the context has no ancestors', () => {
    const unitGrant = grant({
      scopeType: 'org_unit',
      scopeOrgUnitId: 'ou1',
      includeDescendants: true,
      actions: ['budget.read'],
    });
    expect(effectiveActions(principal, ctx([unitGrant]))).toEqual(['budget.read']);
  });

  it('keeps an action when the first grant holding it is not current but a later one is', () => {
    const expired = grant({ id: 'g_old', validUntil: new Date('2026-01-01T00:00:00.000Z') });
    const otherOrg = grant({ id: 'g_other', scopeOrgId: 'o2' });
    const current = grant({ id: 'g_now' });
    expect(effectiveActions(principal, ctx([expired, otherOrg, current]))).toEqual(['people.invite']);
  });

  it('leaves out revoked, expired and future grants', () => {
    const grants = [
      grant({ id: 'r', revokedAt: new Date('2026-10-01T00:00:00.000Z') }),
      grant({ id: 'e', validUntil: new Date('2026-10-01T00:00:00.000Z') }),
      grant({ id: 'f', validFrom: new Date('2027-01-01T00:00:00.000Z') }),
    ];
    expect(effectiveActions(principal, ctx(grants))).toEqual([]);
  });

  it('is empty for a deactivated user', () => {
    expect(effectiveActions(principal, { ...ctx([grant({})]), isDeactivated: true })).toEqual([]);
  });
});
