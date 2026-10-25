/**
 * Appointment list, detail and call routes in sample mode (CW-R-56): the
 * fixtures render with the sample banner, a proposed follow-up carries its
 * badge and card, and nothing is sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SAMPLE_PRINCIPALS } from '@nestself/sample-data';
import calls from '@nestself/i18n/locales/en/calls.json';
import common from '@nestself/i18n/locales/en/common.json';
import { routeTree } from '../../../routeTree.gen';

/** 25 October 2026, 10:00 in Belgrade: before every upcoming sample appointment. */
const NOW = new Date('2026-10-25T09:00:00.000Z');

function renderAt(path: string, role: keyof typeof SAMPLE_PRINCIPALS = 'employee') {
  window.history.replaceState(null, '', `/?role=${role}`);
  const sample = SAMPLE_PRINCIPALS[role];
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    context: { queryClient, auth: { principal: sample.principal, effectiveActions: sample.effectiveActions } },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('appointments in sample mode', { timeout: 20_000 }, () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.history.replaceState(null, '', '/');
  });

  it('lists the sample appointments with the banner and a follow-up badge on the proposal', async () => {
    renderAt('/appointments');

    expect(await screen.findByRole('heading', { name: common.nav.appointments, level: 1 })).toBeInTheDocument();
    expect(screen.getByText(common.sample.banner)).toBeInTheDocument();

    const upcoming = screen.getByRole('region', { name: calls.appointments.upcoming });
    const rows = within(upcoming).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    // Soonest first: the proposal on 4 November leads.
    expect(within(rows[0]!).getByText(calls.followUp.proposed)).toBeInTheDocument();
    expect(within(rows[0]!).getByRole('link')).toHaveAttribute('href', '/appointments/appt_sample_follow_up_proposed');

    const past = screen.getByRole('region', { name: calls.appointments.past });
    expect(within(past).getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows an empty state to someone without appointments', async () => {
    renderAt('/appointments', 'manager');
    expect(await screen.findByText(common.state.empty.title)).toBeInTheDocument();
  });

  it('renders the badge and the follow-up card on a proposed appointment, and sends nothing', async () => {
    const user = userEvent.setup();
    renderAt('/appointments/appt_sample_follow_up_proposed');

    expect(await screen.findByRole('heading', { name: calls.followUp.employeeTitle })).toBeInTheDocument();
    expect(screen.getAllByText(calls.followUp.proposed).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: calls.followUp.confirm }));
    expect(await screen.findByText(calls.sample.actionNoop)).toBeInTheDocument();
  });

  it('disables joining before the window and says when to come back', async () => {
    renderAt('/appointments/appt_sample_upcoming');

    const join = await screen.findByRole('button', { name: /^Come back at / });
    expect(join).toBeDisabled();
    // 18 November, 17:00 in Belgrade: the window opens 15 minutes before.
    expect(join).toHaveTextContent('Come back at 16:45');
    expect(screen.getByRole('link', { name: calls.join.sampleDemo })).toHaveAttribute('href', '/call/appt_sample_upcoming');
  });

  it('runs the sample call with the fake controller and shows the post-call screen', async () => {
    const user = userEvent.setup();
    renderAt('/call/appt_sample_upcoming');

    expect(await screen.findByText(calls.call.sampleNotice)).toBeInTheDocument();
    expect(screen.getByText(common.sample.banner)).toBeInTheDocument();
    // Psychological consultation: the optional location prompt is offered.
    expect(screen.getByRole('textbox', { name: new RegExp(calls.location.label) })).toBeInTheDocument();

    const join = screen.getByRole('button', { name: calls.prejoin.joinNow });
    await waitFor(() => expect(join).toBeEnabled());
    await user.click(join);

    expect(await screen.findByText('Milica will join shortly', {}, { timeout: 5000 })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: calls.consultation.leave }));
    expect(await screen.findByRole('heading', { name: calls.postCall.left }, { timeout: 5000 })).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: '5 of 5' }));
    await user.click(screen.getByRole('button', { name: calls.feedback.submit }));
    expect(await screen.findByText(calls.sample.actionNoop)).toBeInTheDocument();
  });

  it('shows the permission state to a role without consultation.join', async () => {
    const router = renderAt('/appointments', 'operations');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});
