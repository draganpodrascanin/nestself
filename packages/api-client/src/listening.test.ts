import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';
import { ApiError } from './errors';
import { createListeningApi } from './listening';

const RECEIPT = { submittedAt: '2026-11-02T09:00:00.000Z' };
const CYCLE = { id: 'c1', opensAt: '2026-11-02T07:00:00.000Z', closesAt: '2026-11-09T07:00:00.000Z', status: 'open', audienceSize: 12, questionnaireVersion: 1, publishedSnapshotId: null };

describe('createListeningApi', () => {
  let calls: Array<{ url: string; init: RequestInit }>;
  let fetchImpl: typeof fetch;
  let responder: (url: string) => { status: number; body?: unknown; text?: string; headers?: Record<string, string> };

  beforeEach(() => {
    calls = [];
    responder = () => ({ status: 200, body: RECEIPT });
    fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const r = responder(String(url));
      const headers = new Headers({ 'content-type': r.text !== undefined ? 'text/csv' : 'application/json', ...(r.headers ?? {}) });
      return new Response(r.text ?? JSON.stringify(r.body ?? {}), { status: r.status, headers });
    }) as typeof fetch;
  });

  afterEach(() => vi.restoreAllMocks());

  const api = () => createListeningApi(createApiClient({ baseUrl: 'https://api.test', mode: 'cookie', fetchImpl }));

  it('submits with the Idempotency-Key header and parses the receipt', async () => {
    const receipt = await api().submitSurvey('c1', { answers: { speaking_up: 4 }, questionnaireVersionId: 'q1' }, 'key-123');
    expect(receipt).toEqual(RECEIPT);
    expect(calls[0]!.url).toBe('https://api.test/api/me/listening/survey/c1/submit');
    expect(new Headers(calls[0]!.init.headers).get('Idempotency-Key')).toBe('key-123');
    expect(calls[0]!.init.method).toBe('POST');
  });

  it('schedules a cycle through the organization route', async () => {
    responder = () => ({ status: 200, body: CYCLE });
    const cycle = await api().scheduleCycle('org_1', { opensAt: '2026-11-02T07:00:00.000Z' });
    expect(cycle.id).toBe('c1');
    expect(calls[0]!.url).toBe('https://api.test/api/orgs/org_1/listening/cycles');
  });

  it('builds the heatmap and dimension URLs with the snapshot query', async () => {
    responder = () => ({ status: 404, body: { code: 'not_found', message: 'nope' } });
    await expect(api().heatmap('org_1', 'snap 1')).rejects.toBeInstanceOf(ApiError);
    expect(calls[0]!.url).toBe('https://api.test/api/orgs/org_1/listening/heatmap?snapshotId=snap%201');
    await expect(api().dimension('org_1', 'speaking_up')).rejects.toBeInstanceOf(ApiError);
    expect(calls[1]!.url).toBe('https://api.test/api/orgs/org_1/listening/dimensions/speaking_up');
  });

  it('downloads the CSV as text with the filename from the disposition and maps failures to ApiError', async () => {
    responder = () => ({ status: 200, text: 'a,b\r\n1,2\r\n', headers: { 'content-disposition': 'attachment; filename="listening-snap_1.csv"' } });
    const file = await api().exportCsv('org_1', 'snap_1', fetchImpl);
    expect(file).toEqual({ filename: 'listening-snap_1.csv', content: 'a,b\r\n1,2\r\n' });
    expect(calls[0]!.url).toBe('https://api.test/api/orgs/org_1/listening/snapshots/snap_1/export.csv');
    expect(calls[0]!.init.credentials).toBe('include');

    responder = () => ({ status: 403, body: { code: 'step_up_required', message: 'x' } });
    const err = await api().exportCsv('org_1', 'snap_1', fetchImpl).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('step_up_required');
  });

  it('targets the operations routes for configuration and questionnaires', async () => {
    responder = () => ({ status: 200, body: { items: [] } });
    await api().listQuestionnaires();
    expect(calls[0]!.url).toBe('https://api.test/api/ops/listening/questionnaires');
    responder = () => ({ status: 404, body: { code: 'not_found', message: 'x' } });
    await expect(api().updateOpsConfiguration('org_1', { cadenceDays: 21 })).rejects.toBeInstanceOf(ApiError);
    expect(calls[1]!.url).toBe('https://api.test/api/ops/orgs/org_1/listening/configuration');
    expect(calls[1]!.init.method).toBe('PUT');
  });
  it('creates a feedback case with the Idempotency-Key and targets the case, inbox and route paths', async () => {
    responder = () => ({ status: 201, body: { id: 'fc1', pseudonym: 'Reporter-AB2C', state: 'submitted', dueAt: null, handlerFunction: 'alternate' } });
    const created = await api().createFeedbackCase({ routeId: 'r1', kind: 'problem', category: 'workload', routeChoice: 'alternate', anonymousToEmployer: true, body: 'x' }, 'key-9');
    expect(created.handlerFunction).toBe('alternate');
    expect(calls[0]!.url).toBe('https://api.test/api/me/feedback/cases');
    expect(new Headers(calls[0]!.init.headers).get('Idempotency-Key')).toBe('key-9');

    responder = () => ({ status: 200, body: { items: [] } });
    await api().feedbackInbox();
    expect(calls[1]!.url).toBe('https://api.test/api/feedback/inbox');
    await api().myFeedbackCases();
    expect(calls[2]!.url).toBe('https://api.test/api/me/feedback/cases');

    responder = () => ({ status: 200, body: { feedbackEnabled: true, sensitiveAllowed: false, items: [] } });
    await api().orgFeedbackRoutes('org_1');
    expect(calls[3]!.url).toBe('https://api.test/api/orgs/org_1/feedback/routes');

    const handlerCase = {
      id: 'fc1', orgId: 'org_1', kind: 'problem', category: 'workload', state: 'in_review', pseudonym: 'Reporter-AB2C', anonymousToEmployer: true,
      routeKind: 'standard', routeChoice: 'alternate', handlerUserId: 'u2', nextAction: 'respond', dueAt: null, escalatedAt: null, resolvedAt: null,
      closedAt: null, outcomeReason: null, createdAt: '2026-11-02T09:00:00.000Z', messages: [],
    };
    responder = () => ({ status: 200, body: handlerCase });
    const changed = await api().setCaseState('fc1', { state: 'in_review' });
    expect(changed.state).toBe('in_review');
    expect(calls[4]!.url).toBe('https://api.test/api/feedback/cases/fc1/state');
    expect(calls[4]!.init.method).toBe('POST');
    await api().reassignCase('fc1', { to: 'primary' });
    expect(calls[5]!.url).toBe('https://api.test/api/feedback/cases/fc1/reassign');

    responder = () => ({ status: 200, body: { ...handlerCase, reporterUserId: 'leak' } });
    await expect(api().handlerCase('fc1')).rejects.toBeInstanceOf(ApiError);
  });
  it('targets the workplace review routes of the organization, operations and the reviewer', async () => {
    responder = () => ({ status: 200, body: { workplaceReviewsEnabled: true, items: [] } });
    await api().reviewServices('org_1');
    expect(calls[0]!.url).toBe('https://api.test/api/orgs/org_1/workplace-reviews/services');

    const request = {
      id: 'req_1', status: 'submitted', scopeCohortKey: 'company', dimensionKeys: ['sustainable_workload'], snapshotIds: ['s1'], serviceId: null, shareAggregates: true,
      context: null, termsVersion: '2026-11', noticeVersion: '2026-11', createdAt: '2026-11-02T09:00:00.000Z', coordinatorFirstName: null, declineReason: null,
      informationRequest: null, informationAnswer: null, scopes: [], engagementId: null,
    };
    responder = () => ({ status: 201, body: request });
    await api().createReviewRequest('org_1', { snapshotIds: ['s1'], scopeCohortKey: 'company', dimensionKeys: ['sustainable_workload'], shareAggregates: true, termsVersion: '2026-11', noticeVersion: '2026-11' }, 'key-7');
    expect(calls[1]!.url).toBe('https://api.test/api/orgs/org_1/workplace-reviews/requests');
    expect(new Headers(calls[1]!.init.headers).get('Idempotency-Key')).toBe('key-7');

    responder = () => ({ status: 200, body: { items: [] } });
    await api().reviewQueue();
    expect(calls[2]!.url).toBe('https://api.test/api/ops/workplace-reviews/requests');
    await api().reviewerCandidates('mil');
    expect(calls[3]!.url).toBe('https://api.test/api/ops/workplace-reviews/reviewers?q=mil');
    await api().myEngagements();
    expect(calls[4]!.url).toBe('https://api.test/api/expert/workplace-reviews/engagements');

    responder = () => ({ status: 200, body: { rejected: true } });
    await api().rejectReviewScope('org_1', 'scope_1');
    expect(calls[5]!.url).toBe('https://api.test/api/orgs/org_1/workplace-reviews/scopes/scope_1/reject');
    expect(calls[5]!.init.method).toBe('POST');

    responder = () => ({ status: 200, body: { ...request, reporterUserId: 'leak' } });
    await expect(api().reviewRequest('org_1', 'req_1')).rejects.toBeInstanceOf(ApiError);

    responder = () => ({ status: 200, body: { workplaceReviewsEnabled: true, items: [] } });
    await api().opsReviewServices();
    expect(calls[calls.length - 1]!.url).toBe('https://api.test/api/ops/workplace-reviews/services');
  });
});
