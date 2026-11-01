import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { SAMPLE_ORG, SAMPLE_REVIEW_REQUEST_ID } from '@nestself/sample-data';
import { apiError, makeListeningApi, renderListeningOps, t } from '../listening/listening-ops-test-harness';
import { QueueScreen } from './queue-screen';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('QueueScreen', () => {
  it('lists requests with organization, status, owner and response target, flagging overdue and unassigned ones', async () => {
    renderListeningOps((api, sample) => <QueueScreen listeningApi={api} sampleMode={sample} />);
    const links = await screen.findAllByRole('link', { name: SAMPLE_ORG.name });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '/workplace-reviews/review_request_sample_3');
    expect(links[1]).toHaveAttribute('href', `/workplace-reviews/${SAMPLE_REVIEW_REQUEST_ID}`);

    const fresh = links[0]!.closest('tr')!;
    expect(within(fresh).getByText(t('listening:reviews.status.request.submitted'))).toBeInTheDocument();
    expect(within(fresh).getByText(t('listening:reviewOps.queue.overdue'))).toBeInTheDocument();
    expect(within(fresh).getByText(t('listening:reviewOps.queue.unassigned'))).toBeInTheDocument();
    expect(within(fresh).getByText('Ivana')).toBeInTheDocument();

    const converted = links[1]!.closest('tr')!;
    expect(within(converted).getByText(t('listening:reviews.status.request.converted'))).toBeInTheDocument();
    expect(within(converted).queryByText(t('listening:reviewOps.queue.overdue'))).not.toBeInTheDocument();
    expect(within(converted).queryByText(t('listening:reviewOps.queue.unassigned'))).not.toBeInTheDocument();
    expect(within(converted).getByText('Nikola')).toBeInTheDocument();
    expect(screen.getByText(t('listening:reviewOps.queue.lead'))).toBeInTheDocument();
  });

  it('shows the empty state and renders a failed load', async () => {
    renderListeningOps((api, sample) => <QueueScreen listeningApi={api} sampleMode={sample} />, {
      listeningApi: makeListeningApi({ reviewQueue: vi.fn().mockResolvedValue({ items: [] }) }),
    });
    expect(await screen.findByText(t('listening:reviewOps.queue.empty'))).toBeInTheDocument();
    cleanup();

    renderListeningOps((api, sample) => <QueueScreen listeningApi={api} sampleMode={sample} />, {
      listeningApi: makeListeningApi({ reviewQueue: vi.fn().mockRejectedValue(apiError(403, 'forbidden')) }),
    });
    expect(await screen.findByText(t('listening:errors.forbidden'))).toBeInTheDocument();
  });
});
