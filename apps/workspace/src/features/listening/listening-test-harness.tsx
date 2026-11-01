/**
 * Test-only helpers for the listening screens: an i18n instance with the
 * listening namespace, a fake listening API, a router around the screen (the
 * screens link to other listening routes) and the auth, query and toast
 * providers.
 */
import { vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18next from 'i18next';
import type { Resource } from 'i18next';
import { resourcesFor } from '@nestself/i18n';
import { ApiError } from '@nestself/api-client';
import type { ListeningApi } from '@nestself/api-client';
import type { Principal } from '@nestself/contracts';
import {
  SAMPLE_DIMENSION_DETAILS,
  SAMPLE_FEEDBACK_INBOX,
  SAMPLE_FEEDBACK_ROUTES,
  SAMPLE_FEEDBACK_ROUTES_ADMIN,
  SAMPLE_HANDLER_FEEDBACK_CASE,
  SAMPLE_LISTENING_CONFIGURATION,
  SAMPLE_LISTENING_HEATMAP,
  SAMPLE_LISTENING_OVERVIEW,
  SAMPLE_MY_FEEDBACK_CASE,
  SAMPLE_MY_FEEDBACK_CASES,
  SAMPLE_MY_SURVEY,
  SAMPLE_PRINCIPALS,
  SAMPLE_REVIEWER_CANDIDATES,
  SAMPLE_REVIEW_ENGAGEMENT,
  SAMPLE_REVIEW_ENGAGEMENTS,
  SAMPLE_REVIEW_ENGAGEMENT_PENDING,
  SAMPLE_REVIEW_PACK,
  SAMPLE_REVIEW_QUEUE,
  SAMPLE_REVIEW_REPORT,
  SAMPLE_REVIEW_REQUEST,
  SAMPLE_REVIEW_REQUESTS,
  SAMPLE_REVIEW_REQUEST_OPS_NEW,
  SAMPLE_REVIEW_SERVICES,
  SAMPLE_SURVEY_CYCLES,
} from '@nestself/sample-data';
import { ToastProvider } from '@nestself/ui';
import { AuthContext } from '../../auth/auth-context';
import type { AuthContextValue } from '../../auth';

export const testI18n = i18next.createInstance();
void testI18n.use(initReactI18next).init({
  lng: 'en',
  resources: resourcesFor(['common', 'workspace', 'auth', 'library', 'listening']) as Resource,
  interpolation: { escapeValue: false },
  returnNull: false,
});
export const t = (key: string, opts?: Record<string, unknown>) => testI18n.t(key, opts);

export const ORG_ID = 'org_sample';

export function apiError(status: number, code: string, details?: Record<string, unknown>): ApiError {
  return new ApiError({ status, code, message: `English ${code}`, requestId: null, details });
}

export function makeListeningApi(overrides: Partial<Record<keyof ListeningApi, unknown>> = {}): ListeningApi {
  return {
    mySurvey: vi.fn().mockResolvedValue(SAMPLE_MY_SURVEY),
    saveDraft: vi.fn().mockResolvedValue({ savedAt: '2026-11-02T09:00:00.000Z' }),
    submitSurvey: vi.fn().mockResolvedValue({ submittedAt: '2026-11-02T09:05:00.000Z' }),
    overview: vi.fn().mockResolvedValue(SAMPLE_LISTENING_OVERVIEW),
    heatmap: vi.fn().mockResolvedValue(SAMPLE_LISTENING_HEATMAP),
    dimension: vi.fn().mockImplementation(async (_orgId: string, key: keyof typeof SAMPLE_DIMENSION_DETAILS) => SAMPLE_DIMENSION_DETAILS[key]),
    exportCsvPath: vi.fn().mockReturnValue('/api/orgs/org_sample/listening/snapshots/s/export.csv'),
    exportCsv: vi.fn().mockResolvedValue({ filename: 'listening.csv', content: 'a,b\r\n' }),
    listCycles: vi.fn().mockResolvedValue(SAMPLE_SURVEY_CYCLES),
    scheduleCycle: vi.fn().mockResolvedValue(SAMPLE_SURVEY_CYCLES.items[0]),
    cancelCycle: vi.fn().mockResolvedValue({ ...SAMPLE_SURVEY_CYCLES.items[0], status: 'canceled' }),
    dismissOffer: vi.fn().mockResolvedValue({ dismissed: true }),
    configuration: vi.fn().mockResolvedValue(SAMPLE_LISTENING_CONFIGURATION),
    opsConfiguration: vi.fn(),
    updateOpsConfiguration: vi.fn(),
    listQuestionnaires: vi.fn(),
    createQuestionnaire: vi.fn(),
    updateQuestionnaire: vi.fn(),
    submitQuestionnaireReview: vi.fn(),
    publishQuestionnaire: vi.fn(),
    archiveQuestionnaire: vi.fn(),
    feedbackRoutes: vi.fn().mockResolvedValue(SAMPLE_FEEDBACK_ROUTES),
    createFeedbackCase: vi.fn().mockResolvedValue({ id: 'feedback_case_new', pseudonym: 'Reporter-AB2C', state: 'submitted', dueAt: '2026-11-05T09:00:00.000Z', handlerFunction: 'alternate' }),
    myFeedbackCases: vi.fn().mockResolvedValue(SAMPLE_MY_FEEDBACK_CASES),
    myFeedbackCase: vi.fn().mockResolvedValue(SAMPLE_MY_FEEDBACK_CASE),
    replyToMyCase: vi.fn().mockResolvedValue(SAMPLE_MY_FEEDBACK_CASE),
    feedbackInbox: vi.fn().mockResolvedValue(SAMPLE_FEEDBACK_INBOX),
    handlerCase: vi.fn().mockResolvedValue(SAMPLE_HANDLER_FEEDBACK_CASE),
    handlerMessage: vi.fn().mockResolvedValue(SAMPLE_HANDLER_FEEDBACK_CASE),
    setCaseState: vi.fn().mockResolvedValue(SAMPLE_HANDLER_FEEDBACK_CASE),
    reassignCase: vi.fn().mockResolvedValue(SAMPLE_HANDLER_FEEDBACK_CASE),
    orgFeedbackRoutes: vi.fn().mockResolvedValue(SAMPLE_FEEDBACK_ROUTES_ADMIN),
    updateOrgFeedbackRoutes: vi.fn().mockResolvedValue(SAMPLE_FEEDBACK_ROUTES_ADMIN),
    reviewServices: vi.fn().mockResolvedValue(SAMPLE_REVIEW_SERVICES),
    createReviewRequest: vi.fn().mockResolvedValue({ ...SAMPLE_REVIEW_REQUEST, id: 'review_request_new', status: 'submitted', scopes: [], engagementId: null, coordinatorFirstName: null }),
    listReviewRequests: vi.fn().mockResolvedValue({ items: SAMPLE_REVIEW_REQUESTS }),
    reviewRequest: vi.fn().mockResolvedValue(SAMPLE_REVIEW_REQUEST),
    cancelReviewRequest: vi.fn().mockResolvedValue({ ...SAMPLE_REVIEW_REQUEST, status: 'canceled' }),
    answerReviewInformation: vi.fn().mockResolvedValue(SAMPLE_REVIEW_REQUEST),
    acceptReviewScope: vi.fn().mockResolvedValue(SAMPLE_REVIEW_ENGAGEMENT),
    rejectReviewScope: vi.fn().mockResolvedValue({ rejected: true }),
    listEngagements: vi.fn().mockResolvedValue({ items: SAMPLE_REVIEW_ENGAGEMENTS }),
    engagement: vi.fn().mockResolvedValue(SAMPLE_REVIEW_ENGAGEMENT),
    bookEngagement: vi.fn().mockResolvedValue({ ...SAMPLE_REVIEW_ENGAGEMENT_PENDING, status: 'scheduled', proposedWindows: null }),
    cancelEngagement: vi.fn().mockResolvedValue({ ...SAMPLE_REVIEW_ENGAGEMENT, status: 'canceled' }),
    shareWithReviewer: vi.fn().mockResolvedValue(SAMPLE_REVIEW_ENGAGEMENT),
    revokeSharing: vi.fn().mockResolvedValue(SAMPLE_REVIEW_ENGAGEMENT),
    engagementReport: vi.fn().mockResolvedValue(SAMPLE_REVIEW_REPORT),
    engagementActions: vi.fn().mockResolvedValue({ items: SAMPLE_REVIEW_ENGAGEMENT.actions }),
    createEngagementAction: vi.fn().mockResolvedValue({ items: SAMPLE_REVIEW_ENGAGEMENT.actions }),
    updateEngagementAction: vi.fn().mockResolvedValue({ items: SAMPLE_REVIEW_ENGAGEMENT.actions }),
    opsReviewServices: vi.fn().mockResolvedValue(SAMPLE_REVIEW_SERVICES),
    reviewQueue: vi.fn().mockResolvedValue(SAMPLE_REVIEW_QUEUE),
    opsReviewRequest: vi.fn().mockResolvedValue(SAMPLE_REVIEW_REQUEST_OPS_NEW),
    triageReviewRequest: vi.fn().mockResolvedValue({ ...SAMPLE_REVIEW_REQUEST_OPS_NEW, status: 'in_review' }),
    sendReviewScope: vi.fn().mockResolvedValue({ ...SAMPLE_REVIEW_REQUEST_OPS_NEW, status: 'scoped' }),
    reviewerCandidates: vi.fn().mockResolvedValue(SAMPLE_REVIEWER_CANDIDATES),
    opsEngagement: vi.fn().mockResolvedValue(SAMPLE_REVIEW_ENGAGEMENT_PENDING),
    assignReviewer: vi.fn().mockResolvedValue(SAMPLE_REVIEW_ENGAGEMENT_PENDING),
    proposeWindows: vi.fn().mockResolvedValue(SAMPLE_REVIEW_ENGAGEMENT_PENDING),
    opsCancelEngagement: vi.fn().mockResolvedValue({ ...SAMPLE_REVIEW_ENGAGEMENT_PENDING, status: 'canceled' }),
    myEngagements: vi.fn().mockResolvedValue({ items: SAMPLE_REVIEW_ENGAGEMENTS }),
    myEngagement: vi.fn().mockResolvedValue(SAMPLE_REVIEW_ENGAGEMENT),
    engagementPack: vi.fn().mockResolvedValue(SAMPLE_REVIEW_PACK),
    myReport: vi.fn().mockResolvedValue(SAMPLE_REVIEW_REPORT),
    saveReport: vi.fn().mockResolvedValue({ ...SAMPLE_REVIEW_REPORT, version: 2, status: 'draft', sharedAt: null }),
    submitReportReview: vi.fn().mockResolvedValue({ ...SAMPLE_REVIEW_REPORT, status: 'in_review' }),
    shareReport: vi.fn().mockResolvedValue(SAMPLE_REVIEW_REPORT),
    engagementNotes: vi.fn().mockResolvedValue({ items: [] }),
    addEngagementNote: vi.fn().mockResolvedValue({ items: [{ id: 'note_1', body: 'x', createdAt: '2026-11-02T09:00:00.000Z' }] }),
    myEngagementActions: vi.fn().mockResolvedValue({ items: SAMPLE_REVIEW_ENGAGEMENT.actions }),
    proposeAction: vi.fn().mockResolvedValue({ items: SAMPLE_REVIEW_ENGAGEMENT.actions }),
    planFollowUp: vi.fn().mockResolvedValue({ ...SAMPLE_REVIEW_ENGAGEMENT, status: 'follow_up' }),
    completeEngagement: vi.fn().mockResolvedValue({ ...SAMPLE_REVIEW_ENGAGEMENT, status: 'completed' }),
    ...overrides,
  } as unknown as ListeningApi;
}

/** The sample HR admin in the organization context (the listening screens switch on mount; the harness starts switched). */
export const HR_PRINCIPAL: Principal = {
  ...SAMPLE_PRINCIPALS.hr_admin.principal,
  context: { kind: 'organization', orgId: ORG_ID },
};

export const EMPLOYEE_PRINCIPAL: Principal = SAMPLE_PRINCIPALS.employee.principal;

export function makeAuth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status: 'authenticated',
    principal: HR_PRINCIPAL,
    effectiveActions: [...SAMPLE_PRINCIPALS.hr_admin.effectiveActions],
    availableContexts: [],
    signOut: vi.fn().mockResolvedValue(undefined),
    switchContext: vi.fn().mockResolvedValue(undefined),
    stepUp: vi.fn().mockResolvedValue(true),
    refreshPrincipal: vi.fn().mockResolvedValue(undefined),
    error: null,
    ...overrides,
  };
}

export function employeeAuth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return makeAuth({ principal: EMPLOYEE_PRINCIPAL, effectiveActions: [...SAMPLE_PRINCIPALS.employee.effectiveActions], ...overrides });
}

/** Effective actions of the sample HR admin without the listed ones. */
export function actionsWithout(...removed: string[]): string[] {
  return SAMPLE_PRINCIPALS.hr_admin.effectiveActions.filter((a) => !removed.includes(a));
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

/**
 * Renders the element inside a memory router at `/`, so `<Link>`s resolve
 * without the app's generated route tree.
 */
export function renderWithProviders(element: ReactElement, auth: AuthContextValue = makeAuth(), queryClient: QueryClient = makeQueryClient()) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => element });
  const catchAll = createRoute({ getParentRoute: () => rootRoute, path: '$', component: () => <div data-testid="elsewhere" /> });
  const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute, catchAll]), history: createMemoryHistory({ initialEntries: ['/'] }) });
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>
        <ToastProvider labels={{ dismiss: 'Dismiss' }}>
          <AuthContext value={auth}>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- the test router's tree is not the app's registered tree */}
            <RouterProvider router={router as any} />
          </AuthContext>
        </ToastProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}
