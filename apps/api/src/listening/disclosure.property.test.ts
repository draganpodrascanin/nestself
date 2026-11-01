/**
 * Property tests of the disjoint-cohort suppression (spec 14.4 "property-based
 * tests are useful for disjoint-cohort subtraction protection"). For random
 * cohort sizes: no shown child is under the minimum, and when the parent is
 * shown, what the shown children leave hidden is either nothing or at least
 * the minimum, so no subtraction isolates a small group.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { planSuppression } from '@nestself/contracts';
import { aggregateCells } from './aggregation.js';

const cohortCounts = fc.array(fc.integer({ min: 0, max: 40 }), { minLength: 1, maxLength: 8 });

describe('planSuppression invariants', () => {
  it('never shows a child under the minimum and never leaves a reconstructable hidden group', () => {
    fc.assert(
      fc.property(cohortCounts, fc.integer({ min: 10, max: 25 }), (counts, minimum) => {
        const children = counts.map((validCount, i) => ({ cohortKey: `c${i}`, validCount }));
        const parentCount = counts.reduce((a, b) => a + b, 0);
        const plan = planSuppression({ parent: { cohortKey: 'company', validCount: parentCount }, children, minimum });
        for (const child of children) {
          if (plan.children[child.cohortKey] === 'shown') expect(child.validCount).toBeGreaterThanOrEqual(minimum);
        }
        if (plan.parent === 'shown') {
          expect(parentCount).toBeGreaterThanOrEqual(minimum);
          const hidden = children.filter((c) => plan.children[c.cohortKey] !== 'shown').reduce((a, c) => a + c.validCount, 0);
          expect(hidden === 0 || hidden >= minimum).toBe(true);
        } else {
          // A hidden parent means the whole dimension is withheld: no child shows.
          expect(Object.values(plan.children).every((v) => v !== 'shown')).toBe(true);
        }
      }),
      { numRuns: 400 },
    );
  });

  it('is independent of the order of the children', () => {
    fc.assert(
      fc.property(cohortCounts, (counts) => {
        const children = counts.map((validCount, i) => ({ cohortKey: `c${i}`, validCount }));
        const parent = { cohortKey: 'company', validCount: counts.reduce((a, b) => a + b, 0) };
        const forward = planSuppression({ parent, children, minimum: 10 });
        const backward = planSuppression({ parent, children: [...children].reverse(), minimum: 10 });
        expect(backward).toEqual(forward);
      }),
    );
  });
});

describe('aggregateCells invariants', () => {
  it('the stored counts reconcile with the raw answers and shown cells are safe', () => {
    const response = fc.record({
      cohortUnitId: fc.option(fc.constantFrom('a', 'b', 'c', 'd'), { nil: null }),
      answers: fc.dictionary(fc.constantFrom('job_satisfaction', 'speaking_up', 'manager_support'), fc.integer({ min: 1, max: 5 }), { maxKeys: 3 }),
    });
    fc.assert(
      fc.property(fc.array(response, { maxLength: 60 }), (responses) => {
        const cells = aggregateCells(responses, { minimumCohort: 10, goodThresholdTenths: 750, monitorThresholdTenths: 600 });
        for (const cell of cells) {
          expect(cell.favorableCount + cell.neutralCount + cell.unfavorableCount).toBe(cell.validCount);
          if (cell.cohortKey !== 'company' && cell.suppression === null) expect(cell.validCount).toBeGreaterThanOrEqual(10);
          if (cell.validCount === 0) expect(cell.scoreTenths).toBeNull();
        }
        const company = cells.find((c) => c.cohortKey === 'company' && c.dimensionKey === 'job_satisfaction')!;
        const children = cells.filter((c) => c.cohortKey !== 'company' && c.dimensionKey === 'job_satisfaction');
        expect(children.reduce((a, c) => a + c.validCount, 0)).toBe(company.validCount);
      }),
      { numRuns: 200 },
    );
  });
});
