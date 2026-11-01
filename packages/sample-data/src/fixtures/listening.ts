/**
 * Employee listening fixtures for sample mode (ADR 0002): what the workspace
 * and admin screens show when `VITE_DATA_SOURCE=sample`. Fictional values;
 * every object has the shape of the API response it stands in for, and the
 * fixture test parses each with its contract schema.
 *
 * The sample organization measures five dimensions; the latest published
 * cycle shows one dimension in the red (workload), one hidden department and
 * an eligible review invitation, so every state of the overview is visible.
 */
import {
  PILOT_PRIVACY_NOTICE,
  PILOT_QUESTIONNAIRE_DIMENSIONS,
  formatScoreTenths,
  type DimensionCard,
  type DimensionCell,
  type ListeningConfigurationResponse,
  type ListeningDimensionDetailResponse,
  type ListeningDimensionKey,
  type ListeningHeatmapResponse,
  type ListeningOverviewResponse,
  type MySurveyResponse,
  type QuestionnaireListResponse,
  type QuestionnaireVersionResponse,
  type ScoreStatus,
  type SurveyCycleListResponse,
  type Trend,
} from '@nestself/contracts';
import { SAMPLE_ORG } from './org.ts';

export const SAMPLE_QUESTIONNAIRE_V1_ID = 'questionnaire_v1';
export const SAMPLE_SNAPSHOT_CURRENT_ID = 'snapshot_sample_2026_10';
export const SAMPLE_SNAPSHOT_PREVIOUS_ID = 'snapshot_sample_2026_09';
export const SAMPLE_CYCLE_CURRENT_ID = 'cycle_sample_2026_10';
export const SAMPLE_CYCLE_PREVIOUS_ID = 'cycle_sample_2026_09';
export const SAMPLE_CYCLE_OPEN_ID = 'cycle_sample_2026_11';

export const SAMPLE_QUESTIONNAIRE: QuestionnaireVersionResponse = {
  id: SAMPLE_QUESTIONNAIRE_V1_ID,
  version: 1,
  status: 'published',
  dimensions: [...PILOT_QUESTIONNAIRE_DIMENSIONS],
  notice: PILOT_PRIVACY_NOTICE,
  comparableWithVersionId: null,
  publishedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
};

export const SAMPLE_QUESTIONNAIRE_DRAFT: QuestionnaireVersionResponse = {
  ...SAMPLE_QUESTIONNAIRE,
  id: 'questionnaire_v2_draft',
  version: 2,
  status: 'draft',
  comparableWithVersionId: SAMPLE_QUESTIONNAIRE_V1_ID,
  publishedAt: null,
  createdAt: '2026-10-28T09:00:00.000Z',
};

export const SAMPLE_QUESTIONNAIRES: QuestionnaireListResponse = {
  items: [SAMPLE_QUESTIONNAIRE_DRAFT, SAMPLE_QUESTIONNAIRE],
};

export const SAMPLE_LISTENING_CONFIGURATION: ListeningConfigurationResponse = {
  orgId: SAMPLE_ORG.id,
  measurementFrom: '2026-01-01T00:00:00.000Z',
  measurementUntil: null,
  feedbackFrom: '2026-01-01T00:00:00.000Z',
  feedbackUntil: null,
  workplaceReviewsFrom: '2026-01-01T00:00:00.000Z',
  workplaceReviewsUntil: null,
  feedbackSensitiveEnabled: false,
  cadenceDays: 14,
  responseWindowDays: 7,
  reminderLimit: 2,
  freshnessDays: 45,
  minimumCohort: 10,
  goodThresholdTenths: 750,
  monitorThresholdTenths: 600,
  algorithmVersion: 1,
  questionnaireVersionId: SAMPLE_QUESTIONNAIRE_V1_ID,
  nextLaunchAt: '2026-11-12T07:00:00.000Z',
  policyVersion: 1,
  timeZone: 'Europe/Belgrade',
  updatedAt: '2026-10-01T09:00:00.000Z',
};

export const SAMPLE_SURVEY_CYCLES: SurveyCycleListResponse = {
  items: [
    {
      id: SAMPLE_CYCLE_OPEN_ID,
      opensAt: '2026-10-29T07:00:00.000Z',
      closesAt: '2026-11-05T07:00:00.000Z',
      status: 'open',
      audienceSize: 164,
      questionnaireVersion: 1,
      publishedSnapshotId: null,
    },
    {
      id: SAMPLE_CYCLE_CURRENT_ID,
      opensAt: '2026-10-15T07:00:00.000Z',
      closesAt: '2026-10-22T07:00:00.000Z',
      status: 'published',
      audienceSize: 160,
      questionnaireVersion: 1,
      publishedSnapshotId: SAMPLE_SNAPSHOT_CURRENT_ID,
    },
    {
      id: SAMPLE_CYCLE_PREVIOUS_ID,
      opensAt: '2026-10-01T07:00:00.000Z',
      closesAt: '2026-10-08T07:00:00.000Z',
      status: 'published',
      audienceSize: 158,
      questionnaireVersion: 1,
      publishedSnapshotId: SAMPLE_SNAPSHOT_PREVIOUS_ID,
    },
  ],
  configuration: {
    cadenceDays: 14,
    responseWindowDays: 7,
    reminderLimit: 2,
    nextLaunchAt: '2026-11-12T07:00:00.000Z',
    activeMemberCount: 164,
    questionnaireVersion: 1,
    timeZone: 'Europe/Belgrade',
  },
};

/** The employee's view: the open cycle, not yet answered. */
export const SAMPLE_MY_SURVEY: MySurveyResponse = {
  cycle: {
    id: SAMPLE_CYCLE_OPEN_ID,
    opensAt: '2026-10-29T07:00:00.000Z',
    closesAt: '2026-11-05T07:00:00.000Z',
    timeZone: 'Europe/Belgrade',
    estimatedMinutes: 3,
  },
  questionnaire: {
    id: SAMPLE_QUESTIONNAIRE_V1_ID,
    version: 1,
    dimensions: [...PILOT_QUESTIONNAIRE_DIMENSIONS],
    notice: PILOT_PRIVACY_NOTICE,
  },
  participation: { state: 'invited', draft: null, submittedAt: null },
};

function shown(key: ListeningDimensionKey, tenths: number, status: ScoreStatus, respondentCount: number, favorablePct: number, neutralPct: number): DimensionCell {
  return {
    key,
    scoreTenths: tenths,
    score: formatScoreTenths(tenths),
    status,
    grayReason: null,
    respondentCount,
    distribution: { favorablePct, neutralPct, unfavorablePct: 100 - favorablePct - neutralPct },
  };
}

function hidden(key: ListeningDimensionKey, reason: 'insufficient_responses' | 'privacy_suppressed' | 'not_measured'): DimensionCell {
  return { key, scoreTenths: null, score: null, status: null, grayReason: reason, respondentCount: null, distribution: null };
}

const trend = (deltaTenths: number): Trend => ({ comparable: true, deltaTenths, previousSnapshotId: SAMPLE_SNAPSHOT_PREVIOUS_ID });

/** Company cards of the latest published cycle: one green, two amber, one red, one green. */
export const SAMPLE_DIMENSION_CARDS: DimensionCard[] = [
  { ...shown('job_satisfaction', 720, 'monitor', 131, 72, 15), trend: trend(20) },
  { ...shown('sustainable_workload', 480, 'danger', 131, 48, 20), trend: trend(-80) },
  { ...shown('manager_support', 800, 'good', 129, 80, 12), trend: trend(0) },
  { ...shown('speaking_up', 615, 'monitor', 130, 62, 18), trend: trend(-35) },
  { ...shown('belonging_respect', 850, 'good', 131, 85, 10), trend: trend(10) },
];

export const SAMPLE_LISTENING_OVERVIEW: ListeningOverviewResponse = {
  capabilities: { measurement: true, feedback: true, workplaceReviews: true },
  collecting: { cycleId: SAMPLE_CYCLE_OPEN_ID, opensAt: '2026-10-29T07:00:00.000Z', closesAt: '2026-11-05T07:00:00.000Z' },
  current: {
    snapshotId: SAMPLE_SNAPSHOT_CURRENT_ID,
    cycleId: SAMPLE_CYCLE_CURRENT_ID,
    opensAt: '2026-10-15T07:00:00.000Z',
    closesAt: '2026-10-22T07:00:00.000Z',
    publishedAt: '2026-10-22T07:05:00.000Z',
    questionnaireVersion: 1,
    stale: false,
    participation: { audienceSize: 160, submittedCount: 131 },
    dimensions: SAMPLE_DIMENSION_CARDS,
  },
  history: [
    { snapshotId: SAMPLE_SNAPSHOT_CURRENT_ID, cycleId: SAMPLE_CYCLE_CURRENT_ID, closesAt: '2026-10-22T07:00:00.000Z' },
    { snapshotId: SAMPLE_SNAPSHOT_PREVIOUS_ID, cycleId: SAMPLE_CYCLE_PREVIOUS_ID, closesAt: '2026-10-08T07:00:00.000Z' },
  ],
  reviewOffer: { eligible: true, dimensionKeys: ['sustainable_workload'], activeRequestId: null, activeEngagementId: null, dismissed: false },
};

/** Engineering (112 respondents) shows; Commercial (19) shows; the small residual group is hidden. */
export const SAMPLE_LISTENING_HEATMAP: ListeningHeatmapResponse = {
  snapshotId: SAMPLE_SNAPSHOT_CURRENT_ID,
  closesAt: '2026-10-22T07:00:00.000Z',
  stale: false,
  rows: [
    { cohortKey: 'company', name: 'company', kind: 'company', cells: SAMPLE_DIMENSION_CARDS.map(({ trend: _trend, ...cell }) => cell) },
    {
      cohortKey: 'ou_engineering',
      name: 'Engineering',
      kind: 'department',
      cells: [
        shown('job_satisfaction', 741, 'monitor', 112, 74, 14),
        shown('sustainable_workload', 455, 'danger', 112, 45, 21),
        shown('manager_support', 821, 'good', 110, 82, 10),
        shown('speaking_up', 643, 'monitor', 111, 64, 17),
        shown('belonging_respect', 866, 'good', 112, 87, 9),
      ],
    },
    {
      cohortKey: 'ou_commercial',
      name: 'Commercial',
      kind: 'department',
      cells: [
        shown('job_satisfaction', 579, 'danger', 19, 58, 21),
        shown('sustainable_workload', 632, 'monitor', 19, 63, 16),
        shown('manager_support', 684, 'monitor', 19, 68, 21),
        hidden('speaking_up', 'insufficient_responses'),
        shown('belonging_respect', 737, 'monitor', 19, 74, 16),
      ],
    },
  ],
};

const detailOf = (card: DimensionCard, previousTenths: number | null, previousStatus: ScoreStatus | null): ListeningDimensionDetailResponse => {
  const definition = PILOT_QUESTIONNAIRE_DIMENSIONS.find((d) => d.key === card.key)!;
  return {
    key: card.key,
    question: definition.question,
    scaleLow: definition.scaleLow,
    scaleHigh: definition.scaleHigh,
    explanation: definition.explanation,
    snapshotId: SAMPLE_SNAPSHOT_CURRENT_ID,
    closesAt: '2026-10-22T07:00:00.000Z',
    stale: false,
    cell: card,
    series: [
      { snapshotId: SAMPLE_SNAPSHOT_PREVIOUS_ID, closesAt: '2026-10-08T07:00:00.000Z', scoreTenths: previousTenths, status: previousStatus, grayReason: previousTenths === null ? 'insufficient_responses' : null, comparable: true },
      { snapshotId: SAMPLE_SNAPSHOT_CURRENT_ID, closesAt: '2026-10-22T07:00:00.000Z', scoreTenths: card.scoreTenths, status: card.status, grayReason: card.grayReason, comparable: true },
    ],
  };
};

export const SAMPLE_DIMENSION_DETAILS: Record<ListeningDimensionKey, ListeningDimensionDetailResponse> = {
  job_satisfaction: detailOf(SAMPLE_DIMENSION_CARDS[0]!, 700, 'monitor'),
  sustainable_workload: detailOf(SAMPLE_DIMENSION_CARDS[1]!, 560, 'danger'),
  manager_support: detailOf(SAMPLE_DIMENSION_CARDS[2]!, 800, 'good'),
  speaking_up: detailOf(SAMPLE_DIMENSION_CARDS[3]!, 650, 'monitor'),
  belonging_respect: detailOf(SAMPLE_DIMENSION_CARDS[4]!, 840, 'good'),
};
