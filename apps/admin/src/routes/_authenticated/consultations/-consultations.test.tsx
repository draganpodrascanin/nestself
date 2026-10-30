/**
 * Admin consultations in sample mode (CALL-18, CALL-21, CALL-23, D-CW-37):
 * the expert's list with the outcome column, the operations view without
 * links, and the expert's call ending in the outcome dialog and the
 * follow-up card. Nothing is sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';
import { SAMPLE_PRINCIPALS } from '@nestself/sample-data';
import calls from '@nestself/i18n/locales/en/calls.json';
import common from '@nestself/i18n/locales/en/common.json';
import { routeTree } from '../../../routeTree.gen';
import { PHONE_QUERY } from '../../../calls/use-media-query';
import i18n from '../../../i18n';

/** 25 October 2026, 10:00 in Belgrade: before every upcoming sample appointment. */
const NOW = new Date('2026-10-25T09:00:00.000Z');

function renderAt(path: string, role: keyof typeof SAMPLE_PRINCIPALS) {
  window.history.replaceState(null, '', `/?role=${role}`);
  const sample = SAMPLE_PRINCIPALS[role];
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }), auth: { principal: sample.principal, effectiveActions: sample.effectiveActions } },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe('admin consultations (sample mode)', { timeout: 20_000 }, () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    await i18n.changeLanguage('en');
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.history.replaceState(null, '', '/');
  });

  it("lists the expert's consultations upcoming first, then past, with employee, status and outcome (CALL-18)", async () => {
    renderAt('/consultations', 'expert');

    expect(await screen.findByRole('heading', { name: calls.consultations.title, level: 1 })).toBeInTheDocument();
    expect(screen.getByText(common.sample.banner)).toBeInTheDocument();
    const upcoming = within(screen.getByRole('table', { name: calls.consultations.upcoming })).getAllByRole('row').slice(1);
    const past = within(screen.getByRole('table', { name: calls.consultations.past })).getAllByRole('row').slice(1);
    // Upcoming soonest first: the proposal of 4 November leads; past latest first.
    expect(upcoming).toHaveLength(3);
    expect(within(upcoming[0]!).getByRole('link', { name: 'Jovan' })).toHaveAttribute('href', '/consultations/appt_sample_follow_up_proposed');
    expect(past).toHaveLength(2);
    expect(within(past[0]!).getByText(calls.consultations.outcomeColumn.canceled)).toBeInTheDocument();
    expect(within(past[1]!).getByRole('link', { name: 'Jovan' })).toHaveAttribute('href', '/consultations/appt_sample_completed');
    expect(within(past[1]!).getByText(calls.consultations.outcomeColumn.completed)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: calls.consultations.nav }).length).toBeGreaterThan(0);
  });

  it('at 390 px lists each consultation as a card with the employee, status and time first, and no table to scroll', async () => {
    const original = window.matchMedia;
    // A 390 px viewport: only the phone query matches.
    window.matchMedia = ((query: string) => ({ ...original(query), matches: query === PHONE_QUERY })) as typeof window.matchMedia;
    try {
      renderAt('/consultations', 'expert');
      const upcoming = await screen.findByRole('list', { name: calls.consultations.upcoming });
      expect(upcoming).toHaveAttribute('data-layout', 'cards');
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      const cards = within(upcoming).getAllByRole('listitem');
      expect(cards).toHaveLength(3);
      expect(within(cards[0]!).getByRole('link', { name: 'Jovan' })).toHaveAttribute('href', '/consultations/appt_sample_follow_up_proposed');
      expect(within(cards[0]!).getByText(calls.appointments.status.proposed)).toBeInTheDocument();
      expect(within(cards[0]!).getAllByRole('term').map((term) => term.textContent)).toEqual([
        calls.consultations.columns.time,
        calls.consultations.columns.outcome,
        calls.consultations.columns.service,
      ]);
      const past = within(screen.getByRole('list', { name: calls.consultations.past })).getAllByRole('listitem');
      expect(within(past[1]!).getByText(calls.consultations.outcomeColumn.completed)).toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });

  it('shows operations every consultation with expert and organisation, filters and a read-only view (CALL-28)', async () => {
    const user = userEvent.setup();
    renderAt('/consultations', 'operations');

    expect(await screen.findByText(calls.consultations.operationsNote)).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: calls.consultations.columns.expert })).toBeInTheDocument();
    expect(within(table).getAllByText('Example d.o.o.').length).toBe(5);
    expect(within(table).getAllByRole('link', { name: calls.consultations.view })).toHaveLength(5);

    await user.click(within(table).getAllByRole('link', { name: calls.consultations.view })[0]!);
    expect(await screen.findByText(calls.consultations.readOnly)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: calls.join.button })).not.toBeInTheDocument();
  });

  it('filters the operations list by status and date', async () => {
    const user = userEvent.setup();
    renderAt('/consultations', 'operations');
    await screen.findByRole('table');

    await user.type(screen.getByLabelText(calls.consultations.filters.from), '2026-11-01');
    await user.click(screen.getByRole('button', { name: calls.consultations.filters.apply }));
    await waitFor(() => expect(within(screen.getByRole('table')).getAllByRole('row').slice(1)).toHaveLength(3));

    await user.click(screen.getByRole('button', { name: calls.consultations.filters.clear }));
    await waitFor(() => expect(within(screen.getByRole('table')).getAllByRole('row').slice(1)).toHaveLength(5));
  });

  it('keeps the employee out of the admin consultations', async () => {
    renderAt('/consultations', 'employee');
    expect(await screen.findByText(common.state.permission.title)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('offers the follow-up proposal on a completed consultation and sends nothing', async () => {
    const user = userEvent.setup();
    renderAt('/consultations/appt_sample_completed', 'expert');

    expect(await screen.findByRole('heading', { name: calls.followUp.expertTitle })).toBeInTheDocument();
    expect(screen.getByText(calls.consultations.you.replace('{{name}}', 'Milica'))).toBeInTheDocument();
    await user.type(screen.getByLabelText(calls.followUp.date), '2026-11-20');
    await user.type(screen.getByLabelText(calls.followUp.time), '10:00');
    await user.click(screen.getByRole('button', { name: calls.followUp.send }));
    expect(await screen.findByText(calls.sample.actionNoop)).toBeInTheDocument();
  });

  it('runs the sample call, ends it for everyone and records the outcome', async () => {
    const user = userEvent.setup();
    renderAt('/consultations/appt_sample_upcoming', 'expert');

    const comeBack = await screen.findByRole('button', { name: /^Come back at / });
    expect(comeBack).toBeDisabled();
    await user.click(screen.getByRole('button', { name: calls.join.sampleDemo }));

    const join = await screen.findByRole('button', { name: calls.prejoin.joinNow });
    await waitFor(() => expect(join).toBeEnabled());
    await user.click(join);

    await user.click(await screen.findByRole('button', { name: calls.controls.endForEveryone }, { timeout: 5000 }));
    await user.click(await screen.findByRole('button', { name: calls.consultation.end }));

    const dialog = await screen.findByRole('dialog', { name: calls.outcome.title }, { timeout: 5000 });
    // The session is over: no way back into it behind the dialog.
    expect(screen.queryByRole('button', { name: calls.join.sampleDemo, hidden: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: calls.join.button, hidden: true })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('radio', { name: calls.outcome.status.completed }));
    await user.click(within(dialog).getByRole('button', { name: calls.outcome.submit }));

    expect(await screen.findByText(new RegExp(calls.consultations.outcomeRecorded.replace('{{status}}', calls.outcome.status.completed)))).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: calls.followUp.expertTitle })).toBeInTheDocument();
  });
});
