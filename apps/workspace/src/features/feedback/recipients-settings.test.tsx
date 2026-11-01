import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OrgAdminApi } from '@nestself/api-client';
import { apiError, makeAuth, makeListeningApi, renderWithProviders, t } from '../listening/listening-test-harness';
import { RecipientsSettings } from './recipients-settings';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeAdminApi(): OrgAdminApi {
  return {
    listMembers: vi.fn().mockResolvedValue({
      items: [
        { userId: 'user_stefan', displayName: 'Stefan Marković' },
        { userId: 'user_ivana', displayName: 'Ivana Jovanović' },
        { userId: 'user_ana', displayName: 'Ana Nikolić' },
      ],
      nextCursor: null,
    }),
  } as unknown as OrgAdminApi;
}

async function choose(user: ReturnType<typeof userEvent.setup>, combobox: HTMLElement, option: string) {
  await user.click(combobox);
  await user.click(await screen.findByRole('option', { name: option }));
}

describe('RecipientsSettings', () => {
  it('shows the current recipients, explains the sensitive gate and refuses the same person twice before calling the API', async () => {
    const user = userEvent.setup();
    const api = makeListeningApi();
    renderWithProviders(<RecipientsSettings listeningApi={api} adminApi={makeAdminApi()} sampleMode={false} />, makeAuth());
    const standard = (await screen.findByRole('heading', { name: t('listening:feedback.recipients.standard') })).closest('form')!;
    expect(within(standard).getByText(t('listening:settings.enabled'))).toBeInTheDocument();
    expect(screen.getByText(t('listening:feedback.recipients.sensitiveGate'))).toBeInTheDocument();
    expect(screen.getByText(t('listening:feedback.recipients.sensitiveLocked'))).toBeInTheDocument();

    const alternate = within(standard).getByRole('combobox', { name: new RegExp(`^${t('listening:feedback.recipients.alternate')}`) });
    await choose(user, alternate, 'Stefan Marković');
    await user.click(within(standard).getByRole('button', { name: t('listening:feedback.recipients.save') }));
    expect(await screen.findByText(t('common:form.errorSummaryTitle'))).toBeInTheDocument();
    expect(screen.getAllByText(t('listening:errors.same_handler')).length).toBeGreaterThan(0);
    expect(api.updateOrgFeedbackRoutes).not.toHaveBeenCalled();
  });

  it('saves the standard route and renders handler_not_eligible from the server', async () => {
    const user = userEvent.setup();
    const api = makeListeningApi({ updateOrgFeedbackRoutes: vi.fn().mockRejectedValue(apiError(409, 'handler_not_eligible', { handler: 'alternate' })) });
    renderWithProviders(<RecipientsSettings listeningApi={api} adminApi={makeAdminApi()} sampleMode={false} />, makeAuth());
    const standard = (await screen.findByRole('heading', { name: t('listening:feedback.recipients.standard') })).closest('form')!;
    const alternate = within(standard).getByRole('combobox', { name: new RegExp(`^${t('listening:feedback.recipients.alternate')}`) });
    await choose(user, alternate, 'Ana Nikolić');
    await user.click(within(standard).getByRole('button', { name: t('listening:feedback.recipients.save') }));
    await waitFor(() => expect(api.updateOrgFeedbackRoutes).toHaveBeenCalledTimes(1));
    const [orgId, body] = (api.updateOrgFeedbackRoutes as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(orgId).toBe('org_sample');
    expect(body.routes[0]).toMatchObject({ kind: 'standard', primaryHandlerUserId: 'user_stefan', alternateHandlerUserId: 'user_ana', enabled: true, responseTargetHours: 72 });
    expect(await screen.findByText(t('listening:errors.handler_not_eligible'))).toBeInTheDocument();
  });

  it('is read-only in sample mode', async () => {
    renderWithProviders(<RecipientsSettings listeningApi={makeListeningApi()} adminApi={makeAdminApi()} sampleMode />, makeAuth());
    const standard = (await screen.findByRole('heading', { name: t('listening:feedback.recipients.standard') })).closest('form')!;
    expect(within(standard).getByRole('button', { name: t('listening:feedback.recipients.save') })).toBeDisabled();
  });
});
