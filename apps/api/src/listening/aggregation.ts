/**
 * Aggregation and disclosure (spec 4.3, 5.2, SCO-01, PRI-01, PRI-02). Pure
 * functions: the finalizer feeds them the accepted responses and the locked
 * policy and persists what comes back; `toCell` is the only mapper from a
 * stored cell to the public DTO, used by cards, heatmap, detail, export and
 * the review pack alike.
 */
import {
  LISTENING_DIMENSION_KEYS,
  classifyScore,
  formatScoreTenths,
  planSuppression,
  scoreTenths,
  type DimensionCell,
  type GrayReason,
  type ListeningDimensionKey,
  type ScoreStatus,
} from '@nestself/contracts';
import { COMPANY_COHORT, UNASSIGNED_COHORT } from './audience.js';
import type { CellRow } from './listening.repository.js';

export interface ResponseInput {
  cohortUnitId: string | null;
  answers: Record<string, number>;
}

export interface PolicyInput {
  minimumCohort: number;
  goodThresholdTenths: number;
  monitorThresholdTenths: number;
}

/** A computed cell before it is stored: counts, score, status and the disclosure decision. */
export interface ComputedCell {
  cohortKey: string;
  cohortUnitId: string | null;
  dimensionKey: ListeningDimensionKey;
  validCount: number;
  favorableCount: number;
  neutralCount: number;
  unfavorableCount: number;
  scoreTenths: number | null;
  status: ScoreStatus | null;
  suppression: 'primary' | 'secondary' | null;
}

function isValidAnswer(value: unknown): value is 1 | 2 | 3 | 4 | 5 {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 5;
}

function countCell(
  cohortKey: string,
  cohortUnitId: string | null,
  dimensionKey: ListeningDimensionKey,
  responses: readonly ResponseInput[],
  policy: PolicyInput,
): ComputedCell {
  let valid = 0;
  let favorable = 0;
  let neutral = 0;
  let unfavorable = 0;
  for (const response of responses) {
    const value = response.answers[dimensionKey];
    if (!isValidAnswer(value)) continue;
    valid += 1;
    if (value >= 4) favorable += 1;
    else if (value === 3) neutral += 1;
    else unfavorable += 1;
  }
  const tenths = scoreTenths(favorable, valid);
  return {
    cohortKey,
    cohortUnitId,
    dimensionKey,
    validCount: valid,
    favorableCount: favorable,
    neutralCount: neutral,
    unfavorableCount: unfavorable,
    scoreTenths: tenths,
    status: tenths === null ? null : classifyScore(tenths, { goodTenths: policy.goodThresholdTenths, monitorTenths: policy.monitorThresholdTenths }),
    suppression: null,
  };
}

/**
 * Every cell of a cycle: the company and one disjoint child cohort per
 * distinct `cohortUnitId` (plus `unassigned` for null), five dimensions each,
 * with the canonical suppression plan applied per dimension.
 */
export function aggregateCells(responses: readonly ResponseInput[], policy: PolicyInput): ComputedCell[] {
  const childKeys = new Map<string, string | null>();
  for (const response of responses) {
    const key = response.cohortUnitId ?? UNASSIGNED_COHORT;
    if (!childKeys.has(key)) childKeys.set(key, response.cohortUnitId);
  }
  const cells: ComputedCell[] = [];
  for (const dimensionKey of LISTENING_DIMENSION_KEYS) {
    const parent = countCell(COMPANY_COHORT, null, dimensionKey, responses, policy);
    const children = [...childKeys.entries()].map(([cohortKey, cohortUnitId]) =>
      countCell(
        cohortKey,
        cohortUnitId,
        dimensionKey,
        responses.filter((r) => (r.cohortUnitId ?? UNASSIGNED_COHORT) === cohortKey),
        policy,
      ),
    );
    const plan = planSuppression({
      parent: { cohortKey: COMPANY_COHORT, validCount: parent.validCount },
      children: children.map((c) => ({ cohortKey: c.cohortKey, validCount: c.validCount })),
      minimum: policy.minimumCohort,
    });
    parent.suppression = plan.parent === 'hidden' ? 'primary' : null;
    for (const child of children) {
      const decision = plan.children[child.cohortKey];
      child.suppression = decision === 'shown' || decision === undefined ? null : decision;
    }
    cells.push(parent, ...children);
  }
  return cells;
}

/** The whole-percent shares of a shown cell; they sum to 100 give or take rounding. */
function distribution(cell: Pick<CellRow, 'validCount' | 'favorableCount' | 'neutralCount' | 'unfavorableCount'>) {
  if (cell.validCount === 0) return null;
  const pct = (n: number) => Math.round((100 * n) / cell.validCount);
  return { favorablePct: pct(cell.favorableCount), neutralPct: pct(cell.neutralCount), unfavorablePct: pct(cell.unfavorableCount) };
}

/**
 * The public cell of a stored row: score, status, respondent count and the
 * distribution for a shown cell; nulls and a gray reason otherwise (spec 4.3):
 * `not_measured` when nobody answered, `insufficient_responses` when fewer
 * than the minimum did, `privacy_suppressed` when the cell is withheld to
 * protect a sibling. Counts never leave for a hidden cell. `stale` applies to
 * the current overview only; historical reports keep their status.
 */
export function toCell(
  row: Pick<CellRow, 'dimensionKey' | 'validCount' | 'favorableCount' | 'neutralCount' | 'unfavorableCount' | 'scoreTenths' | 'status' | 'suppression'>,
): DimensionCell {
  const key = row.dimensionKey as ListeningDimensionKey;
  if (row.validCount === 0 || row.scoreTenths === null || row.status === null) {
    return hiddenCell(key, 'not_measured');
  }
  if (row.suppression === 'primary') {
    return hiddenCell(key, 'insufficient_responses');
  }
  if (row.suppression !== null) {
    return hiddenCell(key, 'privacy_suppressed');
  }
  return {
    key,
    scoreTenths: row.scoreTenths,
    score: formatScoreTenths(row.scoreTenths),
    status: row.status as ScoreStatus,
    grayReason: null,
    respondentCount: row.validCount,
    distribution: distribution(row),
  };
}

export function hiddenCell(key: ListeningDimensionKey, reason: GrayReason): DimensionCell {
  return { key, scoreTenths: null, score: null, status: null, grayReason: reason, respondentCount: null, distribution: null };
}
