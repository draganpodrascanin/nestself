/**
 * Typed wrappers for the employee listening routes (ADR 0002): the employee's
 * survey, the organization's reports, cycles and configuration view, the
 * review offer, and the operations routes for configuration and
 * questionnaire versions. Every method parses the response with the matching
 * contracts schema; the CSV export is fetched as text through `exportCsv`.
 */
import {
  ImprovementActionsResponseSchema,
  ReviewEngagementListResponseSchema,
  ReviewEngagementResponseSchema,
  ReviewNotesResponseSchema,
  ReviewPackResponseSchema,
  ReviewQueueResponseSchema,
  ReviewReportViewSchema,
  ReviewRequestListResponseSchema,
  ReviewRequestOpsResponseSchema,
  ReviewRequestResponseSchema,
  ReviewServicesResponseSchema,
  ReviewerCandidatesResponseSchema,
  FeedbackCaseCreateResponseSchema,
  FeedbackRoutesAdminResponseSchema,
  FeedbackRoutesResponseSchema,
  HandlerFeedbackCaseResponseSchema,
  HandlerFeedbackInboxResponseSchema,
  MyFeedbackCaseResponseSchema,
  MyFeedbackCasesResponseSchema,
  ListeningConfigurationResponseSchema,
  ListeningDimensionDetailResponseSchema,
  ListeningHeatmapResponseSchema,
  ListeningOverviewResponseSchema,
  MySurveyResponseSchema,
  OfferDismissResponseSchema,
  QuestionnaireListResponseSchema,
  QuestionnaireVersionResponseSchema,
  SurveyCycleListResponseSchema,
  SurveyCycleResponseSchema,
  SurveyDraftResponseSchema,
  SurveyReceiptResponseSchema,
} from '@nestself/contracts';
import type {
  ImprovementActionCreateRequest,
  ImprovementActionUpdateRequest,
  ReviewAssignRequest,
  ReviewBookRequest,
  ReviewCancelRequest,
  ReviewFollowUpRequest,
  ReviewInformationRequest,
  ReviewNoteRequest,
  ReviewReportDraftRequest,
  ReviewRequestCreateRequest,
  ReviewScopeCreateRequest,
  ReviewSharingGrantRequest,
  ReviewTriageRequest,
  ReviewWindowsRequest,
  FeedbackCaseCreateRequest,
  FeedbackMessageRequest,
  FeedbackReassignRequest,
  FeedbackReporterMessageRequest,
  FeedbackRoutesUpdateRequest,
  FeedbackStateRequest,
  ListeningConfigurationUpdateRequest,
  ListeningDimensionKey,
  OfferDismissRequest,
  QuestionnaireDraftRequest,
  SurveyCycleScheduleRequest,
  SurveyDraftRequest,
  SurveySubmitRequest,
} from '@nestself/contracts';
import { z } from 'zod';
import type { ApiClient } from './client';
import { ApiError } from './errors';

function send(method: 'POST' | 'PUT' | 'PATCH', body: unknown, headers: Record<string, string> = {}): RequestInit {
  return { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } };
}

const seg = encodeURIComponent;

const RejectedSchema = z.object({ rejected: z.literal(true) });

export function createListeningApi(client: ApiClient) {
  const orgPath = (orgId: string) => `/api/orgs/${seg(orgId)}/listening`;
  const reviewPath = (orgId: string) => `/api/orgs/${seg(orgId)}/workplace-reviews`;
  const expertPath = (id: string) => `/api/expert/workplace-reviews/engagements/${seg(id)}`;
  return {
    // ── Employee ─────────────────────────────────────────────────────────
    /** GET /me/listening/survey */
    mySurvey: () => client.request('/api/me/listening/survey', { method: 'GET', schema: MySurveyResponseSchema }),
    /** PUT /me/listening/survey/:cycleId/draft */
    saveDraft: (cycleId: string, body: SurveyDraftRequest) =>
      client.request(`/api/me/listening/survey/${seg(cycleId)}/draft`, { ...send('PUT', body), schema: SurveyDraftResponseSchema }),
    /** POST /me/listening/survey/:cycleId/submit with an `Idempotency-Key`, so a retry replays the receipt. */
    submitSurvey: (cycleId: string, body: SurveySubmitRequest, idempotencyKey: string) =>
      client.request(`/api/me/listening/survey/${seg(cycleId)}/submit`, {
        ...send('POST', body, { 'Idempotency-Key': idempotencyKey }),
        schema: SurveyReceiptResponseSchema,
      }),

    // ── Organization ─────────────────────────────────────────────────────
    overview: (orgId: string) => client.request(`${orgPath(orgId)}/overview`, { method: 'GET', schema: ListeningOverviewResponseSchema }),
    heatmap: (orgId: string, snapshotId?: string) =>
      client.request(`${orgPath(orgId)}/heatmap${snapshotId ? `?snapshotId=${seg(snapshotId)}` : ''}`, {
        method: 'GET',
        schema: ListeningHeatmapResponseSchema,
      }),
    dimension: (orgId: string, key: ListeningDimensionKey, snapshotId?: string) =>
      client.request(`${orgPath(orgId)}/dimensions/${seg(key)}${snapshotId ? `?snapshotId=${seg(snapshotId)}` : ''}`, {
        method: 'GET',
        schema: ListeningDimensionDetailResponseSchema,
      }),
    /** The CSV download path, relative to the API origin; the caller fetches it with credentials. */
    exportCsvPath: (orgId: string, snapshotId: string) => `${orgPath(orgId)}/snapshots/${seg(snapshotId)}/export.csv`,
    /**
     * GET .../snapshots/:snapshotId/export.csv as text. Not JSON, so it does not
     * go through `client.request`; errors are mapped to `ApiError` the same way.
     */
    exportCsv: async (orgId: string, snapshotId: string, fetchImpl: typeof fetch = fetch): Promise<{ filename: string; content: string }> => {
      const response = await fetchImpl(`${client.baseUrl}${orgPath(orgId)}/snapshots/${seg(snapshotId)}/export.csv`, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'text/csv' },
      });
      if (!response.ok) {
        let code = String(response.status);
        let details: Record<string, unknown> | undefined;
        try {
          const body = (await response.json()) as Record<string, unknown>;
          if (typeof body.code === 'string') code = body.code;
          if (body.details && typeof body.details === 'object') details = body.details as Record<string, unknown>;
        } catch {
          // keep the status code
        }
        throw new ApiError({ status: response.status, code, message: response.statusText, requestId: response.headers.get('x-request-id'), details });
      }
      const disposition = response.headers.get('content-disposition') ?? '';
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? `listening-${snapshotId}.csv`;
      return { filename, content: await response.text() };
    },
    listCycles: (orgId: string) => client.request(`${orgPath(orgId)}/cycles`, { method: 'GET', schema: SurveyCycleListResponseSchema }),
    scheduleCycle: (orgId: string, body: SurveyCycleScheduleRequest) =>
      client.request(`${orgPath(orgId)}/cycles`, { ...send('POST', body), schema: SurveyCycleResponseSchema }),
    cancelCycle: (orgId: string, cycleId: string) =>
      client.request(`${orgPath(orgId)}/cycles/${seg(cycleId)}/cancel`, { ...send('POST', {}), schema: SurveyCycleResponseSchema }),
    dismissOffer: (orgId: string, body: OfferDismissRequest) =>
      client.request(`${orgPath(orgId)}/offer/dismiss`, { ...send('POST', body), schema: OfferDismissResponseSchema }),
    configuration: (orgId: string) =>
      client.request(`${orgPath(orgId)}/configuration`, { method: 'GET', schema: ListeningConfigurationResponseSchema }),

    // ── Operations ───────────────────────────────────────────────────────
    opsConfiguration: (orgId: string) =>
      client.request(`/api/ops/orgs/${seg(orgId)}/listening/configuration`, { method: 'GET', schema: ListeningConfigurationResponseSchema }),
    updateOpsConfiguration: (orgId: string, body: ListeningConfigurationUpdateRequest) =>
      client.request(`/api/ops/orgs/${seg(orgId)}/listening/configuration`, { ...send('PUT', body), schema: ListeningConfigurationResponseSchema }),
    listQuestionnaires: () => client.request('/api/ops/listening/questionnaires', { method: 'GET', schema: QuestionnaireListResponseSchema }),
    createQuestionnaire: (body: QuestionnaireDraftRequest) =>
      client.request('/api/ops/listening/questionnaires', { ...send('POST', body), schema: QuestionnaireVersionResponseSchema }),
    updateQuestionnaire: (id: string, body: QuestionnaireDraftRequest) =>
      client.request(`/api/ops/listening/questionnaires/${seg(id)}`, { ...send('PATCH', body), schema: QuestionnaireVersionResponseSchema }),
    submitQuestionnaireReview: (id: string) =>
      client.request(`/api/ops/listening/questionnaires/${seg(id)}/submit-review`, { ...send('POST', {}), schema: QuestionnaireVersionResponseSchema }),
    publishQuestionnaire: (id: string) =>
      client.request(`/api/ops/listening/questionnaires/${seg(id)}/publish`, { ...send('POST', {}), schema: QuestionnaireVersionResponseSchema }),
    archiveQuestionnaire: (id: string) =>
      client.request(`/api/ops/listening/questionnaires/${seg(id)}/archive`, { ...send('POST', {}), schema: QuestionnaireVersionResponseSchema }),

    // ── Feedback cases (spec Epic F) ─────────────────────────────────────
    /** GET /me/feedback/routes: the enabled routes with their recipients named by function. */
    feedbackRoutes: () => client.request('/api/me/feedback/routes', { method: 'GET', schema: FeedbackRoutesResponseSchema }),
    /** POST /me/feedback/cases with an `Idempotency-Key`, so a retry replays the receipt instead of raising twice. */
    createFeedbackCase: (body: FeedbackCaseCreateRequest, idempotencyKey: string) =>
      client.request('/api/me/feedback/cases', { ...send('POST', body, { 'Idempotency-Key': idempotencyKey }), schema: FeedbackCaseCreateResponseSchema }),
    myFeedbackCases: () => client.request('/api/me/feedback/cases', { method: 'GET', schema: MyFeedbackCasesResponseSchema }),
    myFeedbackCase: (id: string) => client.request(`/api/me/feedback/cases/${seg(id)}`, { method: 'GET', schema: MyFeedbackCaseResponseSchema }),
    replyToMyCase: (id: string, body: FeedbackReporterMessageRequest, idempotencyKey: string) =>
      client.request(`/api/me/feedback/cases/${seg(id)}/messages`, { ...send('POST', body, { 'Idempotency-Key': idempotencyKey }), schema: MyFeedbackCaseResponseSchema }),
    /** GET /feedback/inbox: the handler's assigned cases (organization context). */
    feedbackInbox: () => client.request('/api/feedback/inbox', { method: 'GET', schema: HandlerFeedbackInboxResponseSchema }),
    handlerCase: (id: string) => client.request(`/api/feedback/cases/${seg(id)}`, { method: 'GET', schema: HandlerFeedbackCaseResponseSchema }),
    handlerMessage: (id: string, body: FeedbackMessageRequest, idempotencyKey: string) =>
      client.request(`/api/feedback/cases/${seg(id)}/messages`, { ...send('POST', body, { 'Idempotency-Key': idempotencyKey }), schema: HandlerFeedbackCaseResponseSchema }),
    setCaseState: (id: string, body: FeedbackStateRequest) =>
      client.request(`/api/feedback/cases/${seg(id)}/state`, { ...send('POST', body), schema: HandlerFeedbackCaseResponseSchema }),
    reassignCase: (id: string, body: FeedbackReassignRequest) =>
      client.request(`/api/feedback/cases/${seg(id)}/reassign`, { ...send('POST', body), schema: HandlerFeedbackCaseResponseSchema }),
    orgFeedbackRoutes: (orgId: string) =>
      client.request(`/api/orgs/${seg(orgId)}/feedback/routes`, { method: 'GET', schema: FeedbackRoutesAdminResponseSchema }),
    updateOrgFeedbackRoutes: (orgId: string, body: FeedbackRoutesUpdateRequest) =>
      client.request(`/api/orgs/${seg(orgId)}/feedback/routes`, { ...send('PUT', body), schema: FeedbackRoutesAdminResponseSchema }),

    // ── Workplace reviews: organization (spec Epics G and H) ──────────────
    reviewServices: (orgId: string) => client.request(`${reviewPath(orgId)}/services`, { method: 'GET', schema: ReviewServicesResponseSchema }),
    /** POST /orgs/:orgId/workplace-reviews/requests with an `Idempotency-Key`: a retry replays the same request. */
    createReviewRequest: (orgId: string, body: ReviewRequestCreateRequest, idempotencyKey: string) =>
      client.request(`${reviewPath(orgId)}/requests`, { ...send('POST', body, { 'Idempotency-Key': idempotencyKey }), schema: ReviewRequestResponseSchema }),
    listReviewRequests: (orgId: string) => client.request(`${reviewPath(orgId)}/requests`, { method: 'GET', schema: ReviewRequestListResponseSchema }),
    reviewRequest: (orgId: string, id: string) => client.request(`${reviewPath(orgId)}/requests/${seg(id)}`, { method: 'GET', schema: ReviewRequestResponseSchema }),
    cancelReviewRequest: (orgId: string, id: string, body: ReviewCancelRequest) =>
      client.request(`${reviewPath(orgId)}/requests/${seg(id)}/cancel`, { ...send('POST', body), schema: ReviewRequestResponseSchema }),
    answerReviewInformation: (orgId: string, id: string, body: ReviewInformationRequest) =>
      client.request(`${reviewPath(orgId)}/requests/${seg(id)}/information`, { ...send('POST', body), schema: ReviewRequestResponseSchema }),
    acceptReviewScope: (orgId: string, scopeId: string) =>
      client.request(`${reviewPath(orgId)}/scopes/${seg(scopeId)}/accept`, { ...send('POST', {}), schema: ReviewEngagementResponseSchema }),
    rejectReviewScope: (orgId: string, scopeId: string) =>
      client.request(`${reviewPath(orgId)}/scopes/${seg(scopeId)}/reject`, { ...send('POST', {}), schema: RejectedSchema }),
    listEngagements: (orgId: string) => client.request(`${reviewPath(orgId)}/engagements`, { method: 'GET', schema: ReviewEngagementListResponseSchema }),
    engagement: (orgId: string, id: string) => client.request(`${reviewPath(orgId)}/engagements/${seg(id)}`, { method: 'GET', schema: ReviewEngagementResponseSchema }),
    bookEngagement: (orgId: string, id: string, body: ReviewBookRequest) =>
      client.request(`${reviewPath(orgId)}/engagements/${seg(id)}/book`, { ...send('POST', body), schema: ReviewEngagementResponseSchema }),
    cancelEngagement: (orgId: string, id: string, body: ReviewCancelRequest) =>
      client.request(`${reviewPath(orgId)}/engagements/${seg(id)}/cancel`, { ...send('POST', body), schema: ReviewEngagementResponseSchema }),
    shareWithReviewer: (orgId: string, id: string, body: ReviewSharingGrantRequest) =>
      client.request(`${reviewPath(orgId)}/engagements/${seg(id)}/sharing`, { ...send('POST', body), schema: ReviewEngagementResponseSchema }),
    revokeSharing: (orgId: string, id: string, grantId: string) =>
      client.request(`${reviewPath(orgId)}/engagements/${seg(id)}/sharing/${seg(grantId)}/revoke`, { ...send('POST', {}), schema: ReviewEngagementResponseSchema }),
    engagementReport: (orgId: string, id: string) => client.request(`${reviewPath(orgId)}/engagements/${seg(id)}/report`, { method: 'GET', schema: ReviewReportViewSchema }),
    engagementActions: (orgId: string, id: string) =>
      client.request(`${reviewPath(orgId)}/engagements/${seg(id)}/actions`, { method: 'GET', schema: ImprovementActionsResponseSchema }),
    createEngagementAction: (orgId: string, id: string, body: ImprovementActionCreateRequest) =>
      client.request(`${reviewPath(orgId)}/engagements/${seg(id)}/actions`, { ...send('POST', body), schema: ImprovementActionsResponseSchema }),
    updateEngagementAction: (orgId: string, id: string, actionId: string, body: ImprovementActionUpdateRequest) =>
      client.request(`${reviewPath(orgId)}/engagements/${seg(id)}/actions/${seg(actionId)}`, { ...send('PATCH', body), schema: ImprovementActionsResponseSchema }),

    // ── Workplace reviews: operations ─────────────────────────────────────
    opsReviewServices: () => client.request('/api/ops/workplace-reviews/services', { method: 'GET', schema: ReviewServicesResponseSchema }),
    reviewQueue: () => client.request('/api/ops/workplace-reviews/requests', { method: 'GET', schema: ReviewQueueResponseSchema }),
    opsReviewRequest: (id: string) => client.request(`/api/ops/workplace-reviews/requests/${seg(id)}`, { method: 'GET', schema: ReviewRequestOpsResponseSchema }),
    triageReviewRequest: (id: string, body: ReviewTriageRequest) =>
      client.request(`/api/ops/workplace-reviews/requests/${seg(id)}/triage`, { ...send('POST', body), schema: ReviewRequestOpsResponseSchema }),
    sendReviewScope: (id: string, body: ReviewScopeCreateRequest) =>
      client.request(`/api/ops/workplace-reviews/requests/${seg(id)}/scopes`, { ...send('POST', body), schema: ReviewRequestOpsResponseSchema }),
    reviewerCandidates: (q?: string) =>
      client.request(`/api/ops/workplace-reviews/reviewers${q ? `?q=${encodeURIComponent(q)}` : ''}`, { method: 'GET', schema: ReviewerCandidatesResponseSchema }),
    opsEngagement: (id: string) => client.request(`/api/ops/workplace-reviews/engagements/${seg(id)}`, { method: 'GET', schema: ReviewEngagementResponseSchema }),
    assignReviewer: (id: string, body: ReviewAssignRequest) =>
      client.request(`/api/ops/workplace-reviews/engagements/${seg(id)}/assign`, { ...send('POST', body), schema: ReviewEngagementResponseSchema }),
    proposeWindows: (id: string, body: ReviewWindowsRequest) =>
      client.request(`/api/ops/workplace-reviews/engagements/${seg(id)}/windows`, { ...send('POST', body), schema: ReviewEngagementResponseSchema }),
    opsCancelEngagement: (id: string, body: ReviewCancelRequest) =>
      client.request(`/api/ops/workplace-reviews/engagements/${seg(id)}/cancel`, { ...send('POST', body), schema: ReviewEngagementResponseSchema }),

    // ── Workplace reviews: the assigned reviewer (expert context) ─────────
    myEngagements: () => client.request('/api/expert/workplace-reviews/engagements', { method: 'GET', schema: ReviewEngagementListResponseSchema }),
    myEngagement: (id: string) => client.request(`${expertPath(id)}`, { method: 'GET', schema: ReviewEngagementResponseSchema }),
    engagementPack: (id: string) => client.request(`${expertPath(id)}/pack`, { method: 'GET', schema: ReviewPackResponseSchema }),
    myReport: (id: string) => client.request(`${expertPath(id)}/report`, { method: 'GET', schema: ReviewReportViewSchema }),
    saveReport: (id: string, body: ReviewReportDraftRequest) => client.request(`${expertPath(id)}/report`, { ...send('PUT', body), schema: ReviewReportViewSchema }),
    submitReportReview: (id: string) => client.request(`${expertPath(id)}/report/submit-review`, { ...send('POST', {}), schema: ReviewReportViewSchema }),
    shareReport: (id: string) => client.request(`${expertPath(id)}/report/share`, { ...send('POST', {}), schema: ReviewReportViewSchema }),
    engagementNotes: (id: string) => client.request(`${expertPath(id)}/notes`, { method: 'GET', schema: ReviewNotesResponseSchema }),
    addEngagementNote: (id: string, body: ReviewNoteRequest) => client.request(`${expertPath(id)}/notes`, { ...send('POST', body), schema: ReviewNotesResponseSchema }),
    myEngagementActions: (id: string) => client.request(`${expertPath(id)}/actions`, { method: 'GET', schema: ImprovementActionsResponseSchema }),
    proposeAction: (id: string, body: ImprovementActionCreateRequest) =>
      client.request(`${expertPath(id)}/actions`, { ...send('POST', body), schema: ImprovementActionsResponseSchema }),
    planFollowUp: (id: string, body: ReviewFollowUpRequest) => client.request(`${expertPath(id)}/follow-up`, { ...send('POST', body), schema: ReviewEngagementResponseSchema }),
    completeEngagement: (id: string) => client.request(`${expertPath(id)}/complete`, { ...send('POST', {}), schema: ReviewEngagementResponseSchema }),
  };
}

export type ListeningApi = ReturnType<typeof createListeningApi>;
