/**
 * Employee listening contracts: questionnaire versions, client configuration,
 * survey cycles, the employee's survey, the protected reports and the review
 * offer (spec sections 4, 5, 7 and 10; ADR 0002).
 *
 * Report DTOs are `strictObject`s: a stored cell carries raw counts, a public
 * cell never does (spec PRI-01 "the public response schema cannot
 * accidentally serialize protected numerator/denominator or linkage fields").
 */
import { z } from 'zod';
import {
  GRAY_REASONS,
  LISTENING_DIMENSION_KEYS,
  PLATFORM_MINIMUM_COHORT,
  SCORE_STATUSES,
} from './listening-scoring.ts';

const idField = z.string().min(1);
const isoDateTime = z.string().datetime();

/** One wording in every interface locale; `sr-Cyrl` is the transliteration of `sr-Latn`. */
export const LocalizedTextSchema = z.object({
  en: z.string().min(1).max(500),
  'sr-Latn': z.string().min(1).max(500),
  'sr-Cyrl': z.string().min(1).max(500),
  hu: z.string().min(1).max(500),
});
export type LocalizedText = z.infer<typeof LocalizedTextSchema>;

/** A longer localized text (the privacy notice). */
export const LocalizedLongTextSchema = z.object({
  en: z.string().min(1).max(5000),
  'sr-Latn': z.string().min(1).max(5000),
  'sr-Cyrl': z.string().min(1).max(5000),
  hu: z.string().min(1).max(5000),
});
export type LocalizedLongText = z.infer<typeof LocalizedLongTextSchema>;

export const ListeningDimensionKeySchema = z.enum(LISTENING_DIMENSION_KEYS);

// ---------------------------------------------------------------------------
// Questionnaire versions (SUR-01, CFG-03)
// ---------------------------------------------------------------------------

export const QUESTIONNAIRE_STATUSES = ['draft', 'in_review', 'published', 'archived'] as const;
export const QuestionnaireStatusSchema = z.enum(QUESTIONNAIRE_STATUSES);
export type QuestionnaireStatus = z.infer<typeof QuestionnaireStatusSchema>;

/** One positively keyed 1..5 question; the key, scale direction and wording are preserved per version (spec 4.1). */
export const QuestionnaireDimensionSchema = z.strictObject({
  key: ListeningDimensionKeySchema,
  question: LocalizedTextSchema,
  scaleLow: LocalizedTextSchema,
  scaleHigh: LocalizedTextSchema,
  explanation: LocalizedTextSchema,
});
export type QuestionnaireDimension = z.infer<typeof QuestionnaireDimensionSchema>;

const fiveDimensions = z
  .array(QuestionnaireDimensionSchema)
  .length(LISTENING_DIMENSION_KEYS.length)
  .refine(
    (dims) => new Set(dims.map((d) => d.key)).size === LISTENING_DIMENSION_KEYS.length,
    { message: 'Every dimension key appears exactly once' },
  );

export const QuestionnaireDraftRequestSchema = z.strictObject({
  dimensions: fiveDimensions,
  notice: LocalizedLongTextSchema,
  /** The published version this one stays comparable with (same meaning and scale), or null. */
  comparableWithVersionId: idField.nullable(),
});
export type QuestionnaireDraftRequest = z.infer<typeof QuestionnaireDraftRequestSchema>;

export const QuestionnaireVersionResponseSchema = z.strictObject({
  id: idField,
  version: z.number().int().positive(),
  status: QuestionnaireStatusSchema,
  dimensions: z.array(QuestionnaireDimensionSchema),
  notice: LocalizedLongTextSchema,
  comparableWithVersionId: idField.nullable(),
  publishedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});
export type QuestionnaireVersionResponse = z.infer<typeof QuestionnaireVersionResponseSchema>;

export const QuestionnaireListResponseSchema = z.strictObject({
  items: z.array(QuestionnaireVersionResponseSchema),
});
export type QuestionnaireListResponse = z.infer<typeof QuestionnaireListResponseSchema>;

// ---------------------------------------------------------------------------
// Client configuration (CFG-01, CFG-03)
// ---------------------------------------------------------------------------

const policyNumbers = {
  cadenceDays: z.number().int().min(7).max(365),
  responseWindowDays: z.number().int().min(1).max(60),
  reminderLimit: z.number().int().min(0).max(2),
  freshnessDays: z.number().int().min(7).max(365),
  /** Never below the platform floor (spec CFG-03). */
  minimumCohort: z.number().int().min(PLATFORM_MINIMUM_COHORT).max(1000),
  goodThresholdTenths: z.number().int().min(0).max(1000),
  monitorThresholdTenths: z.number().int().min(0).max(1000),
};

const thresholdsOrdered = (v: { goodThresholdTenths?: number; monitorThresholdTenths?: number }) =>
  v.goodThresholdTenths === undefined ||
  v.monitorThresholdTenths === undefined ||
  v.monitorThresholdTenths < v.goodThresholdTenths;
const thresholdsIssue = {
  message: 'monitorThresholdTenths must be below goodThresholdTenths',
  path: ['monitorThresholdTenths'],
};

export const ListeningConfigurationResponseSchema = z.strictObject({
  orgId: idField,
  measurementFrom: isoDateTime.nullable(),
  measurementUntil: isoDateTime.nullable(),
  feedbackFrom: isoDateTime.nullable(),
  feedbackUntil: isoDateTime.nullable(),
  workplaceReviewsFrom: isoDateTime.nullable(),
  workplaceReviewsUntil: isoDateTime.nullable(),
  feedbackSensitiveEnabled: z.boolean(),
  ...policyNumbers,
  algorithmVersion: z.number().int().positive(),
  questionnaireVersionId: idField.nullable(),
  nextLaunchAt: isoDateTime.nullable(),
  policyVersion: z.number().int().positive(),
  timeZone: z.string().min(1),
  updatedAt: isoDateTime,
});
export type ListeningConfigurationResponse = z.infer<typeof ListeningConfigurationResponseSchema>;

export const ListeningConfigurationUpdateRequestSchema = z
  .strictObject({
    measurementFrom: isoDateTime.nullable().optional(),
    measurementUntil: isoDateTime.nullable().optional(),
    feedbackFrom: isoDateTime.nullable().optional(),
    feedbackUntil: isoDateTime.nullable().optional(),
    workplaceReviewsFrom: isoDateTime.nullable().optional(),
    workplaceReviewsUntil: isoDateTime.nullable().optional(),
    feedbackSensitiveEnabled: z.boolean().optional(),
    cadenceDays: policyNumbers.cadenceDays.optional(),
    responseWindowDays: policyNumbers.responseWindowDays.optional(),
    reminderLimit: policyNumbers.reminderLimit.optional(),
    freshnessDays: policyNumbers.freshnessDays.optional(),
    minimumCohort: policyNumbers.minimumCohort.optional(),
    goodThresholdTenths: policyNumbers.goodThresholdTenths.optional(),
    monitorThresholdTenths: policyNumbers.monitorThresholdTenths.optional(),
    questionnaireVersionId: idField.nullable().optional(),
    nextLaunchAt: isoDateTime.nullable().optional(),
  })
  .refine(thresholdsOrdered, thresholdsIssue);
export type ListeningConfigurationUpdateRequest = z.infer<typeof ListeningConfigurationUpdateRequestSchema>;

// ---------------------------------------------------------------------------
// Cycles (SUR-02..04)
// ---------------------------------------------------------------------------

export const SURVEY_CYCLE_STATUSES = ['scheduled', 'open', 'closing', 'published', 'canceled', 'failed'] as const;
export const SurveyCycleStatusSchema = z.enum(SURVEY_CYCLE_STATUSES);
export type SurveyCycleStatus = z.infer<typeof SurveyCycleStatusSchema>;

export const SurveyCycleResponseSchema = z.strictObject({
  id: idField,
  opensAt: isoDateTime,
  closesAt: isoDateTime,
  status: SurveyCycleStatusSchema,
  /** The launch snapshot's size; null before launch. Never a list of people. */
  audienceSize: z.number().int().nonnegative().nullable(),
  questionnaireVersion: z.number().int().positive(),
  publishedSnapshotId: idField.nullable(),
});
export type SurveyCycleResponse = z.infer<typeof SurveyCycleResponseSchema>;

export const SurveyCycleScheduleRequestSchema = z.strictObject({
  opensAt: isoDateTime,
});
export type SurveyCycleScheduleRequest = z.infer<typeof SurveyCycleScheduleRequestSchema>;

export const SurveyCycleListResponseSchema = z.strictObject({
  items: z.array(SurveyCycleResponseSchema),
  configuration: z.strictObject({
    cadenceDays: z.number().int(),
    responseWindowDays: z.number().int(),
    reminderLimit: z.number().int(),
    nextLaunchAt: isoDateTime.nullable(),
    /** Active members today: the audience the next launch would snapshot. */
    activeMemberCount: z.number().int().nonnegative(),
    questionnaireVersion: z.number().int().positive().nullable(),
    timeZone: z.string().min(1),
  }),
});
export type SurveyCycleListResponse = z.infer<typeof SurveyCycleListResponseSchema>;

// ---------------------------------------------------------------------------
// The employee's survey (EMP-01..03)
// ---------------------------------------------------------------------------

/** Answers by dimension key; a skipped dimension is absent, never null or 0. */
export const SurveyAnswersSchema = z.partialRecord(ListeningDimensionKeySchema, z.number().int().min(1).max(5));
export type SurveyAnswers = z.infer<typeof SurveyAnswersSchema>;

export const SurveyDraftRequestSchema = z.strictObject({
  answers: SurveyAnswersSchema,
});
export type SurveyDraftRequest = z.infer<typeof SurveyDraftRequestSchema>;

export const SurveyDraftResponseSchema = z.strictObject({
  savedAt: isoDateTime,
});
export type SurveyDraftResponse = z.infer<typeof SurveyDraftResponseSchema>;

export const SurveySubmitRequestSchema = z.strictObject({
  answers: SurveyAnswersSchema.refine((a) => Object.keys(a).length >= 1, {
    message: 'At least one rating is required',
  }),
  /** The version the employee saw; a mismatch is refused (`template_version_mismatch`). */
  questionnaireVersionId: idField,
});
export type SurveySubmitRequest = z.infer<typeof SurveySubmitRequestSchema>;

export const SURVEY_PARTICIPATION_STATES = ['invited', 'draft', 'submitted', 'ineligible'] as const;
export const SurveyParticipationStateSchema = z.enum(SURVEY_PARTICIPATION_STATES);
export type SurveyParticipationState = z.infer<typeof SurveyParticipationStateSchema>;

export const SURVEY_ESTIMATED_MINUTES = 3;

export const MySurveyResponseSchema = z.union([
  z.strictObject({ cycle: z.null() }),
  z.strictObject({
    cycle: z.strictObject({
      id: idField,
      opensAt: isoDateTime,
      closesAt: isoDateTime,
      timeZone: z.string().min(1),
      estimatedMinutes: z.literal(SURVEY_ESTIMATED_MINUTES),
    }),
    questionnaire: z.strictObject({
      id: idField,
      version: z.number().int().positive(),
      dimensions: z.array(QuestionnaireDimensionSchema),
      notice: LocalizedLongTextSchema,
    }),
    participation: z.strictObject({
      state: z.enum(['invited', 'draft', 'submitted']),
      draft: SurveyAnswersSchema.nullable(),
      submittedAt: isoDateTime.nullable(),
    }),
  }),
]);
export type MySurveyResponse = z.infer<typeof MySurveyResponseSchema>;

export const SurveyReceiptResponseSchema = z.strictObject({
  submittedAt: isoDateTime,
});
export type SurveyReceiptResponse = z.infer<typeof SurveyReceiptResponseSchema>;

// ---------------------------------------------------------------------------
// Reports (SCO-02, SCO-03, REP-01..03)
// ---------------------------------------------------------------------------

export const GrayReasonSchema = z.enum(GRAY_REASONS);
export const ScoreStatusSchema = z.enum(SCORE_STATUSES);

/**
 * A reportable or withheld result for one dimension in one cohort. Counts
 * leave the pipeline only as `respondentCount` of a shown cell and as
 * whole-percent distribution shares; a hidden cell carries nulls.
 */
export const DimensionCellSchema = z.strictObject({
  key: ListeningDimensionKeySchema,
  scoreTenths: z.number().int().min(0).max(1000).nullable(),
  /** `scoreTenths` formatted with one decimal, for display. */
  score: z.string().regex(/^\d{1,3}\.\d$/).nullable(),
  status: ScoreStatusSchema.nullable(),
  grayReason: GrayReasonSchema.nullable(),
  respondentCount: z.number().int().nonnegative().nullable(),
  distribution: z
    .strictObject({
      favorablePct: z.number().int().min(0).max(100),
      neutralPct: z.number().int().min(0).max(100),
      unfavorablePct: z.number().int().min(0).max(100),
    })
    .nullable(),
});
export type DimensionCell = z.infer<typeof DimensionCellSchema>;

export const TrendSchema = z.discriminatedUnion('comparable', [
  z.strictObject({
    comparable: z.literal(true),
    deltaTenths: z.number().int(),
    previousSnapshotId: idField,
  }),
  z.strictObject({
    comparable: z.literal(false),
    reason: z.enum(['no_previous', 'incompatible_version', 'suppressed']),
  }),
]);
export type Trend = z.infer<typeof TrendSchema>;

export const DimensionCardSchema = DimensionCellSchema.extend({ trend: TrendSchema });
export type DimensionCard = z.infer<typeof DimensionCardSchema>;

export const ReviewOfferSchema = z.strictObject({
  eligible: z.boolean(),
  /** The reportable `danger` dimensions of the displayed scope. */
  dimensionKeys: z.array(ListeningDimensionKeySchema),
  activeRequestId: idField.nullable(),
  activeEngagementId: idField.nullable(),
  dismissed: z.boolean(),
});
export type ReviewOffer = z.infer<typeof ReviewOfferSchema>;

export const ListeningCapabilitiesSchema = z.strictObject({
  measurement: z.boolean(),
  feedback: z.boolean(),
  workplaceReviews: z.boolean(),
});
export type ListeningCapabilities = z.infer<typeof ListeningCapabilitiesSchema>;

export const ListeningOverviewResponseSchema = z.strictObject({
  capabilities: ListeningCapabilitiesSchema,
  collecting: z
    .strictObject({ cycleId: idField, opensAt: isoDateTime, closesAt: isoDateTime })
    .nullable(),
  current: z
    .strictObject({
      snapshotId: idField,
      cycleId: idField,
      opensAt: isoDateTime,
      closesAt: isoDateTime,
      publishedAt: isoDateTime,
      questionnaireVersion: z.number().int().positive(),
      stale: z.boolean(),
      participation: z.strictObject({
        audienceSize: z.number().int().nonnegative().nullable(),
        submittedCount: z.number().int().nonnegative().nullable(),
      }),
      dimensions: z.array(DimensionCardSchema),
    })
    .nullable(),
  history: z.array(z.strictObject({ snapshotId: idField, cycleId: idField, closesAt: isoDateTime })),
  reviewOffer: ReviewOfferSchema.nullable(),
});
export type ListeningOverviewResponse = z.infer<typeof ListeningOverviewResponseSchema>;

export const HeatmapRowSchema = z.strictObject({
  /** `company`, an org-unit id, or `unassigned`. */
  cohortKey: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['company', 'department', 'unassigned']),
  cells: z.array(DimensionCellSchema),
});
export type HeatmapRow = z.infer<typeof HeatmapRowSchema>;

export const ListeningHeatmapResponseSchema = z.strictObject({
  snapshotId: idField,
  closesAt: isoDateTime,
  stale: z.boolean(),
  rows: z.array(HeatmapRowSchema),
});
export type ListeningHeatmapResponse = z.infer<typeof ListeningHeatmapResponseSchema>;

export const ListeningDimensionDetailResponseSchema = z.strictObject({
  key: ListeningDimensionKeySchema,
  question: LocalizedTextSchema,
  scaleLow: LocalizedTextSchema,
  scaleHigh: LocalizedTextSchema,
  explanation: LocalizedTextSchema,
  snapshotId: idField,
  closesAt: isoDateTime,
  stale: z.boolean(),
  cell: DimensionCardSchema,
  series: z.array(
    z.strictObject({
      snapshotId: idField,
      closesAt: isoDateTime,
      scoreTenths: z.number().int().nullable(),
      status: ScoreStatusSchema.nullable(),
      grayReason: GrayReasonSchema.nullable(),
      /** Whether this point's questionnaire version is comparable with the current one. */
      comparable: z.boolean(),
    }),
  ),
});
export type ListeningDimensionDetailResponse = z.infer<typeof ListeningDimensionDetailResponseSchema>;

export const HeatmapQuerySchema = z.strictObject({
  snapshotId: idField.optional(),
});
export type HeatmapQuery = z.infer<typeof HeatmapQuerySchema>;

export const OfferDismissRequestSchema = z.strictObject({
  snapshotId: idField,
});
export type OfferDismissRequest = z.infer<typeof OfferDismissRequestSchema>;

export const OfferDismissResponseSchema = z.strictObject({
  dismissed: z.literal(true),
});
export type OfferDismissResponse = z.infer<typeof OfferDismissResponseSchema>;

/** The API error codes of the listening routes, mapped to copy by the clients. */
export const LISTENING_ERROR_CODES = [
  'not_eligible',
  'cycle_closed',
  'already_submitted',
  'template_version_mismatch',
  'measurement_disabled',
  'cycle_overlap',
  'no_published_questionnaire',
] as const;
export type ListeningErrorCode = (typeof LISTENING_ERROR_CODES)[number];
