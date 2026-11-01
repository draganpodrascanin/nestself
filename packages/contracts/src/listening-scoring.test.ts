import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LISTENING_POLICY,
  LISTENING_DIMENSION_KEYS,
  PLATFORM_MINIMUM_COHORT,
  classifyScore,
  formatScoreTenths,
  isListeningDimensionKey,
  isStale,
  planSuppression,
  scoreTenths,
  trendTenths,
} from './listening-scoring.ts';

describe('listening scoring (spec 14.1)', () => {
  it.each([
    ['SC-01', 20, 15, 750, 'good'],
    ['SC-02', 15, 9, 600, 'monitor'],
    ['SC-03', 11, 6, 545, 'danger'],
    ['SC-04', 10, 10, 1000, 'good'],
    ['SC-05', 10, 0, 0, 'danger'],
  ] as const)('%s: %i valid, %i favorable -> %i tenths, %s', (_id, valid, favorable, tenths, status) => {
    expect(scoreTenths(favorable, valid)).toBe(tenths);
    expect(classifyScore(tenths, DEFAULT_LISTENING_POLICY)).toBe(status);
  });

  it('SC-10: zero valid answers is unavailable, never 0', () => {
    expect(scoreTenths(0, 0)).toBeNull();
  });

  it('SC-09: rounds half up at the band boundaries (59.95 -> 60.0, 74.95 -> 75.0)', () => {
    expect(scoreTenths(1199, 2000)).toBe(600);
    expect(classifyScore(600, DEFAULT_LISTENING_POLICY)).toBe('monitor');
    expect(scoreTenths(1499, 2000)).toBe(750);
    expect(classifyScore(750, DEFAULT_LISTENING_POLICY)).toBe('good');
    expect(scoreTenths(1198, 2000)).toBe(599);
    expect(classifyScore(599, DEFAULT_LISTENING_POLICY)).toBe('danger');
    expect(classifyScore(749, DEFAULT_LISTENING_POLICY)).toBe('monitor');
  });

  it('uses integer arithmetic (no binary rounding drift)', () => {
    // 2/3 = 66.666... -> 66.7
    expect(scoreTenths(2, 3)).toBe(667);
    // 1/8 = 12.5 exactly -> 12.5
    expect(scoreTenths(1, 8)).toBe(125);
    // 1/16 = 6.25 -> 6.3 (half up)
    expect(scoreTenths(1, 16)).toBe(63);
  });

  it('refuses impossible counts', () => {
    expect(() => scoreTenths(11, 10)).toThrow(RangeError);
    expect(() => scoreTenths(-1, 10)).toThrow(RangeError);
    expect(() => scoreTenths(1.5, 10)).toThrow(RangeError);
  });

  it('formats tenths with exactly one decimal', () => {
    expect(formatScoreTenths(545)).toBe('54.5');
    expect(formatScoreTenths(1000)).toBe('100.0');
    expect(formatScoreTenths(0)).toBe('0.0');
    expect(formatScoreTenths(600)).toBe('60.0');
  });

  it('SC-12: a trend is the difference in percentage points, in tenths', () => {
    expect(trendTenths(480, 560)).toBe(-80);
    expect(trendTenths(480, null)).toBeNull();
    expect(trendTenths(null, 560)).toBeNull();
  });

  it('SC-11: a latest result older than the freshness window is stale', () => {
    const closesAt = new Date('2026-09-01T00:00:00Z');
    expect(isStale(closesAt, 45, new Date('2026-10-17T00:00:01Z'))).toBe(true);
    expect(isStale(closesAt, 45, new Date('2026-10-16T00:00:00Z'))).toBe(false);
    expect(isStale(closesAt, 45, new Date('2026-09-02T00:00:00Z'))).toBe(false);
  });

  it('knows the five dimension keys and the platform floor', () => {
    expect(LISTENING_DIMENSION_KEYS).toHaveLength(5);
    expect(isListeningDimensionKey('speaking_up')).toBe(true);
    expect(isListeningDimensionKey('happiness')).toBe(false);
    expect(PLATFORM_MINIMUM_COHORT).toBe(10);
    expect(DEFAULT_LISTENING_POLICY.minimumCohort).toBe(10);
  });
});

describe('disclosure plan (spec 14.2)', () => {
  const plan = (parent: number, children: Record<string, number>) =>
    planSuppression({
      parent: { cohortKey: 'company', validCount: parent },
      children: Object.entries(children).map(([cohortKey, validCount]) => ({ cohortKey, validCount })),
      minimum: 10,
    });

  it.each([
    ['PR-01', 25, { eng: 20, ops: 5 }, 'shown', { eng: 'secondary', ops: 'primary' }],
    ['PR-02', 22, { a: 12, b: 6, c: 4 }, 'shown', { a: 'shown', b: 'primary', c: 'primary' }],
    ['PR-03', 31, { a: 12, b: 10, c: 9 }, 'shown', { a: 'shown', b: 'secondary', c: 'primary' }],
    ['PR-04', 20, { a: 10, b: 10 }, 'shown', { a: 'shown', b: 'shown' }],
    ['PR-07a', 21, { a: 12, b: 6, unassigned: 3 }, 'shown', { a: 'secondary', b: 'primary', unassigned: 'primary' }],
    ['PR-07b', 25, { a: 15, b: 7, unassigned: 3 }, 'shown', { a: 'shown', b: 'primary', unassigned: 'primary' }],
  ] as const)('%s', (_id, parent, children, parentPlan, childPlan) => {
    const result = plan(parent, children);
    expect(result.parent).toBe(parentPlan);
    expect(result.children).toEqual(childPlan);
  });

  it('PR-06: a department under the minimum stays hidden whatever its headcount', () => {
    expect(plan(40, { big: 30, small: 9 }).children.small).toBe('primary');
    // 30 is hidden too: the 9 could otherwise be read as 40 - 30 - (nothing else).
    expect(plan(40, { big: 30, small: 9 }).children.big).toBe('secondary');
  });

  it('hides the smallest shown child first and breaks ties by key', () => {
    const result = plan(50, { b: 11, a: 11, c: 20, tiny: 8 });
    expect(result.children).toEqual({ a: 'secondary', b: 'shown', c: 'shown', tiny: 'primary' });
  });

  it('withholds the parent when it is under the minimum', () => {
    const result = plan(9, { a: 9 });
    expect(result.parent).toBe('hidden');
    expect(result.children.a).toBe('primary');
  });

  it('keeps the parent when the hidden children together reach the minimum', () => {
    // One child of 12: the hidden group is empty.
    expect(plan(12, { a: 12 }).parent).toBe('shown');
    // Two children of 7: both hidden, their union of 14 is safe.
    expect(plan(14, { a: 7, b: 7 }).parent).toBe('shown');
    // 9 in a department and 1 unassigned: both hidden, the union of 10 equals the parent.
    const residual = plan(10, { a: 9, unassigned: 1 });
    expect(residual.parent).toBe('shown');
    expect(residual.children).toEqual({ a: 'primary', unassigned: 'primary' });
  });

  it('withholds the parent when no shown child can protect a hidden group that does not cover it', () => {
    expect(plan(12, { b: 2 }).parent).toBe('hidden');
  });

  it('is deterministic for the same input', () => {
    const first = plan(31, { a: 12, b: 10, c: 9 });
    const second = plan(31, { c: 9, b: 10, a: 12 });
    expect(first).toEqual(second);
  });
});
