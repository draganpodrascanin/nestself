/**
 * Unit tests for contextScopedEffectiveActions (Defect 2, T-C1.02).
 *
 * Verifies that effective actions are filtered by the principal's active
 * context workspace.
 */
import { describe, it, expect } from 'vitest';
import { contextScopedEffectiveActions } from './effective-access.js';
import { PERMISSION_TEMPLATES } from '@nestself/contracts';
import type {
  Principal,
  AuthorizationContext,
  GrantInput,
  Action,
} from '@nestself/contracts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePrincipal(overrides: Partial<Principal> = {}): Principal {
  return {
    userId: 'user_test',
    displayName: 'Test User',
    initials: 'TU',
    locale: 'en',
    memberships: [
      {
        membershipId: 'mem_1',
        orgId: 'org_sample',
        orgUnitId: null,
        status: 'ACTIVE',
        startDate: '2026-01-01T00:00:00Z',
        endDate: null,
      },
    ],
    staffTemplates: [],
    expert: null,
    context: { kind: 'personal', orgId: 'org_sample' },
    auth: {
      method: 'email_otp',
      time: '2026-10-24T12:00:00Z',
      secondFactor: false,
      lastStepUpAt: null,
    },
    sessionId: 'sess_test',
    tokenFamily: null,
    ...overrides,
  };
}

function grantFromTemplate(templateKey: string, userId = 'user_test'): GrantInput {
  const tmpl = PERMISSION_TEMPLATES.find((t) => t.key === templateKey);
  if (!tmpl) throw new Error(`Unknown template: ${templateKey}`);
  return {
    id: `grant_${userId}_${templateKey}`,
    subjectUserId: userId,
    templateKey: tmpl.key,
    actions: [...tmpl.actions] as Action[],
    scopeType: tmpl.scopeType,
    scopeOrgId: tmpl.scopeType === 'platform' ? null : 'org_sample',
    scopeOrgUnitId: tmpl.scopeType === 'org_unit' ? 'ou_team_1' : null,
    includeDescendants: tmpl.scopeType === 'org_unit',
    scopeRefKind: null,
    scopeRefId: null,
    conditions: [],
    validFrom: new Date('2026-01-01'),
    validUntil: null,
    delegationEnvelope: null,
    parentGrantId: null,
    revokedAt: null,
  };
}

function makeCtx(grantKeys: string[], userId = 'user_test'): AuthorizationContext {
  return {
    now: new Date('2026-10-24T12:00:00Z'),
    isDeactivated: false,
    isSuspended: false,
    grants: grantKeys.map((k) => grantFromTemplate(k, userId)),
    assignments: [],
    // Include the org unit as its own ancestor so org_unit scope resolves.
    ancestorIds: ['ou_team_1'],
    orgSelfApprovalAllowed: false,
    organizationTimezone: 'Europe/Belgrade',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('contextScopedEffectiveActions', () => {
  // HR admin has employee + hr_admin grants
  const HR_GRANTS = ['employee', 'hr_admin'];

  it('HR admin personal context: no program.overview (organization workspace excluded)', () => {
    const principal = makePrincipal({
      userId: 'user_ivana',
      context: { kind: 'personal', orgId: 'org_sample' },
    });
    const ctx = makeCtx(HR_GRANTS, 'user_ivana');
    const actions = contextScopedEffectiveActions(principal, ctx);

    expect(actions).not.toContain('program.overview');
    // Employee-workspace actions still present
    expect(actions).toContain('content.read');
  });

  it('HR admin organization context: program.overview present', () => {
    const principal = makePrincipal({
      userId: 'user_ivana',
      context: { kind: 'organization', orgId: 'org_sample' },
    });
    const ctx = makeCtx(HR_GRANTS, 'user_ivana');
    const actions = contextScopedEffectiveActions(principal, ctx);

    expect(actions).toContain('program.overview');
    // Employee-workspace actions also present in organization context
    expect(actions).toContain('content.read');
  });

  it('employee personal context: content.read present', () => {
    const principal = makePrincipal({
      userId: 'user_jovan',
      context: { kind: 'personal', orgId: 'org_sample' },
    });
    const ctx = makeCtx(['employee'], 'user_jovan');
    const actions = contextScopedEffectiveActions(principal, ctx);

    expect(actions).toContain('content.read');
    expect(actions).toContain('content.bookmark');
    expect(actions).toContain('service.request');
  });

  it('manager organization context: events.request present', () => {
    const principal = makePrincipal({
      userId: 'user_stefan',
      context: { kind: 'organization', orgId: 'org_sample' },
    });
    const ctx = makeCtx(['employee', 'team_manager'], 'user_stefan');
    const actions = contextScopedEffectiveActions(principal, ctx);

    expect(actions).toContain('events.request');
  });

  it('manager personal context: events.request excluded (organization workspace)', () => {
    const principal = makePrincipal({
      userId: 'user_stefan',
      context: { kind: 'personal', orgId: 'org_sample' },
    });
    const ctx = makeCtx(['employee', 'team_manager'], 'user_stefan');
    const actions = contextScopedEffectiveActions(principal, ctx);

    expect(actions).not.toContain('events.request');
    // Employee actions still present
    expect(actions).toContain('content.read');
  });
});
