import { describe, expect, it } from 'vitest';
import type { Principal } from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import { operationsOrgResource } from './resolvers.js';

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
