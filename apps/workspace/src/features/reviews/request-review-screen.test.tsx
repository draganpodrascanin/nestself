import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SAMPLE_LISTENING_OVERVIEW, SAMPLE_REVIEW_SERVICE_ID, SAMPLE_REVIEW_SERVICES, SAMPLE_SNAPSHOT_CURRENT_ID } from '@nestself/sample-data';
import { ORG_ID, apiError, makeListeningApi, renderWithProviders, t } from '../listening/listening-test-harness';
import { RequestReviewScreen } from './request-review-screen';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const TERMS = t('listening:reviews.request.terms', { version: '2026-11' });

describe('RequestReviewScreen', () => {
  it('shows the quoted service without a number, refuses to send before the terms are accepted, then sends once with an idempotency key and shows the receipt', async () => {
    const user = userEvent.setup();
    const api = makeListeningApi({ overview: vi.fn().mockResolvedValue({ ...SAMPLE_LISTENING_OVERVIEW, reviewOffer: null }) });
    renderWithProviders(<RequestReviewScreen listeningApi={api} sampleMode={false} />);
    expect(await screen.findByRole('heading', { name: t('listening:reviews.request.title') })).toBeInTheDocument();
    expect(await screen.findByText(t('listening:reviews.request.difference'))).toBeInTheDocument();

    const summary = screen.getByTestId('service-summary');
    expect(within(summary).getByText(t('listening:reviews.pricing.quote'))).toBeInTheDocument();
    expect(summary.textContent).not.toMatch(/€|\d+[.,]\d{2}\s*(EUR|RSD)/);
    expect(api.createReviewRequest).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: t('listening:reviews.request.submit') }));
    expect(await screen.findByText(t('common:form.errorSummaryTitle'))).toBeInTheDocument();
    expect(screen.getAllByText(t('listening:reviews.request.errors.terms')).length).toBeGreaterThan(0);
    expect(api.createReviewRequest).not.toHaveBeenCalled();

    await user.click(screen.getByRole('checkbox', { name: TERMS }));
    await user.click(screen.getByRole('button', { name: t('listening:reviews.request.submit') }));
    await waitFor(() => expect(api.createReviewRequest).toHaveBeenCalledTimes(1));
    const [orgId, body, key] = (api.createReviewRequest as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(orgId).toBe(ORG_ID);
    expect(body).toMatchObject({
      snapshotIds: [SAMPLE_SNAPSHOT_CURRENT_ID],
      scopeCohortKey: 'company',
      serviceId: SAMPLE_REVIEW_SERVICE_ID,
      shareAggregates: true,
      termsVersion: SAMPLE_REVIEW_SERVICES.items[0]!.termsVersion,
      noticeVersion: SAMPLE_REVIEW_SERVICES.items[0]!.termsVersion,
    });
    expect(body.dimensionKeys.length).toBeGreaterThan(0);
    expect(String(key)).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByRole('heading', { name: t('listening:reviews.request.receipt.title') })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('listening:reviews.request.receipt.view') })).toHaveAttribute('href', '/listening/reviews/review_request_new');
  });

  it('links to the active request when the scope already has one, and renders a disabled entitlement', async () => {
    const user = userEvent.setup();
    const api = makeListeningApi({
      overview: vi.fn().mockResolvedValue({ ...SAMPLE_LISTENING_OVERVIEW, reviewOffer: null }),
      createReviewRequest: vi.fn().mockRejectedValue(apiError(409, 'active_request_exists', { requestId: 'review_request_sample_1' })),
    });
    renderWithProviders(<RequestReviewScreen listeningApi={api} sampleMode={false} />);
    await user.click(await screen.findByRole('checkbox', { name: TERMS }));
    await user.click(screen.getByRole('button', { name: t('listening:reviews.request.submit') }));
    expect(await screen.findByText(t('listening:reviews.request.active'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('listening:reviews.request.viewActive') })).toHaveAttribute('href', '/listening/reviews/review_request_sample_1');
    cleanup();

    renderWithProviders(
      <RequestReviewScreen listeningApi={makeListeningApi({ reviewServices: vi.fn().mockResolvedValue({ ...SAMPLE_REVIEW_SERVICES, workplaceReviewsEnabled: false }) })} sampleMode={false} />,
    );
    expect(await screen.findByText(t('listening:errors.workplace_reviews_disabled'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('listening:reviews.request.submit') })).not.toBeInTheDocument();
  });
});
