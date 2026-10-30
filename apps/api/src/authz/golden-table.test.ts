/**
 * Golden decision table tests.
 *
 * Loads `golden-table.json` and runs each tuple through `authorize()`,
 * asserting the expected decision. At least 100 tuples; failures block CI.
 *
 * @see Section 4.5.12 of auth-strategy.md (AUTHZ-R-47)
 */
import { describe, it, expect } from 'vitest';
import type {
  Principal,
  Resource,
  AuthorizationContext,
  GrantInput,
  AssignmentInput,
  EmergencyAccessInput,
  Action,
  GrantCondition,
  DelegationEnvelope,
  ScopeType,
  AssignmentKind,
} from '@nestself/contracts';
import { isAction } from '@nestself/contracts';
import { GoldenTableSchema } from './golden-table.schema.js';
import type { GoldenTuple } from './golden-table.schema.js';
import { authorize } from './authorize.js';
import { explain } from './explain.js';
import goldenTableRaw from './golden-table.json' with { type: 'json' };

// ---------------------------------------------------------------------------
// Parse and validate
// ---------------------------------------------------------------------------

const tuples: GoldenTuple[] = GoldenTableSchema.parse(goldenTableRaw);

// ---------------------------------------------------------------------------
// Date parsing helpers
// ---------------------------------------------------------------------------

function parseDate(value: string | null): Date | null {
  return value != null ? new Date(value) : null;
}

function parseDateRequired(value: string): Date {
  return new Date(value);
}

function toPrincipal(raw: GoldenTuple['principal']): Principal {
  return {
    userId: raw.userId,
    displayName: raw.displayName,
    initials: raw.initials,
    locale: raw.locale,
    // The golden fixtures predate orgName; the engine never reads it.
    memberships: raw.memberships.map((m) => ({ ...m, orgName: m.orgId })),
    staffTemplates: raw.staffTemplates,
    expert: raw.expert,
    context: raw.context,
    auth: raw.auth,
    sessionId: raw.sessionId,
    tokenFamily: raw.tokenFamily,
  };
}

function toResource(raw: GoldenTuple['resource']): Resource {
  return { ...raw };
}

function toGrant(raw: GoldenTuple['ctx']['grants'][number]): GrantInput {
  return {
    id: raw.id,
    subjectUserId: raw.subjectUserId,
    templateKey: raw.templateKey,
    actions: raw.actions,
    scopeType: raw.scopeType as ScopeType,
    scopeOrgId: raw.scopeOrgId,
    scopeOrgUnitId: raw.scopeOrgUnitId,
    includeDescendants: raw.includeDescendants,
    scopeRefKind: raw.scopeRefKind,
    scopeRefId: raw.scopeRefId,
    conditions: raw.conditions as GrantCondition[],
    validFrom: parseDate(raw.validFrom),
    validUntil: parseDate(raw.validUntil),
    delegationEnvelope: raw.delegationEnvelope as DelegationEnvelope | null,
    parentGrantId: raw.parentGrantId,
    revokedAt: parseDate(raw.revokedAt),
  };
}

function toAssignment(raw: GoldenTuple['ctx']['assignments'][number]): AssignmentInput {
  return {
    id: raw.id,
    userId: raw.userId,
    kind: raw.kind as AssignmentKind,
    targetId: raw.targetId,
    startAt: parseDateRequired(raw.startAt),
    endAt: raw.endAt != null ? parseDateRequired(raw.endAt) : null,
  };
}

function toEmergencyAccess(
  raw: NonNullable<GoldenTuple['ctx']['emergencyAccess']>[number],
): EmergencyAccessInput {
  return {
    id: raw.id,
    userId: raw.userId,
    scopeKind: raw.scopeKind,
    scopeId: raw.scopeId,
    grantedAt: parseDateRequired(raw.grantedAt),
    expiresAt: parseDateRequired(raw.expiresAt),
    revokedAt: raw.revokedAt != null ? parseDateRequired(raw.revokedAt) : null,
  };
}

function toCtx(raw: GoldenTuple['ctx']): AuthorizationContext {
  return {
    now: parseDateRequired(raw.now),
    isDeactivated: raw.isDeactivated,
    isSuspended: raw.isSuspended,
    grants: raw.grants.map(toGrant),
    assignments: raw.assignments.map(toAssignment),
    ancestorIds: raw.ancestorIds,
    orgSelfApprovalAllowed: raw.orgSelfApprovalAllowed,
    organizationTimezone: raw.organizationTimezone,
    requesterId: raw.requesterId,
    delegatorGrants: raw.delegatorGrants?.map(toGrant),
    emergencyAccess: raw.emergencyAccess?.map(toEmergencyAccess),
  };
}

// ---------------------------------------------------------------------------
// Structural assertions
// ---------------------------------------------------------------------------

describe('Golden table structure', () => {
  it('has at least 100 tuples (AUTHZ-R-47)', () => {
    expect(tuples.length).toBeGreaterThanOrEqual(100);
  });

  it('every action in every tuple is in the catalogue', () => {
    for (const t of tuples) {
      expect(isAction(t.action)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Evaluate each tuple
// ---------------------------------------------------------------------------

describe('Golden table evaluation', () => {
  for (const tuple of tuples) {
    it(tuple.label, () => {
      const principal = toPrincipal(tuple.principal);
      const resource = toResource(tuple.resource);
      const ctx = toCtx(tuple.ctx);
      const action = tuple.action as Action;

      const decision = authorize(principal, action, resource, ctx);

      expect(decision.allowed).toBe(tuple.expected.allowed);
      if (tuple.expected.denialReason != null) {
        expect(decision.denialReason).toBe(tuple.expected.denialReason);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// explain() consistency (security review item 2)
// ---------------------------------------------------------------------------

describe('explain() agrees with authorize() on every golden tuple', () => {
  for (const tuple of tuples) {
    it(tuple.label, () => {
      const principal = toPrincipal(tuple.principal);
      const resource = toResource(tuple.resource);
      const ctx = toCtx(tuple.ctx);
      const action = tuple.action as Action;

      const authD = authorize(principal, action, resource, ctx);
      const explD = explain(principal, action, resource, ctx);

      expect(explD.allowed).toBe(authD.allowed);
      expect(explD.denialReason).toBe(authD.denialReason);
      expect(explD.grantIds).toEqual(authD.grantIds);
      expect(explD.assignmentIds).toEqual(authD.assignmentIds);
    });
  }
});
