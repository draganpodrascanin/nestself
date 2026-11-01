/**
 * Employee listening: the one scoring, classification, freshness, trend and
 * disclosure library (spec sections 4.3 to 4.5 and 5.2; ADR 0002, D-EL-02).
 *
 * Scores are integers in tenths of a percent: `545` is the official score
 * `54.5`. Everything here is integer arithmetic, so the backend and the web
 * apps never disagree on a boundary. The API classifies and persists; the
 * clients only format what they receive.
 */

/** The five pilot dimensions, one positively keyed question each (spec 4.1). */
export const LISTENING_DIMENSION_KEYS = [
  'job_satisfaction',
  'sustainable_workload',
  'manager_support',
  'speaking_up',
  'belonging_respect',
] as const;
export type ListeningDimensionKey = (typeof LISTENING_DIMENSION_KEYS)[number];

export function isListeningDimensionKey(value: string): value is ListeningDimensionKey {
  return (LISTENING_DIMENSION_KEYS as readonly string[]).includes(value);
}

/** Why a cell shows no score (spec 4.3). A permission denial is not one of these. */
export const GRAY_REASONS = [
  'collecting',
  'not_measured',
  'insufficient_responses',
  'privacy_suppressed',
  'stale',
] as const;
export type GrayReason = (typeof GRAY_REASONS)[number];

/** The colour bands of a reportable score (spec 4.3). */
export const SCORE_STATUSES = ['good', 'monitor', 'danger'] as const;
export type ScoreStatus = (typeof SCORE_STATUSES)[number];

/** The reporting minimum no client setting may go below (spec 5.2, CFG-03). */
export const PLATFORM_MINIMUM_COHORT = 10;

/** Pilot defaults (spec 4.2, 4.3, 16); versioned per organization as a policy. */
export const DEFAULT_LISTENING_POLICY = {
  goodTenths: 750,
  monitorTenths: 600,
  minimumCohort: PLATFORM_MINIMUM_COHORT,
  freshnessDays: 45,
  cadenceDays: 14,
  responseWindowDays: 7,
  reminderLimit: 2,
  algorithmVersion: 1,
} as const;

export interface ScoreThresholds {
  /** Scores at or above this many tenths are `good`. */
  goodTenths: number;
  /** Scores at or above this many tenths (and below `goodTenths`) are `monitor`. */
  monitorTenths: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function assertCount(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${value}`);
  }
}

/**
 * The official score in tenths: `round_half_up(1000 * favorable / valid)`.
 * `null` when nothing valid was answered (division by zero is "unavailable").
 */
export function scoreTenths(favorable: number, valid: number): number | null {
  assertCount('favorable', favorable);
  assertCount('valid', valid);
  if (valid === 0) return null;
  if (favorable > valid) throw new RangeError('favorable cannot exceed valid');
  const numerator = 1000 * favorable;
  const quotient = Math.floor(numerator / valid);
  const remainder = numerator - quotient * valid;
  return 2 * remainder >= valid ? quotient + 1 : quotient;
}

/** The band of a reportable score; the same tenths the display shows (spec 4.3). */
export function classifyScore(tenths: number, thresholds: ScoreThresholds): ScoreStatus {
  if (tenths >= thresholds.goodTenths) return 'good';
  if (tenths >= thresholds.monitorTenths) return 'monitor';
  return 'danger';
}

/** `545 -> "54.5"`, `1000 -> "100.0"`, `0 -> "0.0"`. */
export function formatScoreTenths(tenths: number): string {
  assertCount('tenths', tenths);
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

/** Change in percentage points, in tenths; `null` unless both scores are reportable. */
export function trendTenths(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return current - previous;
}

/** A latest result is stale once more than `freshnessDays` have passed since the cycle closed. */
export function isStale(closesAt: Date, freshnessDays: number, now: Date): boolean {
  return now.getTime() - closesAt.getTime() > freshnessDays * DAY_MS;
}

export interface CohortCount {
  /** `company`, an org-unit id, or `unassigned`. */
  cohortKey: string;
  /** Distinct valid respondents to the dimension in this cohort. */
  validCount: number;
}

/** `shown`, or hidden by the primary rule (too small) or by the secondary rule (protects a sibling). */
export type CohortVisibility = 'shown' | 'primary' | 'secondary';

export interface SuppressionPlan {
  parent: 'shown' | 'hidden';
  children: Record<string, CohortVisibility>;
}

/**
 * The canonical suppression plan for one dimension of a parent cohort and its
 * disjoint children (spec 5.2). Primary suppression first: every child under
 * the minimum is hidden. Then, while the hidden children together hold
 * between one and `minimum - 1` respondents, the smallest shown child is hidden
 * too (ties broken by `cohortKey`), so the hidden group cannot be reconstructed
 * by subtracting the shown children from the parent. When the parent itself is
 * under the minimum, or no shown child remains while the hidden group is still
 * too small, the parent is withheld.
 */
export function planSuppression(input: {
  parent: CohortCount;
  children: readonly CohortCount[];
  minimum: number;
}): SuppressionPlan {
  const { parent, children, minimum } = input;
  const plan: Record<string, CohortVisibility> = {};
  for (const child of children) {
    plan[child.cohortKey] = child.validCount < minimum ? 'primary' : 'shown';
  }
  if (parent.validCount < minimum) {
    for (const child of children) plan[child.cohortKey] = plan[child.cohortKey] === 'shown' ? 'secondary' : 'primary';
    return { parent: 'hidden', children: plan };
  }

  const hiddenSum = (): number =>
    children.filter((c) => plan[c.cohortKey] !== 'shown').reduce((sum, c) => sum + c.validCount, 0);

  for (;;) {
    const hidden = hiddenSum();
    if (hidden === 0 || hidden >= minimum) return { parent: 'shown', children: plan };
    const shown = children
      .filter((c) => plan[c.cohortKey] === 'shown')
      .sort((a, b) => a.validCount - b.validCount || (a.cohortKey < b.cohortKey ? -1 : a.cohortKey > b.cohortKey ? 1 : 0));
    const next = shown[0];
    if (!next) return { parent: 'hidden', children: plan };
    plan[next.cohortKey] = 'secondary';
  }
}
