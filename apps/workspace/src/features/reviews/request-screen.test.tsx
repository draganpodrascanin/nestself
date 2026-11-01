import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SAMPLE_REVIEW_ENGAGEMENT_ID, SAMPLE_REVIEW_REQUEST, SAMPLE_REVIEW_REQUEST_ID, SAMPLE_REVIEW_SCOPE_ID } from '@nestself/sample-data';
import { ORG_ID, actionsWithout, apiError, makeAuth, makeListeningApi, renderWithProviders, t } from '../listening/listening-test-harness';
import { RequestScreen } from './request-screen';
import { ReviewsScreen } from './reviews-screen';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SENT_SCOPE = { ...SAMPLE_REVIEW_REQUEST.scopes[0]!, status: 'sent' as const, acceptedAt: null };
const SCOPED = { ...SAMPLE_REVIEW_REQUEST, status: 'scoped' as const, engagementId: null, scopes: [SENT_SCOPE] };

describe('ReviewsScreen', () => {
  it('lists requests and engagements with their status text and offers a new request only with the grant', async () => {
    renderWithProviders(<ReviewsScreen listeningApi={makeListeningApi()} sampleMode={false} />);
    expect(await screen.findByRole('link', { name: t('listening:reviews.scope.company') })).toHaveAttribute('href', `/listening/reviews/${SAMPLE_REVIEW_REQUEST_ID}`);
    const requests = screen.getByRole('table', { name: t('listening:reviews.requests') });
    expect(within(requests).getByText(t('listening:reviews.status.request.converted'))).toBeInTheDocument();
    const engagements = screen.getByRole('table', { name: t('listening:reviews.engagements') });
    expect(within(engagements).getByText(t('listening:reviews.status.engagement.report_shared'))).toBeInTheDocument();
    expect(within(engagements).getByText(t('listening:reviews.status.engagement.accepted'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('listening:reviews.newRequest') })).toHaveAttribute('href', '/listening/reviews/new');
    cleanup();

    renderWithProviders(<ReviewsScreen listeningApi={makeListeningApi()} sampleMode={false} />, makeAuth({ effectiveActions: actionsWithout('workplace_reviews.request') }));
    await screen.findByRole('link', { name: t('listening:reviews.scope.company') });
    expect(screen.queryByRole('link', { name: t('listening:reviews.newRequest') })).not.toBeInTheDocument();
  });
});

describe('RequestScreen', () => {
  it('shows the price from the scope, accepts it after confirmation and moves to the engagement', async () => {
    const user = userEvent.setup();
    const api = makeListeningApi({ reviewRequest: vi.fn().mockResolvedValue(SCOPED) });
    renderWithProviders(<RequestScreen listeningApi={api} sampleMode={false} requestId={SAMPLE_REVIEW_REQUEST_ID} />);
    expect(await screen.findByRole('heading', { name: SENT_SCOPE.title })).toBeInTheDocument();
    expect(screen.getByText(t('listening:reviews.status.scope.sent'))).toBeInTheDocument();
    expect(screen.getByText('€1,200.00')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t('listening:reviews.detail.scope.accept') }));
    expect(await screen.findByText(t('listening:reviews.detail.scope.acceptBody'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('listening:reviews.detail.scope.acceptConfirm') }));
    await waitFor(() => expect(api.acceptReviewScope).toHaveBeenCalledWith(ORG_ID, SAMPLE_REVIEW_SCOPE_ID));
    expect(await screen.findByTestId('elsewhere')).toBeInTheDocument();
    expect(SAMPLE_REVIEW_ENGAGEMENT_ID).toBe('review_engagement_sample_1');
  });

  it('tells a requester without spending authority that only an approver accepts, and renders quote_expired', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <RequestScreen listeningApi={makeListeningApi({ reviewRequest: vi.fn().mockResolvedValue(SCOPED) })} sampleMode={false} requestId={SAMPLE_REVIEW_REQUEST_ID} />,
      makeAuth({ effectiveActions: actionsWithout('workplace_reviews.scope.accept') }),
    );
    expect(await screen.findByText(t('listening:reviews.detail.scope.noAuthority'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('listening:reviews.detail.scope.accept') })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('listening:reviews.detail.cancel') })).toBeInTheDocument();
    cleanup();

    const api = makeListeningApi({ reviewRequest: vi.fn().mockResolvedValue(SCOPED), acceptReviewScope: vi.fn().mockRejectedValue(apiError(409, 'quote_expired')) });
    renderWithProviders(<RequestScreen listeningApi={api} sampleMode={false} requestId={SAMPLE_REVIEW_REQUEST_ID} />);
    await user.click(await screen.findByRole('button', { name: t('listening:reviews.detail.scope.accept') }));
    await user.click(await screen.findByRole('button', { name: t('listening:reviews.detail.scope.acceptConfirm') }));
    expect(await screen.findByText(t('listening:errors.quote_expired'))).toBeInTheDocument();
  });

  it('shows the converted request with its engagement link and no cancel', async () => {
    renderWithProviders(<RequestScreen listeningApi={makeListeningApi()} sampleMode={false} requestId={SAMPLE_REVIEW_REQUEST_ID} />);
    expect(await screen.findByRole('link', { name: t('listening:reviews.detail.viewEngagement') })).toHaveAttribute('href', `/listening/reviews/engagements/${SAMPLE_REVIEW_ENGAGEMENT_ID}`);
    expect(screen.queryByRole('button', { name: t('listening:reviews.detail.cancel') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('listening:reviews.detail.scope.accept') })).not.toBeInTheDocument();
  });
});
