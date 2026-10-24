import { describe, it, expect } from 'vitest';
import { personalOrgResource } from './resolvers.js';
import { ApiHttpException } from '../common/api-error.js';
import type { Principal } from '@nestself/contracts';

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

  it('throws 403 org_context_expired when membership exists but is INVITED', () => {
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
      expect(e.code).toBe('org_context_expired');
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
