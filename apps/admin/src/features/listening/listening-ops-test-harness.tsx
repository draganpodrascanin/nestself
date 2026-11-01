/**
 * Test-only harness for the operations listening screens: a mocked
 * `ListeningApi`, an auth context in the operations context, and a memory
 * router around the screen under test.
 */
import { vi } from 'vitest';
import { configure, render, screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import i18next from 'i18next';
import type { Resource } from 'i18next';
import { resourcesFor } from '@nestself/i18n';
import { ApiError } from '@nestself/api-client';
import type { ListeningApi } from '@nestself/api-client';
import type { Principal } from '@nestself/contracts';
import {
  SAMPLE_LISTENING_CONFIGURATION,
  SAMPLE_PRINCIPALS,
  SAMPLE_QUESTIONNAIRES,
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
} from '@nestself/sample-data';
import { ToastProvider } from '@nestself/ui';
import { AuthContext } from '../../auth/auth-context';
import type { AuthContextValue } from '../../auth';

configure({ asyncUtilTimeout: 4000 });

export const testI18n = i18next.createInstance();
void testI18n.use(initReactI18next).init({
  lng: 'en',
  resources: resourcesFor(['common', 'admin', 'auth', 'listening']) as Resource,
  interpolation: { escapeValue: false },
  returnNull: false,
});
export const t = (key: string, opts?: Record<string, unknown>) => testI18n.t(key, opts);

export const ORG_ID = 'org_sample';

export function apiError(status: number, code: string, details?: Record<string, unknown>): ApiError {
  return new ApiError({ status, code, message: `English ${code}`, requestId: null, ...(details ? { details } : {}) });
}

export function makeListeningApi(overrides: Partial<Record<keyof ListeningApi, unknown>> = {}): ListeningApi {
  const draft = SAMPLE_QUESTIONNAIRES.items[0]!;
  return {
    mySurvey: vi.fn(),
    saveDraft: vi.fn(),
    submitSurvey: vi.fn(),
    overview: vi.fn(),
    heatmap: vi.fn(),
    dimension: vi.fn(),
    exportCsvPath: vi.fn(),
    exportCsv: vi.fn(),
    listCycles: vi.fn(),
    scheduleCycle: vi.fn(),
    cancelCycle: vi.fn(),
    dismissOffer: vi.fn(),
    configuration: vi.fn(),
    opsConfiguration: vi.fn().mockResolvedValue(SAMPLE_LISTENING_CONFIGURATION),
    updateOpsConfiguration: vi.fn().mockResolvedValue({ ...SAMPLE_LISTENING_CONFIGURATION, policyVersion: 2 }),
    listQuestionnaires: vi.fn().mockResolvedValue(SAMPLE_QUESTIONNAIRES),
    createQuestionnaire: vi.fn().mockResolvedValue({ ...draft, id: 'questionnaire_v3_draft', version: 3 }),
    updateQuestionnaire: vi.fn().mockResolvedValue(draft),
    submitQuestionnaireReview: vi.fn().mockResolvedValue({ ...draft, status: 'in_review' }),
    publishQuestionnaire: vi.fn().mockResolvedValue({ ...draft, status: 'published', publishedAt: '2026-11-02T09:00:00.000Z' }),
    archiveQuestionnaire: vi.fn().mockResolvedValue({ ...draft, status: 'archived' }),
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

/** The sample platform owner, in the operations context; holds the listening administrator template. */
export const ADMIN = SAMPLE_PRINCIPALS.admin;
export const OPS_PRINCIPAL: Principal = ADMIN.principal;

export function makeAuth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status: 'authenticated',
    principal: OPS_PRINCIPAL,
    effectiveActions: [...ADMIN.effectiveActions],
    signOut: vi.fn().mockResolvedValue(undefined),
    switchContext: vi.fn().mockResolvedValue(undefined),
    stepUp: vi.fn().mockResolvedValue(true),
    refreshPrincipal: vi.fn().mockResolvedValue(undefined),
    availableContexts: [],
    error: null,
    ...overrides,
  };
}

/** The sample platform owner's actions without the listed ones. */
export function actionsWithout(...removed: string[]): string[] {
  return ADMIN.effectiveActions.filter((a) => !removed.includes(a));
}

export interface RenderOpts {
  listeningApi?: ListeningApi;
  auth?: AuthContextValue;
  sampleMode?: boolean;
}

/** Renders `screenFor(...)` at `/` of a memory router. */
export function renderListeningOps(screenFor: (listeningApi: ListeningApi, sampleMode: boolean) => ReactNode, opts: RenderOpts = {}) {
  const listeningApi = opts.listeningApi ?? makeListeningApi();
  const auth = opts.auth ?? makeAuth();
  const sampleMode = opts.sampleMode ?? false;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => <>{screenFor(listeningApi, sampleMode)}</> });
  const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute]), history: createMemoryHistory({ initialEntries: ['/'] }) });

  const result = render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={testI18n}>
        <ToastProvider labels={{ dismiss: 'Dismiss' }}>
          <AuthContext value={auth}>
            <RouterProvider router={router} />
          </AuthContext>
        </ToastProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { listeningApi, auth, queryClient, ...result };
}

export async function choose(user: UserEvent, label: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: option }));
}

/** A regular expression matching an accessible name that starts with the (literal) text. */
export function startsWith(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
}
