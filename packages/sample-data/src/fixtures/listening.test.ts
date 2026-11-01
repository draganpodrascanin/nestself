import { describe, expect, it } from 'vitest';
import {
  ListeningConfigurationResponseSchema,
  ListeningDimensionDetailResponseSchema,
  ListeningHeatmapResponseSchema,
  ListeningOverviewResponseSchema,
  MySurveyResponseSchema,
  QuestionnaireListResponseSchema,
  SurveyCycleListResponseSchema,
} from '@nestself/contracts';
import {
  SAMPLE_DIMENSION_DETAILS,
  SAMPLE_LISTENING_CONFIGURATION,
  SAMPLE_LISTENING_HEATMAP,
  SAMPLE_LISTENING_OVERVIEW,
  SAMPLE_MY_SURVEY,
  SAMPLE_QUESTIONNAIRES,
  SAMPLE_SURVEY_CYCLES,
} from './listening.ts';

describe('employee listening fixtures (ADR 0002)', () => {
  it('every fixture has the shape of the API response it stands in for', () => {
    expect(ListeningConfigurationResponseSchema.safeParse(SAMPLE_LISTENING_CONFIGURATION).success).toBe(true);
    expect(SurveyCycleListResponseSchema.safeParse(SAMPLE_SURVEY_CYCLES).success).toBe(true);
    expect(MySurveyResponseSchema.safeParse(SAMPLE_MY_SURVEY).success).toBe(true);
    expect(ListeningOverviewResponseSchema.safeParse(SAMPLE_LISTENING_OVERVIEW).success).toBe(true);
    expect(ListeningHeatmapResponseSchema.safeParse(SAMPLE_LISTENING_HEATMAP).success).toBe(true);
    expect(QuestionnaireListResponseSchema.safeParse(SAMPLE_QUESTIONNAIRES).success).toBe(true);
    for (const detail of Object.values(SAMPLE_DIMENSION_DETAILS)) {
      expect(ListeningDimensionDetailResponseSchema.safeParse(detail).success).toBe(true);
    }
  });

  it('shows every state once: a red card with an eligible offer, a hidden cell and a collecting cycle', () => {
    const cards = SAMPLE_LISTENING_OVERVIEW.current!.dimensions;
    expect(cards.map((c) => c.status)).toEqual(['monitor', 'danger', 'good', 'monitor', 'good']);
    expect(SAMPLE_LISTENING_OVERVIEW.reviewOffer).toMatchObject({ eligible: true, dimensionKeys: ['sustainable_workload'] });
    expect(SAMPLE_LISTENING_OVERVIEW.collecting).not.toBeNull();
    const commercial = SAMPLE_LISTENING_HEATMAP.rows.find((r) => r.cohortKey === 'ou_commercial')!;
    expect(commercial.cells.find((c) => c.key === 'speaking_up')!.grayReason).toBe('insufficient_responses');
  });

  it('scores are formatted from their tenths and the heatmap company row equals the cards', () => {
    for (const card of SAMPLE_LISTENING_OVERVIEW.current!.dimensions) {
      if (card.scoreTenths !== null) expect(card.score).toBe(`${Math.floor(card.scoreTenths / 10)}.${card.scoreTenths % 10}`);
    }
    const company = SAMPLE_LISTENING_HEATMAP.rows[0]!;
    expect(company.cells.map((c) => c.score)).toEqual(SAMPLE_LISTENING_OVERVIEW.current!.dimensions.map((c) => c.score));
  });
});
