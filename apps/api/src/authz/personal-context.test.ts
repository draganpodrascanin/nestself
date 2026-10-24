import { describe, it, expect } from 'vitest';
import {
  computeAvailableContexts,
  canEnterContext,
  defaultContext,
  resolveDefaultPersonalOrgId,
  type AvailableContextSource,
  type AvailableContextExtras,
} from './personal-context.js';
import type { PrincipalMembership } from '@nestself/contracts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSource(overrides: Partial<AvailableContextSource> = {}): AvailableContextSource {
  return {
    memberships: [],
    staffTemplates: [],
    expert: null,
    ...overrides,
  };
}

const EMPTY_EXTRAS: AvailableContextExtras = {
  orgGrantTemplateKeys: new Map(),
  orgNames: new Map(),
};

const MEM_A: PrincipalMembership = {
  membershipId: 'mem-a',
  orgId: 'org_a',
  orgUnitId: null,
  status: 'ACTIVE',
  startDate: '2024-01-01T00:00:00Z',
  endDate: null,
};

const MEM_B: PrincipalMembership = {
  membershipId: 'mem-b',
  orgId: 'org_b',
  orgUnitId: null,
  status: 'ACTIVE',
  startDate: '2023-06-01T00:00:00Z',
  endDate: null,
};

// ---------------------------------------------------------------------------
// computeAvailableContexts
// ---------------------------------------------------------------------------

describe('computeAvailableContexts (ruling 3, T-C1.02)', () => {
  it('returns personal entry per ACTIVE, date-current membership with orgId', () => {
    const source = makeSource({ memberships: [MEM_A, MEM_B] });
    const extras: AvailableContextExtras = {
      orgGrantTemplateKeys: new Map(),
      orgNames: new Map([['org_a', 'Org A'], ['org_b', 'Org B']]),
    };
    const result = computeAvailableContexts(source, extras);

    const personals = result.filter((e) => e.kind === 'personal');
    expect(personals).toHaveLength(2);
    expect(personals.every((p) => p.kind === 'personal' && 'orgId' in p && p.orgId)).toBe(true);
    expect(personals.map((p) => p.kind === 'personal' ? p.orgId : '')).toContain('org_a');
    expect(personals.map((p) => p.kind === 'personal' ? p.orgId : '')).toContain('org_b');
  });

  it('does NOT include a bare {kind:"personal"} fallback (ruling 3)', () => {
    // User with no active memberships -> no personal entries.
    const source = makeSource({ memberships: [] });
    const result = computeAvailableContexts(source, EMPTY_EXTRAS);

    expect(result.filter((e) => e.kind === 'personal')).toHaveLength(0);
  });

  it('includes organization entry only when user holds an org-workspace template grant', () => {
    const source = makeSource({ memberships: [MEM_A] });
    const extras: AvailableContextExtras = {
      orgGrantTemplateKeys: new Map([['org_a', ['hr_admin']]]),
      orgNames: new Map([['org_a', 'Org A']]),
    };
    const result = computeAvailableContexts(source, extras);

    // hr_admin has workspace: 'organization'
    const orgEntries = result.filter((e) => e.kind === 'organization');
    expect(orgEntries).toHaveLength(1);
    expect(orgEntries[0]!.kind === 'organization' && orgEntries[0]!.orgId).toBe('org_a');
  });

  it('does NOT include organization entry when user only has employee template', () => {
    const source = makeSource({ memberships: [MEM_A] });
    const extras: AvailableContextExtras = {
      orgGrantTemplateKeys: new Map([['org_a', ['employee']]]),
      orgNames: new Map([['org_a', 'Org A']]),
    };
    const result = computeAvailableContexts(source, extras);

    expect(result.filter((e) => e.kind === 'organization')).toHaveLength(0);
  });

  it('includes expert entry when user is an expert', () => {
    const source = makeSource({ expert: { id: 'exp-1' } });
    const result = computeAvailableContexts(source, EMPTY_EXTRAS);

    expect(result.some((e) => e.kind === 'expert')).toBe(true);
  });

  it('includes operations entry when user has staff templates', () => {
    const source = makeSource({ staffTemplates: ['client_operations'] });
    const result = computeAvailableContexts(source, EMPTY_EXTRAS);

    expect(result.some((e) => e.kind === 'operations')).toBe(true);
  });

  it('skips expired memberships', () => {
    const expired: PrincipalMembership = {
      ...MEM_A,
      endDate: '2025-01-01T00:00:00Z',
    };
    const source = makeSource({ memberships: [expired] });
    const result = computeAvailableContexts(source, EMPTY_EXTRAS);

    expect(result.filter((e) => e.kind === 'personal')).toHaveLength(0);
  });

  it('skips INVITED memberships', () => {
    const invited: PrincipalMembership = {
      ...MEM_A,
      status: 'INVITED',
    };
    const source = makeSource({ memberships: [invited] });
    const result = computeAvailableContexts(source, EMPTY_EXTRAS);

    expect(result.filter((e) => e.kind === 'personal')).toHaveLength(0);
  });

  it('sorts entries by kind then orgId (tie-break)', () => {
    const source = makeSource({
      memberships: [MEM_A, MEM_B],
      staffTemplates: ['client_operations'],
    });
    const extras: AvailableContextExtras = {
      orgGrantTemplateKeys: new Map([['org_b', ['hr_admin']]]),
      orgNames: new Map(),
    };
    const result = computeAvailableContexts(source, extras);
    const kinds = result.map((e) => e.kind);

    // personal entries come first, then organization, then operations
    expect(kinds.indexOf('personal')).toBeLessThan(kinds.indexOf('organization'));
    expect(kinds.indexOf('organization')).toBeLessThan(kinds.indexOf('operations'));
  });
});

// ---------------------------------------------------------------------------
// canEnterContext
// ---------------------------------------------------------------------------

describe('canEnterContext (ruling 3, T-C1.02)', () => {
  const source = makeSource({
    memberships: [MEM_A],
    expert: { id: 'exp-1' },
    staffTemplates: ['client_operations'],
  });
  const extras: AvailableContextExtras = {
    orgGrantTemplateKeys: new Map([['org_a', ['hr_admin']]]),
    orgNames: new Map([['org_a', 'Org A']]),
  };
  const available = computeAvailableContexts(source, extras);

  it('allows personal context with matching orgId', () => {
    expect(canEnterContext(available, { kind: 'personal', orgId: 'org_a' })).toBe(true);
  });

  it('rejects personal context with non-existent orgId', () => {
    expect(canEnterContext(available, { kind: 'personal', orgId: 'org_z' })).toBe(false);
  });

  it('allows organization context for org with org-workspace grant', () => {
    expect(canEnterContext(available, { kind: 'organization', orgId: 'org_a' })).toBe(true);
  });

  it('rejects organization context for org without org-workspace grant', () => {
    // org_b is not in available because we only gave org_a the hr_admin grant
    expect(canEnterContext(available, { kind: 'organization', orgId: 'org_b' })).toBe(false);
  });

  it('allows expert context when user is an expert', () => {
    expect(canEnterContext(available, { kind: 'expert' })).toBe(true);
  });

  it('allows operations context when user has staff templates', () => {
    expect(canEnterContext(available, { kind: 'operations' })).toBe(true);
  });

  it('rejects expert context when user is not an expert', () => {
    const nonExpert = computeAvailableContexts(makeSource({ memberships: [MEM_A] }), EMPTY_EXTRAS);
    expect(canEnterContext(nonExpert, { kind: 'expert' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// defaultContext (ruling 9)
// ---------------------------------------------------------------------------

describe('defaultContext (ruling 9, T-C1.02)', () => {
  it('returns operations for staff', () => {
    const result = defaultContext({ memberships: [], staffTemplates: ['platform_owner'], expert: null });
    expect(result).toEqual({ kind: 'operations' });
  });

  it('returns expert for experts without staff templates', () => {
    const result = defaultContext({ memberships: [], staffTemplates: [], expert: { id: 'exp-1' } });
    expect(result).toEqual({ kind: 'expert' });
  });

  it('returns personal with orgId when user has an ACTIVE membership', () => {
    const result = defaultContext({ memberships: [MEM_A], staffTemplates: [], expert: null });
    expect(result).toEqual({ kind: 'personal', orgId: 'org_a' });
  });

  it('returns bare personal when user has no memberships', () => {
    const result = defaultContext({ memberships: [], staffTemplates: [], expert: null });
    expect(result).toEqual({ kind: 'personal' });
  });
});

// ---------------------------------------------------------------------------
// resolveDefaultPersonalOrgId (item 5, T-C1.02)
// ---------------------------------------------------------------------------

describe('resolveDefaultPersonalOrgId tie-break (item 5, T-C1.02)', () => {
  it('breaks equal startDate ties by orgId ascending', () => {
    const sameDate = '2024-01-01T00:00:00Z';
    const memberships: PrincipalMembership[] = [
      { membershipId: 'mem-z', orgId: 'org_z', orgUnitId: null, status: 'ACTIVE', startDate: sameDate, endDate: null },
      { membershipId: 'mem-a', orgId: 'org_a', orgUnitId: null, status: 'ACTIVE', startDate: sameDate, endDate: null },
      { membershipId: 'mem-m', orgId: 'org_m', orgUnitId: null, status: 'ACTIVE', startDate: sameDate, endDate: null },
    ];
    // All have the same startDate; should pick org_a (earliest orgId ascending)
    expect(resolveDefaultPersonalOrgId(memberships)).toBe('org_a');
  });

  it('prefers earlier startDate over orgId order', () => {
    const memberships: PrincipalMembership[] = [
      { membershipId: 'mem-z', orgId: 'org_z', orgUnitId: null, status: 'ACTIVE', startDate: '2023-01-01T00:00:00Z', endDate: null },
      { membershipId: 'mem-a', orgId: 'org_a', orgUnitId: null, status: 'ACTIVE', startDate: '2024-01-01T00:00:00Z', endDate: null },
    ];
    // org_z has earlier startDate, so it wins despite higher orgId
    expect(resolveDefaultPersonalOrgId(memberships)).toBe('org_z');
  });
});
