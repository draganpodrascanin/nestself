/**
 * Typed wrappers for the employee listening routes (ADR 0002): the employee's
 * survey, the organization's reports, cycles and configuration view, the
 * review offer, and the operations routes for configuration and
 * questionnaire versions. Every method parses the response with the matching
 * contracts schema; the CSV export is fetched as text through `exportCsv`.
 */
import {
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
import type { ApiClient } from './client';
import { ApiError } from './errors';

function send(method: 'POST' | 'PUT' | 'PATCH', body: unknown, headers: Record<string, string> = {}): RequestInit {
  return { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } };
}

const seg = encodeURIComponent;

export function createListeningApi(client: ApiClient) {
  const orgPath = (orgId: string) => `/api/orgs/${seg(orgId)}/listening`;
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
  };
}

export type ListeningApi = ReturnType<typeof createListeningApi>;
