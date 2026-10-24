import { describe, it, expect } from 'vitest';
import { isContextValid, membershipContextCode } from './context.js';
import type { Principal, AuthorizationContext, PrincipalMembership } from '@nestself/contracts';

function makePrincipal(overrides: Partial<Principal> = {}): Principal {
  return {
    userId: 'user-1',
    displayName: 'Test',
    initials: 'T',
    locale: 'sr-Latn',
    memberships: [
      {
        membershipId: 'mem-1',
        orgId: 'org_a',
        orgUnitId: null,
        status: 'ACTIVE',
        startDate: '2024-01-01T00:00:00Z',
        endDate: null,
      },
    ],
    staffTemplates: [],
    expert: null,
    context: { kind: 'personal' },
    auth: {
      method: 'email_otp',
      time: new Date().toISOString(),
      secondFactor: false,
      lastStepUpAt: null,
    },
    sessionId: 'sess-1',
    tokenFamily: null,
    ...overrides,
  };
}

const CTX: AuthorizationContext = {
  now: new Date(),
  isDeactivated: false,
  isSuspended: false,
  grants: [],
  assignments: [],
  ancestorIds: [],
  orgSelfApprovalAllowed: false,
  organizationTimezone: 'Europe/Belgrade',
};

describe('isContextValid – personal context with orgId (ACC-R-15)', () => {
  it('valid when orgId matches an ACTIVE, date-current membership', () => {
    const p = makePrincipal({ context: { kind: 'personal', orgId: 'org_a' } });
    expect(isContextValid(p, CTX)).toBe(true);
  });

  it('invalid when orgId does not match any membership', () => {
    const p = makePrincipal({ context: { kind: 'personal', orgId: 'org_z' } });
    expect(isContextValid(p, CTX)).toBe(false);
  });

  it('invalid when orgId matches an INVITED membership', () => {
    const p = makePrincipal({
      memberships: [
        {
          membershipId: 'mem-1',
          orgId: 'org_a',
          orgUnitId: null,
          status: 'INVITED',
          startDate: '2024-01-01T00:00:00Z',
          endDate: null,
        },
      ],
      context: { kind: 'personal', orgId: 'org_a' },
    });
    expect(isContextValid(p, CTX)).toBe(false);
  });

  it('invalid when orgId matches an expired membership', () => {
    const p = makePrincipal({
      memberships: [
        {
          membershipId: 'mem-1',
          orgId: 'org_a',
          orgUnitId: null,
          status: 'ACTIVE',
          startDate: '2024-01-01T00:00:00Z',
          endDate: '2025-01-01T00:00:00Z',
        },
      ],
      context: { kind: 'personal', orgId: 'org_a' },
    });
    expect(isContextValid(p, CTX)).toBe(false);
  });

  it('still valid for personal context without orgId if any ACTIVE membership exists', () => {
    const p = makePrincipal({ context: { kind: 'personal' } });
    expect(isContextValid(p, CTX)).toBe(true);
  });

  it('invalid for organization context with expired membership', () => {
    const p = makePrincipal({
      memberships: [
        {
          membershipId: 'mem-1',
          orgId: 'org_a',
          orgUnitId: null,
          status: 'ACTIVE',
          startDate: '2024-01-01T00:00:00Z',
          endDate: '2025-01-01T00:00:00Z',
        },
      ],
      context: { kind: 'organization', orgId: 'org_a' },
    });
    expect(isContextValid(p, CTX)).toBe(false);
  });

  it('invalid for organization context with no membership', () => {
    const p = makePrincipal({
      memberships: [],
      context: { kind: 'organization', orgId: 'org_a' },
    });
    expect(isContextValid(p, CTX)).toBe(false);
  });

  it('invalid for organization context with not-yet-started membership (SYS-13)', () => {
    const p = makePrincipal({
      memberships: [
        {
          membershipId: 'mem-1',
          orgId: 'org_a',
          orgUnitId: null,
          status: 'ACTIVE',
          startDate: '2099-01-01T00:00:00Z',
          endDate: null,
        },
      ],
      context: { kind: 'organization', orgId: 'org_a' },
    });
    expect(isContextValid(p, CTX)).toBe(false);
  });

  it('invalid for personal context with not-yet-started membership', () => {
    const p = makePrincipal({
      memberships: [
        {
          membershipId: 'mem-1',
          orgId: 'org_a',
          orgUnitId: null,
          status: 'ACTIVE',
          startDate: '2099-01-01T00:00:00Z',
          endDate: null,
        },
      ],
      context: { kind: 'personal', orgId: 'org_a' },
    });
    expect(isContextValid(p, CTX)).toBe(false);
  });

  it('invalid for org context with INVITED membership (never activated)', () => {
    const p = makePrincipal({
      memberships: [
        {
          membershipId: 'mem-1',
          orgId: 'org_a',
          orgUnitId: null,
          status: 'INVITED',
          startDate: '2024-01-01T00:00:00Z',
          endDate: null,
        },
      ],
      context: { kind: 'organization', orgId: 'org_a' },
    });
    expect(isContextValid(p, CTX)).toBe(false);
  });
});

describe('membershipContextCode (used by guard and resolvers)', () => {
  const NOW = new Date('2026-10-22T10:00:00Z');

  it('returns invalid_context for INVITED membership', () => {
    const m: Pick<PrincipalMembership, 'status' | 'startDate' | 'endDate'> = {
      status: 'INVITED',
      startDate: '2024-01-01T00:00:00Z',
      endDate: null,
    };
    expect(membershipContextCode(m, NOW)).toBe('invalid_context');
  });

  it('returns invalid_context for ACTIVE membership with future startDate', () => {
    const m: Pick<PrincipalMembership, 'status' | 'startDate' | 'endDate'> = {
      status: 'ACTIVE',
      startDate: '2099-01-01T00:00:00Z',
      endDate: null,
    };
    expect(membershipContextCode(m, NOW)).toBe('invalid_context');
  });

  it('returns org_context_expired for ACTIVE membership with past endDate', () => {
    const m: Pick<PrincipalMembership, 'status' | 'startDate' | 'endDate'> = {
      status: 'ACTIVE',
      startDate: '2024-01-01T00:00:00Z',
      endDate: '2025-01-01T00:00:00Z',
    };
    expect(membershipContextCode(m, NOW)).toBe('org_context_expired');
  });
});
