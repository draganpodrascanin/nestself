/**
 * Organizational feedback cases (spec Epic F, sections 8 to 10; ADR 0002,
 * D-EL-01 and D-EL-06): the routes an organization staffs, the employee's own
 * cases and the handler's view of an assigned case.
 *
 * Every response DTO is a `strictObject` built by an allowlist mapper. The
 * handler schemas carry no reporter field at all, so a reporter identity
 * cannot be serialized by accident (spec FBK-02, PRI-03).
 */
import { z } from 'zod';

const idField = z.string().min(1);
const isoDateTime = z.string().datetime();

export const FEEDBACK_ROUTE_KINDS = ['standard', 'sensitive'] as const;
export const FeedbackRouteKindSchema = z.enum(FEEDBACK_ROUTE_KINDS);
export type FeedbackRouteKind = z.infer<typeof FeedbackRouteKindSchema>;

export const FEEDBACK_CASE_KINDS = ['problem', 'suggestion'] as const;
export const FeedbackCaseKindSchema = z.enum(FEEDBACK_CASE_KINDS);
export type FeedbackCaseKind = z.infer<typeof FeedbackCaseKindSchema>;

export const FEEDBACK_CASE_STATES = ['submitted', 'in_review', 'waiting_for_reporter', 'action_in_progress', 'resolved', 'closed'] as const;
export const FeedbackCaseStateSchema = z.enum(FEEDBACK_CASE_STATES);
export type FeedbackCaseState = z.infer<typeof FeedbackCaseStateSchema>;

/** States in which a case has an owner, a next action and a due target (spec FBK-04). */
export const FEEDBACK_OPEN_STATES: readonly FeedbackCaseState[] = ['submitted', 'in_review', 'waiting_for_reporter', 'action_in_progress'];

export const FEEDBACK_MESSAGE_SENDERS = ['reporter', 'handler', 'system'] as const;
export const FeedbackMessageSenderSchema = z.enum(FEEDBACK_MESSAGE_SENDERS);
export type FeedbackMessageSender = z.infer<typeof FeedbackMessageSenderSchema>;

export const FEEDBACK_ROUTE_CHOICES = ['primary', 'alternate'] as const;
export const FeedbackRouteChoiceSchema = z.enum(FEEDBACK_ROUTE_CHOICES);
export type FeedbackRouteChoice = z.infer<typeof FeedbackRouteChoiceSchema>;

/** The pilot's small set of understandable categories (spec FBK-01); an organization may replace them. */
export const FEEDBACK_CATEGORIES = ['workload', 'management', 'communication', 'equipment', 'safety', 'other'] as const;

export const FEEDBACK_BODY_MAX = 5000;
export const FEEDBACK_CATEGORY_MAX = 64;
export const DEFAULT_FEEDBACK_RESPONSE_TARGET_HOURS = 72;
/** The case pseudonym: `Reporter-` and four base32 characters. */
export const FEEDBACK_PSEUDONYM_PATTERN = /^Reporter-[A-Z2-7]{4}$/;

/**
 * Allowed transitions (spec section 8, FBK-04). A reporter reply on a
 * resolved or waiting case reopens it to `in_review` outside this table (the
 * server does it, the handler cannot refuse it).
 */
export const FEEDBACK_TRANSITIONS: Readonly<Record<FeedbackCaseState, readonly FeedbackCaseState[]>> = {
  submitted: ['in_review'],
  in_review: ['waiting_for_reporter', 'action_in_progress', 'resolved'],
  waiting_for_reporter: ['in_review', 'action_in_progress', 'resolved'],
  action_in_progress: ['in_review', 'waiting_for_reporter', 'resolved'],
  resolved: ['closed', 'in_review'],
  closed: [],
};

export function canTransition(from: FeedbackCaseState, to: FeedbackCaseState): boolean {
  return FEEDBACK_TRANSITIONS[from].includes(to);
}

export const FEEDBACK_ERROR_CODES = [
  'route_unavailable',
  'feedback_disabled',
  'handler_not_eligible',
  'same_handler',
  'sensitive_not_enabled',
  'invalid_state',
] as const;
export type FeedbackErrorCode = (typeof FEEDBACK_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Routes (FBK-01, FBK-03, FBK-06)
// ---------------------------------------------------------------------------

/** A recipient as the employee sees them: a name and a function, never an account id. */
export const FeedbackHandlerFunctionSchema = z.strictObject({
  displayName: z.string(),
  functionLabel: FeedbackRouteChoiceSchema,
});
export type FeedbackHandlerFunction = z.infer<typeof FeedbackHandlerFunctionSchema>;

export const FeedbackRouteViewSchema = z.strictObject({
  id: idField,
  kind: FeedbackRouteKindSchema,
  categories: z.array(z.string()),
  primary: FeedbackHandlerFunctionSchema,
  alternate: FeedbackHandlerFunctionSchema,
  enabled: z.boolean(),
  operatingHours: z.string().nullable(),
  responseTargetHours: z.number().int().positive(),
});
export type FeedbackRouteView = z.infer<typeof FeedbackRouteViewSchema>;

/** `GET /me/feedback/routes`: the enabled routes the employee may use. */
export const FeedbackRoutesResponseSchema = z.strictObject({
  feedbackEnabled: z.boolean(),
  sensitiveEnabled: z.boolean(),
  items: z.array(FeedbackRouteViewSchema),
});
export type FeedbackRoutesResponse = z.infer<typeof FeedbackRoutesResponseSchema>;

/** The organization's own view of a route (`GET /orgs/:orgId/feedback/routes`): handler ids included. */
export const FeedbackRouteAdminSchema = z.strictObject({
  id: idField,
  kind: FeedbackRouteKindSchema,
  categories: z.array(z.string()),
  primaryHandlerUserId: idField,
  primaryDisplayName: z.string(),
  alternateHandlerUserId: idField,
  alternateDisplayName: z.string(),
  enabled: z.boolean(),
  operatingHours: z.string().nullable(),
  responseTargetHours: z.number().int().positive(),
  escalationNote: z.string().nullable(),
  updatedAt: isoDateTime,
});
export type FeedbackRouteAdmin = z.infer<typeof FeedbackRouteAdminSchema>;

export const FeedbackRoutesAdminResponseSchema = z.strictObject({
  /** The feedback capability of the client's configuration. */
  feedbackEnabled: z.boolean(),
  /** NestSelf has enabled the sensitive route for this client (spec FBK-06). */
  sensitiveAllowed: z.boolean(),
  items: z.array(FeedbackRouteAdminSchema),
});
export type FeedbackRoutesAdminResponse = z.infer<typeof FeedbackRoutesAdminResponseSchema>;

export const FeedbackRouteUpdateSchema = z.strictObject({
  kind: FeedbackRouteKindSchema,
  categories: z.array(z.string().min(1).max(FEEDBACK_CATEGORY_MAX)).min(1).max(20),
  primaryHandlerUserId: idField,
  alternateHandlerUserId: idField,
  enabled: z.boolean(),
  operatingHours: z.string().min(1).max(200).nullable().optional(),
  responseTargetHours: z.number().int().min(1).max(720),
  escalationNote: z.string().min(1).max(1000).nullable().optional(),
});
export type FeedbackRouteUpdate = z.infer<typeof FeedbackRouteUpdateSchema>;

export const FeedbackRoutesUpdateRequestSchema = z
  .strictObject({ routes: z.array(FeedbackRouteUpdateSchema).min(1).max(FEEDBACK_ROUTE_KINDS.length) })
  .refine((v) => new Set(v.routes.map((r) => r.kind)).size === v.routes.length, { message: 'One route per kind', path: ['routes'] });
export type FeedbackRoutesUpdateRequest = z.infer<typeof FeedbackRoutesUpdateRequestSchema>;

// ---------------------------------------------------------------------------
// The employee's cases (FBK-01, FBK-02)
// ---------------------------------------------------------------------------

export const FeedbackCaseCreateRequestSchema = z.strictObject({
  routeId: idField,
  kind: FeedbackCaseKindSchema,
  category: z.string().min(1).max(FEEDBACK_CATEGORY_MAX),
  routeChoice: FeedbackRouteChoiceSchema,
  /** The pilot default: the employer never learns the reporter's account (spec FBK-01). */
  anonymousToEmployer: z.boolean().default(true),
  body: z.string().min(1).max(FEEDBACK_BODY_MAX),
});
export type FeedbackCaseCreateRequest = z.infer<typeof FeedbackCaseCreateRequestSchema>;

export const FeedbackCaseCreateResponseSchema = z.strictObject({
  id: idField,
  pseudonym: z.string(),
  state: FeedbackCaseStateSchema,
  dueAt: isoDateTime.nullable(),
  handlerFunction: FeedbackRouteChoiceSchema,
});
export type FeedbackCaseCreateResponse = z.infer<typeof FeedbackCaseCreateResponseSchema>;

export const MyFeedbackCaseSummarySchema = z.strictObject({
  id: idField,
  kind: FeedbackCaseKindSchema,
  category: z.string(),
  state: FeedbackCaseStateSchema,
  pseudonym: z.string(),
  createdAt: isoDateTime,
  lastMessageAt: isoDateTime.nullable(),
  dueAt: isoDateTime.nullable(),
});
export type MyFeedbackCaseSummary = z.infer<typeof MyFeedbackCaseSummarySchema>;

export const MyFeedbackCasesResponseSchema = z.strictObject({ items: z.array(MyFeedbackCaseSummarySchema) });
export type MyFeedbackCasesResponse = z.infer<typeof MyFeedbackCasesResponseSchema>;

/** A message as either side reads it; `internal` is always false on the reporter's side. */
export const FeedbackMessageViewSchema = z.strictObject({
  id: idField,
  sender: FeedbackMessageSenderSchema,
  body: z.string(),
  createdAt: isoDateTime,
  internal: z.boolean(),
});
export type FeedbackMessageView = z.infer<typeof FeedbackMessageViewSchema>;

export const MyFeedbackCaseResponseSchema = z.strictObject({
  id: idField,
  kind: FeedbackCaseKindSchema,
  category: z.string(),
  state: FeedbackCaseStateSchema,
  pseudonym: z.string(),
  createdAt: isoDateTime,
  dueAt: isoDateTime.nullable(),
  handlerFunction: FeedbackRouteChoiceSchema,
  routeKind: FeedbackRouteKindSchema,
  messages: z.array(FeedbackMessageViewSchema),
});
export type MyFeedbackCaseResponse = z.infer<typeof MyFeedbackCaseResponseSchema>;

/** A reporter's reply or clarification request (`POST /me/feedback/cases/:id/messages`). */
export const FeedbackReporterMessageRequestSchema = z.strictObject({
  body: z.string().min(1).max(FEEDBACK_BODY_MAX),
});
export type FeedbackReporterMessageRequest = z.infer<typeof FeedbackReporterMessageRequestSchema>;

// ---------------------------------------------------------------------------
// The handler's cases (FBK-02..04)
// ---------------------------------------------------------------------------

export const HandlerFeedbackCaseSummarySchema = z.strictObject({
  id: idField,
  kind: FeedbackCaseKindSchema,
  category: z.string(),
  state: FeedbackCaseStateSchema,
  pseudonym: z.string(),
  routeKind: FeedbackRouteKindSchema,
  routeChoice: FeedbackRouteChoiceSchema,
  nextAction: z.string().nullable(),
  dueAt: isoDateTime.nullable(),
  overdue: z.boolean(),
  escalatedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
  lastMessageAt: isoDateTime.nullable(),
});
export type HandlerFeedbackCaseSummary = z.infer<typeof HandlerFeedbackCaseSummarySchema>;

export const HandlerFeedbackInboxResponseSchema = z.strictObject({ items: z.array(HandlerFeedbackCaseSummarySchema) });
export type HandlerFeedbackInboxResponse = z.infer<typeof HandlerFeedbackInboxResponseSchema>;

export const HandlerFeedbackCaseResponseSchema = z.strictObject({
  id: idField,
  orgId: idField,
  kind: FeedbackCaseKindSchema,
  category: z.string(),
  state: FeedbackCaseStateSchema,
  pseudonym: z.string(),
  anonymousToEmployer: z.boolean(),
  routeKind: FeedbackRouteKindSchema,
  routeChoice: FeedbackRouteChoiceSchema,
  handlerUserId: idField.nullable(),
  nextAction: z.string().nullable(),
  dueAt: isoDateTime.nullable(),
  escalatedAt: isoDateTime.nullable(),
  resolvedAt: isoDateTime.nullable(),
  closedAt: isoDateTime.nullable(),
  outcomeReason: z.string().nullable(),
  createdAt: isoDateTime,
  messages: z.array(FeedbackMessageViewSchema),
});
export type HandlerFeedbackCaseResponse = z.infer<typeof HandlerFeedbackCaseResponseSchema>;

export const FeedbackMessageRequestSchema = z.strictObject({
  body: z.string().min(1).max(FEEDBACK_BODY_MAX),
  /** An internal note: handlers only, never shown to the reporter (spec FBK-02). */
  internal: z.boolean().default(false),
});
export type FeedbackMessageRequest = z.infer<typeof FeedbackMessageRequestSchema>;

export const FEEDBACK_NEXT_ACTION_MAX = 200;
export const FEEDBACK_OUTCOME_REASON_MAX = 500;

export const FeedbackStateRequestSchema = z
  .strictObject({
    state: FeedbackCaseStateSchema,
    nextAction: z.string().min(1).max(FEEDBACK_NEXT_ACTION_MAX).optional(),
    /** Required to close (spec FBK-04). */
    outcomeReason: z.string().min(1).max(FEEDBACK_OUTCOME_REASON_MAX).optional(),
    /** Required to resolve; becomes a reporter-visible handler message (spec FBK-04). */
    reporterExplanation: z.string().min(1).max(FEEDBACK_BODY_MAX).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.state === 'resolved' && !v.reporterExplanation) {
      ctx.addIssue({ code: 'custom', path: ['reporterExplanation'], message: 'A reporter-facing explanation is required to resolve a case' });
    }
    if (v.state === 'closed' && !v.outcomeReason) {
      ctx.addIssue({ code: 'custom', path: ['outcomeReason'], message: 'An outcome reason is required to close a case' });
    }
  });
export type FeedbackStateRequest = z.infer<typeof FeedbackStateRequestSchema>;

export const FeedbackReassignRequestSchema = z.strictObject({ to: FeedbackRouteChoiceSchema });
export type FeedbackReassignRequest = z.infer<typeof FeedbackReassignRequestSchema>;
