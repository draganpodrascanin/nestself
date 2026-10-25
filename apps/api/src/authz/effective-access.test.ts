import { describe, expect, it } from 'vitest';
import type { AuthorizationContext, GrantInput, AssignmentInput, Principal } from '@nestself/contracts';
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

const assignment = (overrides: Partial<AssignmentInput>): AssignmentInput => ({
  id: 'a1',
  userId: 'u1',
  kind: 'COLLECTION',
  targetId: 'cat_stress',
  startAt: new Date('2026-01-01T00:00:00.000Z'),
  endAt: null,
  ...overrides,
});

const ctx = (
  grants: GrantInput[],
  assignments: AssignmentInput[] = [],
): AuthorizationContext => ({
  now: new Date('2026-10-22T10:00:00.000Z'),
  isDeactivated: false,
  isSuspended: false,
  grants,
  assignments,
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

  // ---------------------------------------------------------------------------
  // Assignment-scoped grants (the defect this file exercises)
  // ---------------------------------------------------------------------------

  describe('assigned_collections grant with COLLECTION assignments', () => {
    const authorGrant = grant({
      id: 'g_author',
      templateKey: 'content_author',
      actions: ['content.write', 'content.submit', 'content.preview', 'media.upload'],
      scopeType: 'assigned_collections',
      scopeOrgId: null,
      scopeRefKind: null,
      scopeRefId: null,
    });

    it('yields content.write and content.preview when two COLLECTION assignments exist', () => {
      const assignments: AssignmentInput[] = [
        assignment({ id: 'a1', kind: 'COLLECTION', targetId: 'cat_stress' }),
        assignment({ id: 'a2', kind: 'COLLECTION', targetId: 'cat_sleep' }),
      ];
      const actions = effectiveActions(principal, ctx([authorGrant], assignments));
      expect(actions).toEqual(expect.arrayContaining(['content.write', 'content.preview']));
      expect(actions).toEqual(expect.arrayContaining(['content.submit', 'media.upload']));
    });

    it('yields nothing when no assignments exist', () => {
      const actions = effectiveActions(principal, ctx([authorGrant], []));
      expect(actions).toEqual([]);
    });
  });

  describe('assigned_clients grant with CLIENT assignment', () => {
    const clientOpsGrant = grant({
      id: 'g_client_ops',
      templateKey: 'client_operations',
      actions: ['client.configure', 'people.import', 'people.onboard'],
      scopeType: 'assigned_clients',
      scopeOrgId: null,
      scopeRefKind: null,
      scopeRefId: null,
    });

    it('yields its actions when a CLIENT assignment exists', () => {
      const assignments: AssignmentInput[] = [
        assignment({ id: 'a_client', kind: 'CLIENT', targetId: 'org_acme' }),
      ];
      const actions = effectiveActions(principal, ctx([clientOpsGrant], assignments));
      expect(actions).toEqual(expect.arrayContaining(['client.configure', 'people.import', 'people.onboard']));
    });

    it('yields nothing when only a COLLECTION assignment exists (wrong kind)', () => {
      const assignments: AssignmentInput[] = [
        assignment({ id: 'a_coll', kind: 'COLLECTION', targetId: 'cat_stress' }),
      ];
      const actions = effectiveActions(principal, ctx([clientOpsGrant], assignments));
      expect(actions).toEqual([]);
    });
  });

  describe('revoked assignment-scoped grant', () => {
    it('yields nothing even with matching assignments', () => {
      const revokedGrant = grant({
        id: 'g_revoked',
        templateKey: 'content_author',
        actions: ['content.write', 'content.preview'],
        scopeType: 'assigned_collections',
        scopeOrgId: null,
        scopeRefKind: null,
        scopeRefId: null,
        revokedAt: new Date('2026-10-01T00:00:00.000Z'),
      });
      const assignments: AssignmentInput[] = [
        assignment({ id: 'a1', kind: 'COLLECTION', targetId: 'cat_stress' }),
      ];
      const actions = effectiveActions(principal, ctx([revokedGrant], assignments));
      expect(actions).toEqual([]);
    });
  });

  describe('platform-scoped editorial_lead is unchanged', () => {
    it('yields actions without any assignments', () => {
      const leadGrant = grant({
        id: 'g_lead',
        templateKey: 'editorial_lead',
        actions: ['taxonomy.manage', 'home.manage', 'content.preview', 'content.metrics.read'],
        scopeType: 'platform',
        scopeOrgId: null,
        scopeRefKind: null,
        scopeRefId: null,
      });
      const actions = effectiveActions(principal, ctx([leadGrant], []));
      expect(actions).toEqual(
        expect.arrayContaining(['taxonomy.manage', 'home.manage', 'content.preview', 'content.metrics.read']),
      );
    });
  });

  describe('expired assignment is excluded', () => {
    it('does not count an assignment that ended before ctx.now', () => {
      const authorGrant = grant({
        id: 'g_author',
        templateKey: 'content_author',
        actions: ['content.write', 'content.preview'],
        scopeType: 'assigned_collections',
        scopeOrgId: null,
        scopeRefKind: null,
        scopeRefId: null,
      });
      const expiredAssignment = assignment({
        id: 'a_expired',
        kind: 'COLLECTION',
        targetId: 'cat_stress',
        endAt: new Date('2026-06-01T00:00:00.000Z'),
      });
      const actions = effectiveActions(principal, ctx([authorGrant], [expiredAssignment]));
      expect(actions).toEqual([]);
    });
  });
});
