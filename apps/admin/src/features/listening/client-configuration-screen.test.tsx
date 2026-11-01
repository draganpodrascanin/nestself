import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SAMPLE_LISTENING_CONFIGURATION } from '@nestself/sample-data';
import type { ListeningApi } from '@nestself/api-client';
import { ClientConfigurationScreen, fromDateInput, percentToTenths, tenthsToPercent, toDateInput } from './client-configuration-screen';
import { ORG_ID, apiError, choose, makeListeningApi, renderListeningOps, startsWith, t } from './listening-ops-test-harness';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const screenFor =
  (orgId = ORG_ID) =>
  (api: ListeningApi, sample: boolean) => <ClientConfigurationScreen listeningApi={api} orgId={orgId} sampleMode={sample} />;

describe('form helpers', () => {
  it('convert dates and percentages', () => {
    expect(toDateInput('2026-01-01T00:00:00.000Z')).toBe('2026-01-01');
    expect(toDateInput(null)).toBe('');
    expect(fromDateInput('2026-03-05')).toBe('2026-03-05T00:00:00.000Z');
    expect(fromDateInput('')).toBeNull();
    expect(tenthsToPercent(750)).toBe('75.0');
    expect(percentToTenths('75')).toBe(750);
    expect(percentToTenths('59.9')).toBe(599);
    expect(percentToTenths('101')).toBeNull();
    expect(percentToTenths('abc')).toBeNull();
  });
});

describe('ClientConfigurationScreen', () => {
  it('shows the current rules, the capability state and the policy version', async () => {
    renderListeningOps(screenFor());
    expect(await screen.findByLabelText(startsWith(t('listening:clientConfig.minimumCohort')))).toHaveValue(10);
    expect(screen.getByLabelText(startsWith(t('listening:clientConfig.goodThreshold')))).toHaveValue('75.0');
    expect(screen.getAllByText(t('listening:settings.enabled'))).toHaveLength(3);
    expect(screen.getByText(startsWith(t('listening:clientConfig.state', { version: 1, date: '' }).split(',')[0]!))).toBeInTheDocument();
  });

  it('refuses a minimum cohort below the platform floor with a field message and a summary', async () => {
    const user = userEvent.setup();
    const { listeningApi } = renderListeningOps(screenFor());
    const minimum = await screen.findByLabelText(startsWith(t('listening:clientConfig.minimumCohort')));
    await user.clear(minimum);
    await user.type(minimum, '9');
    await user.click(screen.getByRole('button', { name: t('listening:clientConfig.save') }));
    expect(await screen.findByText(t('listening:clientConfig.errorsTitle'))).toBeInTheDocument();
    // The summary links to the field by its label; the message sits under the field itself.
    expect(screen.getByRole('link', { name: t('listening:clientConfig.minimumCohort') })).toHaveAttribute('href', expect.stringMatching(/^#/));
    expect(screen.getByText(t('listening:clientConfig.errors.minimumCohort', { min: 10 }))).toBeInTheDocument();
    expect(listeningApi.updateOpsConfiguration).not.toHaveBeenCalled();
  });

  it('sends only the changed fields and reports the new rules version', async () => {
    const user = userEvent.setup();
    const { listeningApi } = renderListeningOps(screenFor());
    const cadence = await screen.findByLabelText(startsWith(t('listening:clientConfig.cadence')));
    await user.clear(cadence);
    await user.type(cadence, '28');
    const monitor = screen.getByLabelText(startsWith(t('listening:clientConfig.monitorThreshold')));
    await user.clear(monitor);
    await user.type(monitor, '62.5');
    await user.click(screen.getByRole('switch', { name: t('listening:clientConfig.sensitive') }));
    await user.click(screen.getByRole('button', { name: t('listening:clientConfig.save') }));
    await waitFor(() =>
      expect(listeningApi.updateOpsConfiguration).toHaveBeenCalledWith(ORG_ID, { cadenceDays: 28, monitorThresholdTenths: 625, feedbackSensitiveEnabled: true }),
    );
    expect(await screen.findByText(t('listening:clientConfig.saved', { version: 2 }))).toBeInTheDocument();
  });

  it('refuses Monitor at or above Good and a window longer than the cadence', async () => {
    const user = userEvent.setup();
    const { listeningApi } = renderListeningOps(screenFor());
    const monitor = await screen.findByLabelText(startsWith(t('listening:clientConfig.monitorThreshold')));
    await user.clear(monitor);
    await user.type(monitor, '80');
    const window = screen.getByLabelText(startsWith(t('listening:clientConfig.window')));
    await user.clear(window);
    await user.type(window, '20');
    await user.click(screen.getByRole('button', { name: t('listening:clientConfig.save') }));
    expect(await screen.findByText(t('listening:clientConfig.errorsTitle'))).toBeInTheDocument();
    expect(screen.getAllByText(t('listening:clientConfig.errors.thresholds')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t('listening:clientConfig.errors.window')).length).toBeGreaterThan(0);
    expect(listeningApi.updateOpsConfiguration).not.toHaveBeenCalled();
  });

  it('assigns a published questionnaire version and says when nothing changed', async () => {
    const user = userEvent.setup();
    const { listeningApi } = renderListeningOps(screenFor());
    await screen.findByLabelText(startsWith(t('listening:clientConfig.minimumCohort')));
    await user.click(screen.getByRole('button', { name: t('listening:clientConfig.save') }));
    expect(await screen.findByText(t('listening:clientConfig.nothingChanged'))).toBeInTheDocument();
    await choose(user, t('listening:clientConfig.questionnaire'), t('listening:clientConfig.questionnaireNone'));
    await user.click(screen.getByRole('button', { name: t('listening:clientConfig.save') }));
    await waitFor(() => expect(listeningApi.updateOpsConfiguration).toHaveBeenCalledWith(ORG_ID, { questionnaireVersionId: null }));
  });

  it('renders a refused save and a failed load in translated copy', async () => {
    const user = userEvent.setup();
    renderListeningOps(screenFor(), { listeningApi: makeListeningApi({ updateOpsConfiguration: vi.fn().mockRejectedValue(apiError(403, 'forbidden')) }) });
    const cadence = await screen.findByLabelText(startsWith(t('listening:clientConfig.cadence')));
    await user.clear(cadence);
    await user.type(cadence, '21');
    await user.click(screen.getByRole('button', { name: t('listening:clientConfig.save') }));
    expect(await screen.findByText(t('listening:errors.forbidden'))).toBeInTheDocument();
    expect(screen.queryByText('English forbidden')).not.toBeInTheDocument();
    cleanup();

    renderListeningOps(screenFor(), { listeningApi: makeListeningApi({ opsConfiguration: vi.fn().mockRejectedValue(apiError(404, 'not_found')) }) });
    expect(await screen.findByText(t('listening:errors.notFound'))).toBeInTheDocument();
  });

  it('is read-only in sample mode', async () => {
    renderListeningOps(screenFor(), { sampleMode: true });
    expect(await screen.findByText(t('listening:clientConfig.sampleNote'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('listening:clientConfig.save') })).toBeDisabled();
    expect(screen.getByLabelText(startsWith(t('listening:clientConfig.minimumCohort')))).toHaveValue(SAMPLE_LISTENING_CONFIGURATION.minimumCohort);
  });
});
