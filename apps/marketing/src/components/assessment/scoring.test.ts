import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreAssessment } from './scoring';
import type { Assessment } from '@/content/schemas';

// ---------------------------------------------------------------------------
// Helpers: load the real assessment JSON files
// ---------------------------------------------------------------------------

const marketingRoot = join(
  fileURLToPath(import.meta.url),
  '..', '..', '..', '..',
);
const assessmentsDir = join(marketingRoot, 'content', 'assessments');

function loadAssessment(slug: string): Assessment {
  const raw = readFileSync(
    join(assessmentsDir, slug, 'en.json'),
    'utf-8',
  );
  return JSON.parse(raw) as Assessment;
}

// Helper: build an answers map where every question gets the same score
function uniformAnswers(
  assessment: Assessment,
  score: number,
): Record<string, number> {
  return Object.fromEntries(assessment.questions.map((q) => [q.id, score]));
}

// ---------------------------------------------------------------------------
// Wellbeing check-in (NestSelf-authored, sum-scaled-100)
// ---------------------------------------------------------------------------

describe('scoreAssessment – Wellbeing check-in', () => {
  let assessment: Assessment;

  beforeAll(() => {
    assessment = loadAssessment('wellbeing-check-in');
  });

  it('scores minimum (all zeros): raw 0, score 0, band 0-39 "Low right now"', () => {
    const answers = uniformAnswers(assessment, 0);
    const result = scoreAssessment(assessment, answers);
    expect(result.raw).toBe(0);
    expect(result.score).toBe(0);
    expect(result.band.min).toBe(0);
    expect(result.band.max).toBe(39);
    expect(result.band.title).toBe('Low right now');
  });

  it('scores maximum (all fours): raw 32, score 100, band 70-100 "Steady"', () => {
    const answers = uniformAnswers(assessment, 4);
    const result = scoreAssessment(assessment, answers);
    expect(result.raw).toBe(32);
    expect(result.score).toBe(100);
    expect(result.band.min).toBe(70);
    expect(result.band.max).toBe(100);
    expect(result.band.title).toBe('Steady');
  });

  it('scores boundary at 39: top of "Low right now" band', () => {
    // 8 questions, max score 4 each -> max raw 32.
    // To get score 39: raw/32 * 100 = 39 -> raw = 12.48
    // raw 12 -> 12/32*100 = 37.5 -> rounded 38
    // raw 13 -> 13/32*100 = 40.625 -> rounded 41 (into Mixed)
    // So score 38 is the closest we can reach in the 0-39 band with raw 12.
    const answers = uniformAnswers(assessment, 1); // raw 8
    answers['wc1'] = 2;
    answers['wc2'] = 2;
    answers['wc3'] = 2;
    answers['wc4'] = 2; // raw = 4*2 + 4*1 = 12
    const result = scoreAssessment(assessment, answers);
    expect(result.raw).toBe(12);
    // 12/32 * 100 = 37.5, rounded = 38
    expect(result.score).toBe(38);
    expect(result.band.min).toBe(0);
    expect(result.band.max).toBe(39);
  });

  it('scores boundary crossing into "Mixed" band (40-69)', () => {
    // raw 13 -> 13/32*100 = 40.625 -> rounded 41
    const answers = uniformAnswers(assessment, 1); // raw 8
    answers['wc1'] = 2;
    answers['wc2'] = 2;
    answers['wc3'] = 2;
    answers['wc4'] = 2;
    answers['wc5'] = 2; // raw = 5*2 + 3*1 = 13
    const result = scoreAssessment(assessment, answers);
    expect(result.raw).toBe(13);
    expect(result.score).toBe(41);
    expect(result.band.min).toBe(40);
    expect(result.band.max).toBe(69);
    expect(result.band.title).toBe('Mixed');
  });

  it('scores boundary at 69: top of "Mixed" band', () => {
    // raw 22 -> 22/32*100 = 68.75 -> rounded 69
    const answers = uniformAnswers(assessment, 2); // raw 16
    answers['wc1'] = 4;
    answers['wc2'] = 4;
    answers['wc3'] = 4; // raw = 3*4 + 5*2 = 22
    const result = scoreAssessment(assessment, answers);
    expect(result.raw).toBe(22);
    expect(result.score).toBe(69);
    expect(result.band.min).toBe(40);
    expect(result.band.max).toBe(69);
  });

  it('scores boundary crossing into "Steady" band (70-100)', () => {
    // raw 23 -> 23/32*100 = 71.875 -> rounded 72
    const answers = uniformAnswers(assessment, 2); // raw 16
    answers['wc1'] = 4;
    answers['wc2'] = 4;
    answers['wc3'] = 4;
    answers['wc4'] = 3; // raw = 3*4 + 1*3 + 4*2 = 23
    const result = scoreAssessment(assessment, answers);
    expect(result.raw).toBe(23);
    expect(result.score).toBe(72);
    expect(result.band.min).toBe(70);
    expect(result.band.max).toBe(100);
    expect(result.band.title).toBe('Steady');
  });
});

// ---------------------------------------------------------------------------
// Anxiety check – GAD-7 (sum, score 0-21)
// ---------------------------------------------------------------------------

describe('scoreAssessment – Anxiety check (GAD-7)', () => {
  let assessment: Assessment;

  beforeAll(() => {
    assessment = loadAssessment('anxiety-check');
  });

  it('scores minimum (all zeros): raw 0, score 0, band 0-4 "Minimal"', () => {
    const answers = uniformAnswers(assessment, 0);
    const result = scoreAssessment(assessment, answers);
    expect(result.raw).toBe(0);
    expect(result.score).toBe(0);
    expect(result.band.min).toBe(0);
    expect(result.band.max).toBe(4);
    expect(result.band.title).toBe('Minimal anxiety');
  });

  it('scores maximum (all threes): raw 21, score 21, band 15-21 "Severe"', () => {
    const answers = uniformAnswers(assessment, 3);
    const result = scoreAssessment(assessment, answers);
    expect(result.raw).toBe(21);
    expect(result.score).toBe(21);
    expect(result.band.min).toBe(15);
    expect(result.band.max).toBe(21);
    expect(result.band.title).toBe('Severe anxiety');
  });

  it('scores boundary at 4: top of "Minimal" band', () => {
    // 4 questions at 1, 3 at 0 = raw 4
    const answers = uniformAnswers(assessment, 0);
    answers['g1'] = 1;
    answers['g2'] = 1;
    answers['g3'] = 1;
    answers['g4'] = 1;
    const result = scoreAssessment(assessment, answers);
    expect(result.raw).toBe(4);
    expect(result.score).toBe(4);
    expect(result.band.min).toBe(0);
    expect(result.band.max).toBe(4);
  });

  it('scores boundary at 5: bottom of "Mild" band', () => {
    // 5 questions at 1, 2 at 0 = raw 5
    const answers = uniformAnswers(assessment, 0);
    answers['g1'] = 1;
    answers['g2'] = 1;
    answers['g3'] = 1;
    answers['g4'] = 1;
    answers['g5'] = 1;
    const result = scoreAssessment(assessment, answers);
    expect(result.raw).toBe(5);
    expect(result.score).toBe(5);
    expect(result.band.min).toBe(5);
    expect(result.band.max).toBe(9);
    expect(result.band.title).toBe('Mild anxiety');
  });

  it('scores boundary at 9: top of "Mild" band', () => {
    // All 7 at 1, plus 2 extra = 9: 2 at 2, 5 at 1 -> raw = 4 + 5 = 9
    const answers = uniformAnswers(assessment, 1); // raw 7
    answers['g1'] = 2;
    answers['g2'] = 2; // raw = 2*2 + 5*1 = 9
    const result = scoreAssessment(assessment, answers);
    expect(result.raw).toBe(9);
    expect(result.score).toBe(9);
    expect(result.band.min).toBe(5);
    expect(result.band.max).toBe(9);
  });

  it('scores boundary at 10: bottom of "Moderate" band', () => {
    // 3 at 2, 4 at 1 -> raw = 6 + 4 = 10
    const answers = uniformAnswers(assessment, 1); // raw 7
    answers['g1'] = 2;
    answers['g2'] = 2;
    answers['g3'] = 2; // raw = 3*2 + 4*1 = 10
    const result = scoreAssessment(assessment, answers);
    expect(result.raw).toBe(10);
    expect(result.score).toBe(10);
    expect(result.band.min).toBe(10);
    expect(result.band.max).toBe(14);
    expect(result.band.title).toBe('Moderate anxiety');
  });

  it('scores boundary at 14: top of "Moderate" band', () => {
    const answers = uniformAnswers(assessment, 2); // raw 14
    const result = scoreAssessment(assessment, answers);
    expect(result.raw).toBe(14);
    expect(result.score).toBe(14);
    expect(result.band.min).toBe(10);
    expect(result.band.max).toBe(14);
  });

  it('scores boundary at 15: bottom of "Severe" band', () => {
    // all at 2 plus one extra: 1 at 3, 6 at 2 -> raw = 3 + 12 = 15
    const answers = uniformAnswers(assessment, 2); // raw 14
    answers['g1'] = 3; // raw = 3 + 6*2 = 15
    const result = scoreAssessment(assessment, answers);
    expect(result.raw).toBe(15);
    expect(result.score).toBe(15);
    expect(result.band.min).toBe(15);
    expect(result.band.max).toBe(21);
    expect(result.band.title).toBe('Severe anxiety');
  });
});

// ---------------------------------------------------------------------------
// Copenhagen Burnout Inventory (mean)
// ---------------------------------------------------------------------------

describe('scoreAssessment – Burnout check (CBI)', () => {
  let assessment: Assessment;

  beforeAll(() => {
    assessment = loadAssessment('burnout-check');
  });

  it('scores minimum (all zeros): raw 0, score 0, band 0-49', () => {
    const answers = uniformAnswers(assessment, 0);
    const result = scoreAssessment(assessment, answers);
    expect(result.raw).toBe(0);
    expect(result.score).toBe(0);
    expect(result.band.min).toBe(0);
    expect(result.band.max).toBe(49);
  });

  it('scores maximum (all 100s): raw 600, score 100, band 100-100', () => {
    const answers = uniformAnswers(assessment, 100);
    const result = scoreAssessment(assessment, answers);
    expect(result.raw).toBe(600);
    expect(result.score).toBe(100);
    expect(result.band.min).toBe(100);
    expect(result.band.max).toBe(100);
  });

  it('scores boundary at 49-50: mean 50 falls into band 50-74', () => {
    // 6 questions, scores 50 each: mean = 50
    const answers = uniformAnswers(assessment, 50);
    const result = scoreAssessment(assessment, answers);
    expect(result.score).toBe(50);
    expect(result.band.min).toBe(50);
    expect(result.band.max).toBe(74);
  });

  it('scores boundary at 74-75: mean 75 falls into band 75-99', () => {
    const answers = uniformAnswers(assessment, 75);
    const result = scoreAssessment(assessment, answers);
    expect(result.score).toBe(75);
    expect(result.band.min).toBe(75);
    expect(result.band.max).toBe(99);
  });

  it('scores mixed values correctly', () => {
    // 0, 25, 50, 75, 100, 50 -> sum 300, mean 50
    const answers: Record<string, number> = {
      b1: 0,
      b2: 25,
      b3: 50,
      b4: 75,
      b5: 100,
      b6: 50,
    };
    const result = scoreAssessment(assessment, answers);
    expect(result.raw).toBe(300);
    expect(result.score).toBe(50);
    expect(result.band.min).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Workplace stress check (sum-scaled-100)
// ---------------------------------------------------------------------------

describe('scoreAssessment – Workplace stress check', () => {
  let assessment: Assessment;

  beforeAll(() => {
    assessment = loadAssessment('workplace-stress-check');
  });

  it('scores minimum (all zeros): raw 0, score 0, band 0-25', () => {
    const answers = uniformAnswers(assessment, 0);
    const result = scoreAssessment(assessment, answers);
    expect(result.raw).toBe(0);
    expect(result.score).toBe(0);
    expect(result.band.min).toBe(0);
    expect(result.band.max).toBe(25);
  });

  it('scores maximum (all fours): raw 32, score 100, band 76-100', () => {
    const answers = uniformAnswers(assessment, 4);
    const result = scoreAssessment(assessment, answers);
    expect(result.raw).toBe(32);
    expect(result.score).toBe(100);
    expect(result.band.min).toBe(76);
    expect(result.band.max).toBe(100);
  });

  it('scores boundary at 25: sum 8 of 32 = 25%, band 0-25', () => {
    // 8 questions, max 4 each -> max raw 32.  8/32 * 100 = 25
    const answers = uniformAnswers(assessment, 1);
    const result = scoreAssessment(assessment, answers);
    expect(result.raw).toBe(8);
    expect(result.score).toBe(25);
    expect(result.band.min).toBe(0);
    expect(result.band.max).toBe(25);
  });

  it('scores boundary at 26: crosses into band 26-50', () => {
    // 9/32 * 100 = 28.125 -> rounded to 28
    const answers = uniformAnswers(assessment, 1);
    answers['ws1'] = 2; // total 9
    const result = scoreAssessment(assessment, answers);
    expect(result.raw).toBe(9);
    // 9/32 * 100 = 28.125, rounded = 28
    expect(result.score).toBe(28);
    expect(result.band.min).toBe(26);
  });

  it('scores boundary at 50-51', () => {
    // 16/32 * 100 = 50
    const answers = uniformAnswers(assessment, 2);
    const result = scoreAssessment(assessment, answers);
    expect(result.raw).toBe(16);
    expect(result.score).toBe(50);
    expect(result.band.min).toBe(26);
    expect(result.band.max).toBe(50);
  });

  it('scores boundary crossing into 51-75 band', () => {
    // 17/32 * 100 = 53.125 -> rounded 53
    const answers = uniformAnswers(assessment, 2);
    answers['ws1'] = 3; // total 17
    const result = scoreAssessment(assessment, answers);
    expect(result.raw).toBe(17);
    expect(result.score).toBe(53);
    expect(result.band.min).toBe(51);
  });

  it('scores boundary at 75: band 51-75', () => {
    // 8 questions all answered 3: raw 24, 24/32 * 100 = 75
    const answers = uniformAnswers(assessment, 3);
    const result = scoreAssessment(assessment, answers);
    expect(result.raw).toBe(24);
    expect(result.score).toBe(75);
    expect(result.band.min).toBe(51);
    expect(result.band.max).toBe(75);
  });

  it('scores boundary crossing into 76-100: band 76-100', () => {
    // 7 answers of 3 + 1 answer of 4: raw 25, 25/32 * 100 = 78.125 -> rounded 78
    const answers = uniformAnswers(assessment, 3);
    answers['ws1'] = 4; // total 25
    const result = scoreAssessment(assessment, answers);
    expect(result.raw).toBe(25);
    expect(result.score).toBe(78);
    expect(result.band.min).toBe(76);
  });
});

// ---------------------------------------------------------------------------
// Financial wellbeing check (sum-scaled-100)
// ---------------------------------------------------------------------------

describe('scoreAssessment – Financial wellbeing check', () => {
  let assessment: Assessment;

  beforeAll(() => {
    assessment = loadAssessment('financial-wellbeing-check');
  });

  it('scores minimum (all zeros): raw 0, score 0, band 0-25', () => {
    const answers = uniformAnswers(assessment, 0);
    const result = scoreAssessment(assessment, answers);
    expect(result.raw).toBe(0);
    expect(result.score).toBe(0);
    expect(result.band.min).toBe(0);
    expect(result.band.max).toBe(25);
  });

  it('scores maximum (all fours): raw 32, score 100, band 76-100', () => {
    const answers = uniformAnswers(assessment, 4);
    const result = scoreAssessment(assessment, answers);
    expect(result.raw).toBe(32);
    expect(result.score).toBe(100);
    expect(result.band.min).toBe(76);
    expect(result.band.max).toBe(100);
  });

  it('scores boundary at 25: band 0-25', () => {
    const answers = uniformAnswers(assessment, 1);
    const result = scoreAssessment(assessment, answers);
    expect(result.score).toBe(25);
    expect(result.band.max).toBe(25);
  });

  it('scores boundary at 50: band 26-50', () => {
    const answers = uniformAnswers(assessment, 2);
    const result = scoreAssessment(assessment, answers);
    expect(result.score).toBe(50);
    expect(result.band.min).toBe(26);
    expect(result.band.max).toBe(50);
  });

  it('scores boundary at 75: band 51-75', () => {
    const answers = uniformAnswers(assessment, 3);
    const result = scoreAssessment(assessment, answers);
    expect(result.score).toBe(75);
    expect(result.band.min).toBe(51);
    expect(result.band.max).toBe(75);
  });

  it('scores boundary crossing into 76-100: band 76-100', () => {
    // 25/32 * 100 = 78.125 -> rounded 78
    const answers = uniformAnswers(assessment, 3);
    answers['fw1'] = 4; // total 25
    const result = scoreAssessment(assessment, answers);
    expect(result.raw).toBe(25);
    expect(result.score).toBe(78);
    expect(result.band.min).toBe(76);
  });
});
