/**
 * The outcome dialog (CALL-23) in API mode: the five delivery statuses and
 * nothing else, a required choice, `recordOutcome` on submit and a visible
 * message when the API refuses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { ApiError } from '@nestself/api-client';
import { CALL_OUTCOME_STATUSES } from '@nestself/contracts';
import calls from '@nestself/i18n/locales/en/calls.json';
import i18n from '../i18n';

vi.mock('../data-source', () => ({ dataSource: 'api', isSampleDataMode: false, resolveDataSource: () => 'api' }));

const recordOutcome = vi.hoisted(() => vi.fn());
vi.mock('./calls-api', () => ({ callsApi: { recordOutcome } }));

import { OutcomeDialog } from './outcome-dialog';

const APPOINTMENT = {
  id: 'appt_1',
  orgId: 'org_sample',
  expertUserId: 'user_milica',
  employeeUserId: 'user_jovan',
  startsAt: '2026-10-25T09:00:00.000Z',
  endsAt: '2026-10-25T09:50:00.000Z',
  status: 'completed',
  serviceCategory: 'psychological',
  timeZone: 'Europe/Belgrade',
  fundingRef: null,
  followUpOf: null,
};

function renderDialog() {
  const onRecorded = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nextProvider i18n={i18n}>
        <OutcomeDialog appointmentId="appt_1" open onOpenChange={onOpenChange} onRecorded={onRecorded} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { onRecorded, onOpenChange };
}

describe('OutcomeDialog', () => {
  beforeEach(async () => {
    recordOutcome.mockReset();
    await i18n.changeLanguage('en');
  });
  afterEach(() => vi.clearAllMocks());

  it('offers exactly the five delivery statuses and no free text', async () => {
    renderDialog();
    const dialog = await screen.findByRole('dialog', { name: calls.outcome.title });
    const radios = await screen.findAllByRole('radio');
    expect(radios.map((radio) => radio.closest('label')?.textContent)).toEqual(CALL_OUTCOME_STATUSES.map((status) => calls.outcome.status[status]));
    expect(dialog.querySelector('textarea, input[type="text"]')).toBeNull();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('requires a choice before saving', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByRole('button', { name: calls.outcome.submit }));
    expect((await screen.findAllByText(calls.outcome.required)).length).toBeGreaterThan(0);
    expect(recordOutcome).not.toHaveBeenCalled();
  });

  it('submits the chosen status through recordOutcome', async () => {
    recordOutcome.mockResolvedValue(APPOINTMENT);
    const user = userEvent.setup();
    const { onRecorded, onOpenChange } = renderDialog();
    await user.click(await screen.findByRole('radio', { name: calls.outcome.status.completed }));
    await user.click(screen.getByRole('button', { name: calls.outcome.submit }));

    await waitFor(() => expect(recordOutcome).toHaveBeenCalledWith('appt_1', { status: 'completed' }));
    expect(onRecorded).toHaveBeenCalledWith('completed', APPOINTMENT);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders the translated API error and stays open', async () => {
    recordOutcome.mockRejectedValue(new ApiError({ status: 409, code: 'appointment_not_joinable', message: 'English', requestId: null }));
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();
    await user.click(await screen.findByRole('radio', { name: calls.outcome.status.no_show_employee }));
    await user.click(screen.getByRole('button', { name: calls.outcome.submit }));

    expect((await screen.findAllByText(calls.errors.appointmentNotJoinable)).length).toBeGreaterThan(0);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
