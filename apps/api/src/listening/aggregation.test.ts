/**
 * Aggregation golden tests (spec 14.1 SC-06..09, SC-13 by construction) and
 * the disclosure mapper.
 */
import { describe, expect, it } from 'vitest';
import { aggregateCells, toCell, type ResponseInput } from './aggregation.js';

const policy = { minimumCohort: 10, goodThresholdTenths: 750, monitorThresholdTenths: 600 };

const rate = (n: number, value: number, cohort: string | null = null, key = 'job_satisfaction'): ResponseInput[] =>
  Array.from({ length: n }, () => ({ cohortUnitId: cohort, answers: { [key]: value } }));

const cell = (cells: ReturnType<typeof aggregateCells>, cohortKey: string, dimensionKey: string) =>
  cells.find((c) => c.cohortKey === cohortKey && c.dimensionKey === dimensionKey)!;

describe('aggregateCells', () => {
  it('SC-06: nine valid answers are hidden and no count leaves through the mapper', () => {
    const cells = aggregateCells([...rate(8, 5), ...rate(1, 2)], policy);
    const company = cell(cells, 'company', 'job_satisfaction');
    expect(company.validCount).toBe(9);
    expect(company.scoreTenths).toBe(889);
    expect(company.suppression).toBe('primary');
    const pub = toCell(company);
    expect(pub).toEqual({ key: 'job_satisfaction', scoreTenths: null, score: null, status: null, grayReason: 'insufficient_responses', respondentCount: null, distribution: null });
  });

  it('SC-07: a dimension answered by nine of twelve submissions is hidden while the others show', () => {
    const responses: ResponseInput[] = Array.from({ length: 12 }, (_, i) => ({
      cohortUnitId: null,
      answers: (i < 9 ? { job_satisfaction: 4, speaking_up: 5 } : { speaking_up: 5 }) as Record<string, number>,
    }));
    const cells = aggregateCells(responses, policy);
    expect(cell(cells, 'company', 'job_satisfaction').suppression).toBe('primary');
    const speakingUp = cell(cells, 'company', 'speaking_up');
    expect(speakingUp.suppression).toBeNull();
    expect(speakingUp.validCount).toBe(12);
    expect(toCell(speakingUp)).toMatchObject({ score: '100.0', status: 'good', respondentCount: 12 });
  });

  it('SC-08: skipped items leave the denominator; values outside 1..5 never count', () => {
    const responses: ResponseInput[] = [
      ...rate(10, 4),
      { cohortUnitId: null, answers: { speaking_up: 3 } },
      { cohortUnitId: null, answers: { job_satisfaction: 9 } },
    ];
    const company = cell(aggregateCells(responses, policy), 'company', 'job_satisfaction');
    expect(company.validCount).toBe(10);
    expect(company.favorableCount).toBe(10);
    expect(toCell(company)).toMatchObject({ score: '100.0', status: 'good', respondentCount: 10 });
  });

  it('SC-09: boundaries classify from the rounded score', () => {
    // 1199 favorable of 2000 -> 59.95 -> 60.0 monitor
    const cells = aggregateCells([...rate(1199, 5), ...rate(801, 1)], policy);
    expect(toCell(cell(cells, 'company', 'job_satisfaction'))).toMatchObject({ score: '60.0', status: 'monitor' });
  });

  it('SC-10: zero valid answers is not_measured, never 0% or red', () => {
    const cells = aggregateCells(rate(12, 4, null, 'speaking_up'), policy);
    const empty = cell(cells, 'company', 'job_satisfaction');
    expect(empty.scoreTenths).toBeNull();
    expect(toCell(empty)).toMatchObject({ score: null, status: null, grayReason: 'not_measured', respondentCount: null });
  });

  it('PR-01 through the cohorts: 20 and 5 under a parent of 25 hides both children', () => {
    const cells = aggregateCells([...rate(20, 4, 'eng'), ...rate(5, 2, 'ops')], policy);
    expect(cell(cells, 'company', 'job_satisfaction').suppression).toBeNull();
    expect(cell(cells, 'eng', 'job_satisfaction').suppression).toBe('secondary');
    expect(cell(cells, 'ops', 'job_satisfaction').suppression).toBe('primary');
    expect(toCell(cell(cells, 'company', 'job_satisfaction'))).toMatchObject({ score: '80.0', status: 'good', respondentCount: 25 });
    // The two hidden children name different reasons but neither carries a count.
    expect(toCell(cell(cells, 'eng', 'job_satisfaction'))).toMatchObject({ grayReason: 'privacy_suppressed', respondentCount: null, score: null });
    expect(toCell(cell(cells, 'ops', 'job_satisfaction'))).toMatchObject({ grayReason: 'insufficient_responses', respondentCount: null, score: null });
  });

  it('PR-07: the residual cohort joins the hidden union', () => {
    const cells = aggregateCells([...rate(12, 4, 'a'), ...rate(6, 4, 'b'), ...rate(3, 4, null)], policy);
    expect(cell(cells, 'unassigned', 'job_satisfaction').suppression).toBe('primary');
    expect(cell(cells, 'b', 'job_satisfaction').suppression).toBe('primary');
    // hidden union 9 -> the shown child of 12 is hidden too
    expect(cell(cells, 'a', 'job_satisfaction').suppression).toBe('secondary');
  });

  it('produces five dimensions for the company and every child cohort', () => {
    const cells = aggregateCells([...rate(11, 4, 'a'), ...rate(11, 2, 'b')], policy);
    expect(cells.filter((c) => c.cohortKey === 'company')).toHaveLength(5);
    expect(cells.filter((c) => c.cohortKey === 'a')).toHaveLength(5);
    expect(cells.filter((c) => c.cohortKey === 'b')).toHaveLength(5);
    expect(cell(cells, 'a', 'job_satisfaction').cohortUnitId).toBe('a');
  });
});

describe('toCell distribution', () => {
  it('reports whole-percent shares for a shown cell', () => {
    const cells = aggregateCells([...rate(6, 5), ...rate(3, 3), ...rate(3, 1)], policy);
    expect(toCell(cell(cells, 'company', 'job_satisfaction')).distribution).toEqual({ favorablePct: 50, neutralPct: 25, unfavorablePct: 25 });
  });
});
