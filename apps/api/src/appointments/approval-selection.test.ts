/**
 * Approver selection (T-CW-1.10, guidelines 7.4): which approval authority
 * routes a follow-up, and who may still decide one.
 */
import { describe, expect, it } from 'vitest';
import { isAuthorityCovering, mayDecide, selectApprover, type AuthorityCandidate, type UnitAncestry } from './approval-selection.js';

const NOW = new Date('2026-11-04T10:00:00.000Z');
const EMPLOYEE = 'user_jovan';

/** team_product (self) -> ou_engineering (1) -> ou_root (2). */
const ANCESTRY: UnitAncestry = { unitId: 'team_product', depthByAncestor: new Map([['team_product', 0], ['ou_engineering', 1], ['ou_root', 2]]) };

function authority(overrides: Partial<AuthorityCandidate> = {}): AuthorityCandidate {
  return {
    id: 'aa_1',
    userId: 'user_stefan',
    orgUnitId: 'team_product',
    includeDescendants: false,
    categories: [],
    validFrom: new Date('2026-01-01T00:00:00.000Z'),
    validUntil: null,
    alternateUserId: 'user_ivana',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

const select = (authorities: AuthorityCandidate[], ancestry: UnitAncestry | null = ANCESTRY, selfApprovalAllowed = false) =>
  selectApprover(authorities, { ancestry, employeeUserId: EMPLOYEE, now: NOW, selfApprovalAllowed });

describe('selectApprover', () => {
  it('routes to the authority of the employee’s own unit, with its alternate', () => {
    expect(select([authority()])).toEqual({ authorityId: 'aa_1', approverUserId: 'user_stefan', alternateUserId: 'user_ivana' });
  });

  it('an ancestor unit covers the employee only with includeDescendants', () => {
    expect(select([authority({ orgUnitId: 'ou_engineering' })])).toBeNull();
    expect(select([authority({ orgUnitId: 'ou_engineering', includeDescendants: true })])?.authorityId).toBe('aa_1');
  });

  it('another unit never covers the employee', () => {
    expect(select([authority({ orgUnitId: 'team_sales', includeDescendants: true })])).toBeNull();
  });

  it('an authority without a unit covers the whole organization, after any unit match', () => {
    const orgWide = authority({ id: 'aa_org', userId: 'user_ana', orgUnitId: null, createdAt: new Date('2025-01-01') });
    expect(select([orgWide])?.authorityId).toBe('aa_org');
    expect(select([orgWide, authority({ orgUnitId: 'ou_root', includeDescendants: true })])?.authorityId).toBe('aa_1');
    // An employee without a unit is covered by an organization-wide authority only.
    expect(select([orgWide, authority()], null)?.authorityId).toBe('aa_org');
  });

  it('the closest unit wins, then the earliest authority', () => {
    const root = authority({ id: 'aa_root', orgUnitId: 'ou_root', includeDescendants: true, createdAt: new Date('2025-01-01') });
    const dept = authority({ id: 'aa_dept', orgUnitId: 'ou_engineering', includeDescendants: true });
    expect(select([root, dept])?.authorityId).toBe('aa_dept');
    const older = authority({ id: 'aa_older', createdAt: new Date('2025-06-01') });
    const newer = authority({ id: 'aa_newer', createdAt: new Date('2026-02-01') });
    expect(select([newer, older])?.authorityId).toBe('aa_older');
  });

  it('categories must be empty or include consultation_follow_up', () => {
    expect(select([authority({ categories: ['events'] })])).toBeNull();
    expect(select([authority({ categories: ['events', 'consultation_follow_up'] })])?.authorityId).toBe('aa_1');
  });

  it('the validity window must cover now', () => {
    expect(select([authority({ validFrom: new Date('2026-12-01') })])).toBeNull();
    expect(select([authority({ validUntil: NOW })])).toBeNull();
    expect(select([authority({ validUntil: new Date('2026-11-05') })])?.authorityId).toBe('aa_1');
  });

  it('a confidential approver routes follow-ups like any other: the flag adds a capability, it reserves nothing', () => {
    const confidential = { ...authority(), isConfidentialApprover: true } as AuthorityCandidate;
    expect(select([confidential])?.authorityId).toBe('aa_1');
  });

  it('skips an authority only the employee could decide, unless self-approval is allowed', () => {
    const own = authority({ userId: EMPLOYEE, alternateUserId: null });
    expect(select([own])).toBeNull();
    expect(select([own], ANCESTRY, true)?.approverUserId).toBe(EMPLOYEE);
    // With an alternate, the alternate can decide.
    expect(select([authority({ userId: EMPLOYEE })])).toEqual({
      authorityId: 'aa_1',
      approverUserId: EMPLOYEE,
      alternateUserId: 'user_ivana',
    });
  });

  it('an alternate equal to the approver is no alternate', () => {
    expect(select([authority({ alternateUserId: 'user_stefan' })])?.alternateUserId).toBeNull();
  });
});

describe('isAuthorityCovering and mayDecide', () => {
  it('covers like the selection does', () => {
    expect(isAuthorityCovering(authority(), ANCESTRY, NOW)).toBe(true);
    expect(isAuthorityCovering(authority({ orgUnitId: 'team_sales' }), ANCESTRY, NOW)).toBe(false);
  });

  it('the approver or the alternate of a covering authority may decide; nobody else', () => {
    const authorities = [authority()];
    expect(mayDecide('user_stefan', authorities, ANCESTRY, NOW)).toBe(true);
    expect(mayDecide('user_ivana', authorities, ANCESTRY, NOW)).toBe(true);
    expect(mayDecide('user_ana', authorities, ANCESTRY, NOW)).toBe(false);
    expect(mayDecide('user_stefan', [authority({ orgUnitId: 'team_sales' })], ANCESTRY, NOW)).toBe(false);
    expect(mayDecide('user_stefan', [authority({ validUntil: new Date('2026-11-01') })], ANCESTRY, NOW)).toBe(false);
  });
});
