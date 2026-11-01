import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SAMPLE_REVIEW_ENGAGEMENT_ID, SAMPLE_REVIEW_ENGAGEMENT_PENDING, SAMPLE_REVIEW_REQUEST_OPS, SAMPLE_REVIEW_REQUEST_OPS_NEW, SAMPLE_REVIEW_SERVICE_ID } from '@nestself/sample-data';
import { apiError, choose, makeListeningApi, renderListeningOps, startsWith, t } from '../listening/listening-ops-test-harness';
import { RequestDetailScreen, fromLocalInput, parsePriceMinor, toLocalInput } from './request-detail-screen';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const NEW_ID = SAMPLE_REVIEW_REQUEST_OPS_NEW.id;
const screenFor = (requestId: string) => (api: Parameters<typeof RequestDetailScreen>[0]['listeningApi'], sample: boolean) => (
  <RequestDetailScreen listeningApi={api} sampleMode={sample} requestId={requestId} />
);

describe('form helpers', () => {
  it('convert local inputs and the price field', () => {
    expect(fromLocalInput('')).toBeNull();
    expect(fromLocalInput('not a date')).toBeNull();
    const iso = fromLocalInput('2026-11-20T10:00')!;
    expect(toLocalInput(iso)).toBe('2026-11-20T10:00');
    expect(parsePriceMinor('')).toEqual({ ok: true, value: null });
    expect(parsePriceMinor(' 120000 ')).toEqual({ ok: true, value: 120000 });
    expect(parsePriceMinor('12.50')).toEqual({ ok: false });
    expect(parsePriceMinor('-1')).toEqual({ ok: false });
  });
});

describe('RequestDetailScreen', () => {
  it('shows the requester context and consent, then asks for information with the employer-facing text', async () => {
    const user = userEvent.setup();
    const { listeningApi } = renderListeningOps(screenFor(NEW_ID));
    expect(await screen.findByRole('heading', { name: t('listening:reviewOps.request.title', { organization: SAMPLE_REVIEW_REQUEST_OPS_NEW.organizationName }) })).toBeInTheDocument();
    expect(screen.getByText(t('listening:reviewOps.request.noShare'))).toBeInTheDocument();
    expect(screen.getByText(t('listening:reviewOps.request.noContext'))).toBeInTheDocument();
    expect(screen.getByText(t('listening:reviewOps.request.noScopes'))).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: t('listening:reviewOps.request.sendScope') })).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: t('listening:reviewOps.request.needInfo') }));
    await user.click(screen.getByRole('button', { name: t('listening:reviewOps.request.apply') }));
    expect(await screen.findByText(t('listening:reviewOps.request.errors.required'))).toBeInTheDocument();
    expect(listeningApi.triageReviewRequest).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(startsWith(t('listening:reviewOps.request.infoText'))), 'Which teams are in scope?');
    await user.click(screen.getByRole('button', { name: t('listening:reviewOps.request.apply') }));
    await waitFor(() => expect(listeningApi.triageReviewRequest).toHaveBeenCalledWith(NEW_ID, { status: 'needs_information', informationRequest: 'Which teams are in scope?' }));
    expect(await screen.findByText(t('listening:reviewOps.request.triaged'))).toBeInTheDocument();
  });

  it('sends a scope from the catalogue with the typed price in cents, or keeps the quote open', async () => {
    const user = userEvent.setup();
    const inReview = { ...SAMPLE_REVIEW_REQUEST_OPS_NEW, status: 'in_review' as const, serviceId: SAMPLE_REVIEW_SERVICE_ID };
    const { listeningApi } = renderListeningOps(screenFor(NEW_ID), { listeningApi: makeListeningApi({ opsReviewRequest: vi.fn().mockResolvedValue(inReview) }) });
    expect(await screen.findByRole('heading', { name: t('listening:reviewOps.request.sendScope') })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('listening:reviewOps.request.scope.send') }));
    expect(await screen.findByText(t('listening:reviewOps.request.errors.required'))).toBeInTheDocument();
    expect(listeningApi.sendReviewScope).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(startsWith(t('listening:reviewOps.request.scope.title'))), 'Workload review, commercial');
    await user.type(screen.getByLabelText(startsWith(t('listening:reviewOps.request.scope.deliverables'))), 'A meeting and a report.');
    await user.type(screen.getByLabelText(startsWith(t('listening:reviewOps.request.scope.participants'))), 'HR lead, one reviewer');
    await user.type(screen.getByLabelText(startsWith(t('listening:reviewOps.request.scope.price'))), '120000');
    await user.type(screen.getByLabelText(startsWith(t('listening:reviewOps.request.scope.cancellation'))), 'Free up to 48 hours before.');
    await user.click(screen.getByRole('button', { name: t('listening:reviewOps.request.scope.send') }));
    await waitFor(() => expect(listeningApi.sendReviewScope).toHaveBeenCalledTimes(1));
    const [id, body] = (listeningApi.sendReviewScope as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(id).toBe(NEW_ID);
    expect(body).toMatchObject({
      serviceId: SAMPLE_REVIEW_SERVICE_ID,
      title: 'Workload review, commercial',
      deliverables: 'A meeting and a report.',
      participants: 'HR lead, one reviewer',
      priceMinor: 120000,
      currency: 'EUR',
      taxNote: null,
      termsVersion: '2026-11',
      cancellationPolicy: 'Free up to 48 hours before.',
    });
    expect(body.validUntil).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await screen.findByText(t('listening:reviewOps.request.scope.sent'))).toBeInTheDocument();
  });

  it('assigns a reviewer only once one is chosen, renders reviewer_not_qualified, and proposes windows of the service duration', async () => {
    const user = userEvent.setup();
    const api = makeListeningApi({
      opsReviewRequest: vi.fn().mockResolvedValue(SAMPLE_REVIEW_REQUEST_OPS),
      opsEngagement: vi.fn().mockResolvedValue({ ...SAMPLE_REVIEW_ENGAGEMENT_PENDING, id: SAMPLE_REVIEW_ENGAGEMENT_ID, reviewerFirstName: null }),
      assignReviewer: vi.fn().mockRejectedValueOnce(apiError(409, 'reviewer_not_qualified')).mockResolvedValue(SAMPLE_REVIEW_REQUEST_OPS),
    });
    renderListeningOps(screenFor(SAMPLE_REVIEW_REQUEST_OPS.id), { listeningApi: api });
    const assign = await screen.findByRole('button', { name: t('listening:reviewOps.engagement.assign') });
    expect(assign).toBeDisabled();
    expect(screen.getByText(t('listening:reviewOps.engagement.noReviewer'))).toBeInTheDocument();
    await choose(user, t('listening:reviewOps.engagement.pickReviewer'), 'Milica Radović');
    expect(assign).toBeEnabled();
    await user.click(assign);
    await waitFor(() => expect(api.assignReviewer).toHaveBeenCalledWith(SAMPLE_REVIEW_ENGAGEMENT_ID, { reviewerUserId: 'user_milica' }));
    expect(await screen.findByText(t('listening:errors.reviewer_not_qualified'))).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(startsWith(`${t('listening:reviewOps.engagement.window', { n: 1 })}: ${t('listening:reviewOps.engagement.start')}`)), { target: { value: '2026-11-20T10:00' } });
    await user.click(screen.getByRole('button', { name: t('listening:reviewOps.engagement.propose') }));
    await waitFor(() => expect(api.proposeWindows).toHaveBeenCalledTimes(1));
    const [id, body] = (api.proposeWindows as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(id).toBe(SAMPLE_REVIEW_ENGAGEMENT_ID);
    expect(body.windows).toHaveLength(1);
    const startsAt = new Date(body.windows[0].startsAt).getTime();
    const endsAt = new Date(body.windows[0].endsAt).getTime();
    expect((endsAt - startsAt) / 60_000).toBe(30);
    expect(typeof body.timeZone).toBe('string');
    expect(await screen.findByText(t('listening:reviewOps.engagement.proposed'))).toBeInTheDocument();
  });
});
