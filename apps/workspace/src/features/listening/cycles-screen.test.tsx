import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CyclesScreen, closePreview } from './cycles-screen';
import { apiError, makeListeningApi, renderWithProviders, t } from './listening-test-harness';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('closePreview', () => {
  it('adds the response window and formats in the organization zone', () => {
    expect(closePreview('2026-11-10T07:00:00.000Z', 7, 'Europe/Belgrade', 'en')).toMatch(/17 Nov 2026, 08:00/);
    expect(closePreview('not a date', 7, 'Europe/Belgrade', 'en')).toBeNull();
  });
});

describe('CyclesScreen', () => {
  it('lists cycles with their states and the safe audience total, never names', async () => {
    renderWithProviders(<CyclesScreen listeningApi={makeListeningApi()} sampleMode={false} />);
    expect(await screen.findByText(t('listening:cycles.status.open'))).toBeInTheDocument();
    expect(screen.getAllByText(t('listening:cycles.status.published'))).toHaveLength(2);
    expect(screen.getByText(t('listening:cycles.audience', { count: 164 }))).toBeInTheDocument();
    expect(screen.getByText(t('listening:cycles.cadence', { days: 14 }))).toBeInTheDocument();
    expect(screen.queryByText(/Jovan|Ana|@example/)).not.toBeInTheDocument();
  });

  it('schedules a cycle with an organization-time preview of the close', async () => {
    const user = userEvent.setup();
    const api = makeListeningApi();
    renderWithProviders(<CyclesScreen listeningApi={api} sampleMode={false} />);
    await user.click(await screen.findByRole('button', { name: t('listening:cycles.schedule') }));
    const input = await screen.findByLabelText(new RegExp(t('listening:cycles.opensAt')));
    await user.type(input, '2026-11-10T08:00');
    const expectedClose = closePreview(new Date('2026-11-10T08:00').toISOString(), 7, 'Europe/Belgrade', 'en')!;
    expect(await screen.findByText(t('listening:cycles.closesPreview', { date: expectedClose, zone: 'Europe/Belgrade' }))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('listening:cycles.scheduleAction') }));
    await waitFor(() => expect(api.scheduleCycle).toHaveBeenCalledWith('org_sample', { opensAt: new Date('2026-11-10T08:00').toISOString() }));
  });

  it('shows the overlap error inside the dialog', async () => {
    const user = userEvent.setup();
    const api = makeListeningApi({ scheduleCycle: vi.fn().mockRejectedValue(apiError(409, 'cycle_overlap')) });
    renderWithProviders(<CyclesScreen listeningApi={api} sampleMode={false} />);
    await user.click(await screen.findByRole('button', { name: t('listening:cycles.schedule') }));
    await user.type(await screen.findByLabelText(new RegExp(t('listening:cycles.opensAt'))), '2026-11-10T08:00');
    await user.click(screen.getByRole('button', { name: t('listening:cycles.scheduleAction') }));
    expect(await screen.findByText(t('listening:errors.cycle_overlap'))).toBeInTheDocument();
  });

  it('cancels an open cycle after confirmation', async () => {
    const user = userEvent.setup();
    const api = makeListeningApi();
    renderWithProviders(<CyclesScreen listeningApi={api} sampleMode={false} />);
    await user.click(await screen.findByRole('button', { name: t('listening:cycles.cancel') }));
    expect(await screen.findByText(t('listening:cycles.cancelBody'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('listening:cycles.cancelConfirm') }));
    await waitFor(() => expect(api.cancelCycle).toHaveBeenCalledWith('org_sample', 'cycle_sample_2026_11'));
  });

  it('disables scheduling and cancelling in sample mode', async () => {
    renderWithProviders(<CyclesScreen listeningApi={makeListeningApi()} sampleMode />);
    expect(await screen.findByText(t('listening:cycles.sampleNote'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('listening:cycles.schedule') })).toBeDisabled();
    expect(screen.queryByRole('button', { name: t('listening:cycles.cancel') })).not.toBeInTheDocument();
  });
});
