import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SAMPLE_REVIEW_ACTION_ID, SAMPLE_REVIEW_ENGAGEMENT, SAMPLE_REVIEW_ENGAGEMENT_ID, SAMPLE_REVIEW_ENGAGEMENT_PENDING, SAMPLE_REVIEW_GRANT_ID } from '@nestself/sample-data';
import { ORG_ID, actionsWithout, apiError, makeAuth, makeListeningApi, renderWithProviders, t } from '../listening/listening-test-harness';
import { EngagementScreen, formatInZone } from './engagement-screen';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PENDING_ID = SAMPLE_REVIEW_ENGAGEMENT_PENDING.id;

describe('formatInZone', () => {
  it('renders the instant in the requested zone and falls back on an unknown zone', () => {
    expect(formatInZone('2026-11-18T08:00:00.000Z', 'en', 'Europe/Belgrade')).toMatch(/9:00/);
    expect(formatInZone('2026-11-18T08:00:00.000Z', 'en', 'Not/AZone')).toMatch(/2026/);
  });
});

describe('EngagementScreen', () => {
  it('books a proposed window only after one is chosen, and renders slot_unavailable in translated copy', async () => {
    const user = userEvent.setup();
    const api = makeListeningApi({ engagement: vi.fn().mockResolvedValue(SAMPLE_REVIEW_ENGAGEMENT_PENDING) });
    renderWithProviders(<EngagementScreen listeningApi={api} sampleMode={false} engagementId={PENDING_ID} />);
    const book = await screen.findByRole('button', { name: t('listening:reviews.engagement.book') });
    expect(book).toBeDisabled();
    const meeting = screen.getByRole('region', { name: t('listening:reviews.engagement.meeting') });
    const radios = within(meeting).getAllByRole('radio');
    expect(radios).toHaveLength(2);
    await user.click(radios[1]!);
    expect(book).toBeEnabled();
    await user.click(book);
    await waitFor(() => expect(api.bookEngagement).toHaveBeenCalledWith(ORG_ID, PENDING_ID, { windowIndex: 1 }));
    expect(await screen.findByText(t('listening:reviews.engagement.booked'))).toBeInTheDocument();
    expect(screen.getByText(t('listening:reviews.engagement.reportNotShared'))).toBeInTheDocument();
    cleanup();

    const failing = makeListeningApi({
      engagement: vi.fn().mockResolvedValue(SAMPLE_REVIEW_ENGAGEMENT_PENDING),
      bookEngagement: vi.fn().mockRejectedValue(apiError(409, 'slot_unavailable')),
    });
    renderWithProviders(<EngagementScreen listeningApi={failing} sampleMode={false} engagementId={PENDING_ID} />);
    await screen.findByRole('button', { name: t('listening:reviews.engagement.book') });
    await user.click(within(screen.getByRole('region', { name: t('listening:reviews.engagement.meeting') })).getAllByRole('radio')[0]!);
    await user.click(screen.getByRole('button', { name: t('listening:reviews.engagement.book') }));
    expect(await screen.findByText(t('listening:errors.slot_unavailable'))).toBeInTheDocument();
  });

  it('renders the shared report, moves an agreed action forward and withdraws the sharing', async () => {
    const user = userEvent.setup();
    const api = makeListeningApi();
    renderWithProviders(<EngagementScreen listeningApi={api} sampleMode={false} engagementId={SAMPLE_REVIEW_ENGAGEMENT_ID} />);
    const report = await screen.findByTestId('review-report');
    expect(within(report).getByText(/Rota changes reach the engineering teams/)).toBeInTheDocument();
    expect(within(report).getByRole('heading', { name: t('listening:reviews.engagement.reportSection.proposals') })).toBeInTheDocument();
    expect(screen.getByText(t('listening:reviews.engagement.neverChanges'))).toBeInTheDocument();

    const row = screen.getByRole('row', { name: /Publish the rota two weeks ahead/ });
    expect(within(row).getByText(t('listening:reviews.status.action.agreed'))).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: t('listening:reviews.engagement.action.start') }));
    await waitFor(() => expect(api.updateEngagementAction).toHaveBeenCalledWith(ORG_ID, SAMPLE_REVIEW_ENGAGEMENT_ID, SAMPLE_REVIEW_ACTION_ID, { status: 'in_progress' }));

    await user.click(screen.getByRole('button', { name: t('listening:reviews.engagement.revoke') }));
    await waitFor(() => expect(api.revokeSharing).toHaveBeenCalledWith(ORG_ID, SAMPLE_REVIEW_ENGAGEMENT_ID, SAMPLE_REVIEW_GRANT_ID));
  });

  it('hides the action and sharing controls without the grants and renders a 404 as not found', async () => {
    renderWithProviders(
      <EngagementScreen listeningApi={makeListeningApi()} sampleMode={false} engagementId={SAMPLE_REVIEW_ENGAGEMENT_ID} />,
      makeAuth({ effectiveActions: actionsWithout('workplace_reviews.actions.manage', 'workplace_reviews.request') }),
    );
    await screen.findByTestId('review-report');
    expect(screen.queryByRole('button', { name: t('listening:reviews.engagement.action.start') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('listening:reviews.engagement.revoke') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('listening:reviews.engagement.cancel') })).not.toBeInTheDocument();
    expect(screen.getByText(SAMPLE_REVIEW_ENGAGEMENT.actions[0]!.title)).toBeInTheDocument();
    cleanup();

    renderWithProviders(
      <EngagementScreen listeningApi={makeListeningApi({ engagement: vi.fn().mockRejectedValue(apiError(404, 'not_found')) })} sampleMode={false} engagementId="nope" />,
    );
    expect(await screen.findByText(t('listening:errors.notFound'))).toBeInTheDocument();
  });
});
