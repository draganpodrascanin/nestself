import { describe, expect, it } from 'vitest';
import {
  DimensionCellSchema,
  ListeningConfigurationUpdateRequestSchema,
  ListeningOverviewResponseSchema,
  MySurveyResponseSchema,
  QuestionnaireDraftRequestSchema,
  SurveyAnswersSchema,
  SurveySubmitRequestSchema,
  TrendSchema,
} from './listening.ts';

const text = (value: string) => ({ en: value, 'sr-Latn': value, 'sr-Cyrl': value, hu: value });
const dimension = (key: string) => ({
  key,
  question: text(`${key}?`),
  scaleLow: text('Not at all'),
  scaleHigh: text('Completely'),
  explanation: text('Why we ask'),
});
const FIVE = ['job_satisfaction', 'sustainable_workload', 'manager_support', 'speaking_up', 'belonging_respect'];

describe('survey answers and submission', () => {
  it('accepts ratings 1..5 by dimension key and refuses other values and keys', () => {
    expect(SurveyAnswersSchema.safeParse({ job_satisfaction: 4, speaking_up: 1 }).success).toBe(true);
    expect(SurveyAnswersSchema.safeParse({ job_satisfaction: 6 }).success).toBe(false);
    expect(SurveyAnswersSchema.safeParse({ job_satisfaction: 0 }).success).toBe(false);
    expect(SurveyAnswersSchema.safeParse({ happiness: 3 }).success).toBe(false);
    expect(SurveyAnswersSchema.safeParse({ job_satisfaction: null }).success).toBe(false);
  });

  it('requires at least one rating to submit (EMP-02)', () => {
    expect(SurveySubmitRequestSchema.safeParse({ answers: {}, questionnaireVersionId: 'q1' }).success).toBe(false);
    expect(SurveySubmitRequestSchema.safeParse({ answers: { manager_support: 5 }, questionnaireVersionId: 'q1' }).success).toBe(true);
    expect(SurveySubmitRequestSchema.safeParse({ answers: { manager_support: 5 } }).success).toBe(false);
  });

  it('describes the employee survey with the applied notice and a draft or receipt', () => {
    expect(MySurveyResponseSchema.safeParse({ cycle: null }).success).toBe(true);
    const full = MySurveyResponseSchema.safeParse({
      cycle: { id: 'c1', opensAt: '2026-10-29T07:00:00.000Z', closesAt: '2026-11-05T07:00:00.000Z', timeZone: 'Europe/Belgrade', estimatedMinutes: 3 },
      questionnaire: { id: 'q1', version: 1, dimensions: FIVE.map(dimension), notice: text('Notice') },
      participation: { state: 'draft', draft: { speaking_up: 3 }, submittedAt: null },
    });
    expect(full.success).toBe(true);
  });
});

describe('configuration (CFG-01, CFG-03)', () => {
  it('never lets the reporting minimum go below the platform floor', () => {
    expect(ListeningConfigurationUpdateRequestSchema.safeParse({ minimumCohort: 9 }).success).toBe(false);
    expect(ListeningConfigurationUpdateRequestSchema.safeParse({ minimumCohort: 10 }).success).toBe(true);
    expect(ListeningConfigurationUpdateRequestSchema.safeParse({ minimumCohort: 25 }).success).toBe(true);
  });

  it('keeps the monitor threshold below the good threshold', () => {
    expect(ListeningConfigurationUpdateRequestSchema.safeParse({ goodThresholdTenths: 750, monitorThresholdTenths: 760 }).success).toBe(false);
    expect(ListeningConfigurationUpdateRequestSchema.safeParse({ goodThresholdTenths: 750, monitorThresholdTenths: 750 }).success).toBe(false);
    expect(ListeningConfigurationUpdateRequestSchema.safeParse({ goodThresholdTenths: 800, monitorThresholdTenths: 650 }).success).toBe(true);
  });

  it('limits reminders to two per cycle (spec 4.2)', () => {
    expect(ListeningConfigurationUpdateRequestSchema.safeParse({ reminderLimit: 3 }).success).toBe(false);
    expect(ListeningConfigurationUpdateRequestSchema.safeParse({ reminderLimit: 2 }).success).toBe(true);
  });
});

describe('questionnaire drafts (SUR-01)', () => {
  it('requires exactly the five dimensions, each key once', () => {
    const ok = { dimensions: FIVE.map(dimension), notice: text('Notice'), comparableWithVersionId: null };
    expect(QuestionnaireDraftRequestSchema.safeParse(ok).success).toBe(true);
    expect(QuestionnaireDraftRequestSchema.safeParse({ ...ok, dimensions: ok.dimensions.slice(0, 4) }).success).toBe(false);
    const duplicated = [...ok.dimensions.slice(0, 4), dimension('job_satisfaction')];
    expect(QuestionnaireDraftRequestSchema.safeParse({ ...ok, dimensions: duplicated }).success).toBe(false);
  });
});

describe('report cells (PRI-01)', () => {
  const shown = {
    key: 'sustainable_workload',
    scoreTenths: 480,
    score: '48.0',
    status: 'danger',
    grayReason: null,
    respondentCount: 25,
    distribution: { favorablePct: 48, neutralPct: 20, unfavorablePct: 32 },
  };

  it('accepts a shown cell and a hidden cell with nulls', () => {
    expect(DimensionCellSchema.safeParse(shown).success).toBe(true);
    expect(
      DimensionCellSchema.safeParse({
        key: 'speaking_up', scoreTenths: null, score: null, status: null, grayReason: 'privacy_suppressed', respondentCount: null, distribution: null,
      }).success,
    ).toBe(true);
  });

  it('rejects any raw count or linkage field on a public cell', () => {
    for (const extra of ['validCount', 'favorableCount', 'unfavorableCount', 'userId', 'membershipId', 'answers']) {
      expect(DimensionCellSchema.safeParse({ ...shown, [extra]: 1 }).success, extra).toBe(false);
    }
  });

  it('rejects a score that does not have exactly one decimal', () => {
    expect(DimensionCellSchema.safeParse({ ...shown, score: '48' }).success).toBe(false);
    expect(DimensionCellSchema.safeParse({ ...shown, score: '48.00' }).success).toBe(false);
  });

  it('models trends as comparable deltas or an explained absence (SCO-03)', () => {
    expect(TrendSchema.safeParse({ comparable: true, deltaTenths: -80, previousSnapshotId: 's0' }).success).toBe(true);
    expect(TrendSchema.safeParse({ comparable: false, reason: 'incompatible_version' }).success).toBe(true);
    expect(TrendSchema.safeParse({ comparable: false, deltaTenths: -80 }).success).toBe(false);
  });

  it('an overview with no published cycle has a null current block', () => {
    const parsed = ListeningOverviewResponseSchema.safeParse({
      capabilities: { measurement: true, feedback: true, workplaceReviews: false },
      collecting: null,
      current: null,
      history: [],
      reviewOffer: null,
    });
    expect(parsed.success).toBe(true);
  });
});
