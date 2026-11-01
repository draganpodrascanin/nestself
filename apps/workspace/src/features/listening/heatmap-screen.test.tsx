import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { HeatmapScreen } from './heatmap-screen';
import { apiError, makeListeningApi, renderWithProviders, t } from './listening-test-harness';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('HeatmapScreen', () => {
  it('lays out cohorts as rows and dimensions as columns with values and text statuses', async () => {
    renderWithProviders(<HeatmapScreen listeningApi={makeListeningApi()} sampleMode={false} />);
    const table = await screen.findByRole('table', { name: t('listening:heatmap.title') });
    expect(within(table).getByRole('columnheader', { name: t('listening:dimensions.sustainable_workload.short') })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: t('listening:heatmap.company') })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'Engineering' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'Commercial' })).toBeInTheDocument();
    expect(within(table).getAllByText('45.5%')).toHaveLength(1);
  });

  it('a suppressed cell shows a neutral placeholder with an accessible name and no number', async () => {
    renderWithProviders(<HeatmapScreen listeningApi={makeListeningApi()} sampleMode={false} />);
    const label = t('listening:heatmap.cellLabel', {
      dimension: t('listening:dimensions.speaking_up.title'),
      cohort: 'Commercial',
      value: t('listening:status.insufficient_responses'),
    });
    const cell = await screen.findByLabelText(label);
    expect(cell.tagName).toBe('A');
    expect(cell).toHaveAttribute('href', '/listening/dimensions/speaking_up');
    expect(within(cell).getByText(t('listening:heatmap.hidden'))).toBeInTheDocument();
    expect(within(cell).getByText(t('listening:status.insufficient_responses'))).toBeInTheDocument();
    expect(within(cell).queryByText(/%/)).not.toBeInTheDocument();
  });

  it('shows the fixed-band legend and renders an empty state for an unknown snapshot', async () => {
    renderWithProviders(<HeatmapScreen listeningApi={makeListeningApi()} sampleMode={false} />);
    expect(await screen.findByText(t('listening:heatmap.legendBody'))).toBeInTheDocument();
    cleanup();
    renderWithProviders(<HeatmapScreen listeningApi={makeListeningApi({ heatmap: vi.fn().mockRejectedValue(apiError(404, 'not_found')) })} sampleMode={false} snapshotId="nope" />);
    expect(await screen.findByText(t('listening:heatmap.empty'))).toBeInTheDocument();
  });
});
