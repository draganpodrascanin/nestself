import { describe, expect, it } from 'vitest';
import { can } from './principal.ts';
import type { Principal } from './auth.ts';

function makePrincipal(overrides: Partial<Principal> = {}): Principal {
  return {
    userId: 'u1',
    displayName: 'Test User',
    initials: 'TU',
    locale: 'en',
    memberships: [
      {
        membershipId: 'm1',
        orgId: 'o1',
        orgName: 'Org One',
        orgUnitId: 'ou1',
        status: 'ACTIVE',
        startDate: '2026-01-01T00:00:00Z',
        endDate: null,
      },
    ],
    staffTemplates: [],
    expert: null,
    context: { kind: 'personal' },
    auth: {
      method: 'email_otp',
      time: '2026-10-21T10:00:00Z',
      secondFactor: false,
      lastStepUpAt: null,
    },
    sessionId: 's1',
    tokenFamily: null,
    ...overrides,
  };
}

describe('can() — route-level with effectiveActions', () => {
  it('returns true when action is in effectiveActions', () => {
    const p = makePrincipal();
    expect(can(p, 'preferences.manage', undefined, ['preferences.manage', 'feedback.submit'])).toBe(true);
  });

  it('returns false when action is not in effectiveActions', () => {
    const p = makePrincipal();
    expect(can(p, 'access.grant', undefined, ['preferences.manage'])).toBe(false);
  });
});

describe('can() — personal context fallback', () => {
  it('allows own-scoped actions in personal context', () => {
    const p = makePrincipal({ context: { kind: 'personal' } });
    expect(can(p, 'preferences.manage')).toBe(true);
    expect(can(p, 'feedback.submit')).toBe(true);
    expect(can(p, 'content.read')).toBe(true);
    expect(can(p, 'content.bookmark')).toBe(true);
    expect(can(p, 'service.request')).toBe(true);
    expect(can(p, 'service.book')).toBe(true);
    expect(can(p, 'appointment.cancel')).toBe(true);
    expect(can(p, 'event.register')).toBe(true);
    expect(can(p, 'conversation.participate')).toBe(true);
    expect(can(p, 'voucher.activate')).toBe(true);
    expect(can(p, 'data.export.own')).toBe(true);
  });

  it('denies admin actions in personal context', () => {
    const p = makePrincipal({ context: { kind: 'personal' } });
    expect(can(p, 'access.grant')).toBe(false);
    expect(can(p, 'people.invite')).toBe(false);
    expect(can(p, 'budget.allocate')).toBe(false);
    expect(can(p, 'audit.read')).toBe(false);
  });
});

describe('can() — organization context', () => {
  it('returns false when resource orgId does not match context orgId', () => {
    const p = makePrincipal({ context: { kind: 'organization', orgId: 'o1' } });
    expect(can(p, 'people.invite', { orgId: 'o2' })).toBe(false);
  });

  it('returns true when resource orgId matches context orgId', () => {
    const p = makePrincipal({ context: { kind: 'organization', orgId: 'o1' } });
    expect(can(p, 'people.invite', { orgId: 'o1' })).toBe(true);
  });

  it('returns true for broad hint when no resource given and no effectiveActions', () => {
    const p = makePrincipal({ context: { kind: 'organization', orgId: 'o1' } });
    expect(can(p, 'people.invite')).toBe(true);
  });
});

describe('can() — operations context', () => {
  it('returns true when staffTemplates is non-empty', () => {
    const p = makePrincipal({
      context: { kind: 'operations' },
      staffTemplates: ['platform_owner'],
    });
    expect(can(p, 'client.create')).toBe(true);
  });

  it('returns false when staffTemplates is empty', () => {
    const p = makePrincipal({
      context: { kind: 'operations' },
      staffTemplates: [],
    });
    expect(can(p, 'client.create')).toBe(false);
  });
});

describe('can() — expert context', () => {
  it('returns true when expert is not null', () => {
    const p = makePrincipal({
      context: { kind: 'expert' },
      expert: { id: 'exp1', approvedCategories: ['psychological'] },
    });
    expect(can(p, 'case.accept')).toBe(true);
  });

  it('returns false when expert is null', () => {
    const p = makePrincipal({
      context: { kind: 'expert' },
      expert: null,
    });
    expect(can(p, 'case.accept')).toBe(false);
  });
});

describe('can() — user state', () => {
  it('returns false when userId is empty', () => {
    const p = makePrincipal({ userId: '' });
    expect(can(p, 'preferences.manage')).toBe(false);
  });
});
