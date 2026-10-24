import { describe, it, expect } from 'vitest';
import { isContextValid } from './context.js';
import type { Principal, AuthorizationContext } from '@nestself/contracts';

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
    expect(isContextValid(p, CTX)).toEqual({ valid: true });
  });

  it('invalid_context when orgId does not match any membership', () => {
    const p = makePrincipal({ context: { kind: 'personal', orgId: 'org_z' } });
    expect(isContextValid(p, CTX)).toEqual({ valid: false, code: 'invalid_context' });
  });

  it('invalid_context when orgId matches an INVITED membership', () => {
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
    expect(isContextValid(p, CTX)).toEqual({ valid: false, code: 'invalid_context' });
  });

  it('org_context_expired when orgId matches an expired membership', () => {
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
    expect(isContextValid(p, CTX)).toEqual({ valid: false, code: 'org_context_expired' });
  });

  it('still valid for personal context without orgId if any ACTIVE membership exists', () => {
    const p = makePrincipal({ context: { kind: 'personal' } });
    expect(isContextValid(p, CTX)).toEqual({ valid: true });
  });

  it('org_context_expired for organization context with expired membership', () => {
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
    expect(isContextValid(p, CTX)).toEqual({ valid: false, code: 'org_context_expired' });
  });

  it('invalid_context for organization context with no membership', () => {
    const p = makePrincipal({
      memberships: [],
      context: { kind: 'organization', orgId: 'org_a' },
    });
    expect(isContextValid(p, CTX)).toEqual({ valid: false, code: 'invalid_context' });
  });
});
