import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SAMPLE_LISTENING_OVERVIEW } from '@nestself/sample-data';
import type { ListeningOverviewResponse } from '@nestself/contracts';
import { OverviewScreen } from './overview-screen';
import { actionsWithout, apiError, makeAuth, makeListeningApi, renderWithProviders, t } from './listening-test-harness';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('OverviewScreen', () => {
  it('shows five cards, keeps the red one visible among green ones, and labels every colour with text', async () => {
    renderWithProviders(<OverviewScreen listeningApi={makeListeningApi()} sampleMode={false} />);
    const workload = await screen.findByRole('article', { name: new RegExp(t('listening:dimensions.sustainable_workload.title')) });
    expect(within(workload).getByText('48.0%')).toBeInTheDocument();
    expect(within(workload).getByText(t('listening:status.danger'))).toBeInTheDocument();
    expect(within(workload).getByText(t('listening:overview.trendDown', { points: '-8.0' }))).toBeInTheDocument();
    const belonging = screen.getByRole('article', { name: new RegExp(t('listening:dimensions.belonging_respect.title')) });
    expect(within(belonging).getByText(t('listening:status.good'))).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(5);
    expect(screen.getByText(t('listening:overview.participation', { submitted: 131, audience: 160 }))).toBeInTheDocument();
  });

  it('shows the hidden label and no number for a suppressed dimension', async () => {
    const overview: ListeningOverviewResponse = structuredClone(SAMPLE_LISTENING_OVERVIEW);
    const card = overview.current!.dimensions[3]!;
    Object.assign(card, { scoreTenths: null, score: null, status: null, grayReason: 'privacy_suppressed', respondentCount: null, distribution: null, trend: { comparable: false, reason: 'suppressed' } });
    renderWithProviders(<OverviewScreen listeningApi={makeListeningApi({ overview: vi.fn().mockResolvedValue(overview) })} sampleMode={false} />);
    const speakingUp = await screen.findByRole('article', { name: new RegExp(t('listening:dimensions.speaking_up.title')) });
    expect(within(speakingUp).getAllByText(t('listening:status.privacy_suppressed')).length).toBeGreaterThan(0);
    expect(within(speakingUp).queryByText(/%/)).not.toBeInTheDocument();
    expect(within(speakingUp).getByText(t('listening:overview.trendSuppressed'))).toBeInTheDocument();
  });

  it('a stale result shows the stale alert and no review invitation', async () => {
    const overview: ListeningOverviewResponse = structuredClone(SAMPLE_LISTENING_OVERVIEW);
    overview.current!.stale = true;
    overview.reviewOffer = { ...overview.reviewOffer!, eligible: false };
    renderWithProviders(<OverviewScreen listeningApi={makeListeningApi({ overview: vi.fn().mockResolvedValue(overview) })} sampleMode={false} />);
    expect(await screen.findByText(t('listening:overview.stale', { days: 45 }))).toBeInTheDocument();
    expect(screen.queryByText(t('listening:offer.action'))).not.toBeInTheDocument();
    expect(screen.getAllByText(t('listening:status.stale')).length).toBeGreaterThan(0);
  });

  it('the offer names the red dimension and its score, dismissing it keeps the red card', async () => {
    const user = userEvent.setup();
    const dismissOffer = vi.fn().mockResolvedValue({ dismissed: true });
    const dismissed: ListeningOverviewResponse = structuredClone(SAMPLE_LISTENING_OVERVIEW);
    dismissed.reviewOffer = { ...dismissed.reviewOffer!, eligible: false, dismissed: true };
    const overview = vi.fn().mockResolvedValueOnce(SAMPLE_LISTENING_OVERVIEW).mockResolvedValue(dismissed);
    renderWithProviders(<OverviewScreen listeningApi={makeListeningApi({ overview, dismissOffer })} sampleMode={false} />);
    expect(await screen.findByRole('heading', { name: t('listening:offer.title', { dimension: t('listening:dimensions.sustainable_workload.title') }) })).toBeInTheDocument();
    expect(screen.getByText(t('listening:offer.body', { score: '48.0' }))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('listening:offer.action') })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('listening:offer.dismiss') }));
    await waitFor(() => expect(dismissOffer).toHaveBeenCalledWith('org_sample', { snapshotId: SAMPLE_LISTENING_OVERVIEW.current!.snapshotId }));
    expect(await screen.findByText(t('listening:offer.dismissed'))).toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: new RegExp(t('listening:dimensions.sustainable_workload.title')) })).getByText(t('listening:status.danger'))).toBeInTheDocument();
  });

  it('hides the offer and the export for a viewer without those grants', async () => {
    renderWithProviders(
      <OverviewScreen listeningApi={makeListeningApi()} sampleMode={false} />,
      makeAuth({ effectiveActions: actionsWithout('workplace_reviews.request', 'listening.reports.export') }),
    );
    await screen.findAllByRole('article');
    expect(screen.queryByRole('link', { name: t('listening:offer.action') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('listening:export.action') })).not.toBeInTheDocument();
  });

  it('renders the collecting state and the empty state', async () => {
    const collecting: ListeningOverviewResponse = { ...SAMPLE_LISTENING_OVERVIEW, current: null, reviewOffer: null, history: [] };
    renderWithProviders(<OverviewScreen listeningApi={makeListeningApi({ overview: vi.fn().mockResolvedValue(collecting) })} sampleMode={false} />);
    expect(await screen.findByText(t('listening:overview.collecting'))).toBeInTheDocument();
    expect(screen.getByText(t('listening:overview.noResults'))).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('renders translated copy for a permission failure and never the English message', async () => {
    renderWithProviders(<OverviewScreen listeningApi={makeListeningApi({ overview: vi.fn().mockRejectedValue(apiError(403, 'forbidden')) })} sampleMode={false} />);
    expect(await screen.findByText(t('listening:errors.forbidden'))).toBeInTheDocument();
    expect(screen.queryByText('English forbidden')).not.toBeInTheDocument();
  });
});
