import { describe, it, expect } from 'vitest';
import { personalOrgResource, operationsOrgResource } from './resolvers.js';
import { ApiHttpException } from '../common/api-error.js';
import type { Principal } from '@nestself/contracts';

// ---------------------------------------------------------------------------
// personalOrgResource
// ---------------------------------------------------------------------------

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
    context: { kind: 'personal', orgId: 'org_a' },
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

describe('personalOrgResource', () => {
  const resolver = personalOrgResource('library_content');

  it('returns resource with orgId and ownerId for valid personal context', () => {
    const principal = makePrincipal();
    const result = resolver({}, principal);
    expect(result).toEqual({
      type: 'library_content',
      id: undefined,
      orgId: 'org_a',
      ownerId: 'user-1',
    });
  });

  it('returns resource with id when id extractor is provided', () => {
    const resolverWithId = personalOrgResource('library_content', (req) => {
      const params = req['params'] as Record<string, string> | undefined;
      return params?.['contentId'];
    });
    const principal = makePrincipal();
    const result = resolverWithId({ params: { contentId: 'c-123' } }, principal);
    expect(result).toEqual({
      type: 'library_content',
      id: 'c-123',
      orgId: 'org_a',
      ownerId: 'user-1',
    });
  });

  it('throws 403 invalid_context when context is not personal', () => {
    const principal = makePrincipal({
      context: { kind: 'organization', orgId: 'org_a' },
    });
    expect(() => resolver({}, principal)).toThrow(ApiHttpException);
    try {
      resolver({}, principal);
    } catch (err) {
      const e = err as ApiHttpException;
      expect(e.getStatus()).toBe(403);
      expect(e.code).toBe('invalid_context');
    }
  });

  it('throws 403 invalid_context when personal context has no orgId', () => {
    const principal = makePrincipal({ context: { kind: 'personal' } });
    expect(() => resolver({}, principal)).toThrow(ApiHttpException);
    try {
      resolver({}, principal);
    } catch (err) {
      const e = err as ApiHttpException;
      expect(e.getStatus()).toBe(403);
      expect(e.code).toBe('invalid_context');
    }
  });

  it('throws 403 invalid_context when orgId has no membership at all', () => {
    const principal = makePrincipal({
      context: { kind: 'personal', orgId: 'org_b' },
    });
    expect(() => resolver({}, principal)).toThrow(ApiHttpException);
    try {
      resolver({}, principal);
    } catch (err) {
      const e = err as ApiHttpException;
      expect(e.code).toBe('invalid_context');
    }
  });

  it('throws 403 invalid_context when membership exists but is INVITED (Ruling A)', () => {
    const principal = makePrincipal({
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
    expect(() => resolver({}, principal)).toThrow(ApiHttpException);
    try {
      resolver({}, principal);
    } catch (err) {
      const e = err as ApiHttpException;
      expect(e.code).toBe('invalid_context');
    }
  });

  it('throws 403 org_context_expired when membership is ACTIVE but date-expired', () => {
    const principal = makePrincipal({
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
    expect(() => resolver({}, principal)).toThrow(ApiHttpException);
    try {
      resolver({}, principal);
    } catch (err) {
      const e = err as ApiHttpException;
      expect(e.code).toBe('org_context_expired');
    }
  });
});

// ---------------------------------------------------------------------------
// operationsOrgResource
// ---------------------------------------------------------------------------

const OPERATIONS_PRINCIPAL: Principal = {
  userId: 'user_nikola',
  displayName: 'Nikola',
  initials: 'N',
  locale: 'sr-Latn',
  memberships: [],
  staffTemplates: ['client_operations'],
  expert: null,
  context: { kind: 'operations' },
  auth: { method: 'password_totp', time: new Date().toISOString(), secondFactor: true, lastStepUpAt: null },
  sessionId: 'sess-1',
  tokenFamily: null,
};

function requestFor(params: Record<string, string>): Record<string, unknown> {
  return { params };
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiHttpException) {
      return err.code;
    }
    throw err;
  }
  return undefined;
}

describe('operationsOrgResource', () => {
  const resolve = operationsOrgResource('membership');

  it('returns the route organization for an operations session', () => {
    expect(resolve(requestFor({ orgId: 'org_sample' }), OPERATIONS_PRINCIPAL)).toEqual({
      type: 'membership',
      orgId: 'org_sample',
    });
  });

  it('rejects a bearer principal with session_required', () => {
    const bearer = { ...OPERATIONS_PRINCIPAL, sessionId: null };
    expect(codeOf(() => resolve(requestFor({ orgId: 'org_sample' }), bearer))).toBe('session_required');
  });

  it('rejects an organization context with context_mismatch', () => {
    const orgContext: Principal = {
      ...OPERATIONS_PRINCIPAL,
      context: { kind: 'organization', orgId: 'org_sample' },
    };
    expect(codeOf(() => resolve(requestFor({ orgId: 'org_sample' }), orgContext))).toBe('context_mismatch');
  });

  it('returns not_found without an orgId route param', () => {
    expect(codeOf(() => resolve(requestFor({}), OPERATIONS_PRINCIPAL))).toBe('not_found');
  });
});
