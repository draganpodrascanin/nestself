/**
 * Webinar routes in sample mode (CW-R-56, WBN-01, WBN-06, WBN-07): the
 * fixtures render with the banner, the recording notice appears before
 * registering, the lobby states the camera sentence with a countdown, the
 * sample live view shows the attendee controls without any camera control,
 * and nothing is sent.
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

/** 25 October 2026, 10:00 in Belgrade: a month before the upcoming sample webinar. */
const NOW = new Date('2026-10-25T09:00:00.000Z');
const UPCOMING = 'webinar_sample_upcoming';
const TITLE = 'Planning a balanced working week';

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

describe('webinars in sample mode', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.history.replaceState(null, '', '/');
  });

  it('lists the published sample webinar with presenters, places and the recording notice before Register', async () => {
    renderAt('/webinars');

    expect(await screen.findByRole('heading', { name: calls.webinar.discovery.title, level: 1 })).toBeInTheDocument();
    expect(screen.getByText(common.sample.banner)).toBeInTheDocument();
    const [card] = within(screen.getByRole('list', { name: calls.webinar.discovery.title })).getAllByRole('listitem');
    expect(within(card!).getByRole('link', { name: TITLE })).toHaveAttribute('href', `/webinars/${UPCOMING}`);
    expect(within(card!).getByText('Presenters: Milica')).toBeInTheDocument();
    expect(within(card!).getByText('250 places left')).toBeInTheDocument();
    expect(within(card!).getByText(/\(Europe\/Belgrade\)$/)).toBeInTheDocument();
    // The recording notice is on screen before the employee registers (D-CW-34).
    expect(within(card!).getByText(calls.webinar.recordingNotice)).toBeInTheDocument();
    // The ended sample webinar is not listed.
    expect(screen.queryByText('Taking breaks during the working day')).not.toBeInTheDocument();
  });

  it('registers nothing in sample mode and says so', async () => {
    const user = userEvent.setup();
    renderAt('/webinars');
    await user.click(await screen.findByRole('button', { name: calls.webinar.register }));
    expect(await screen.findByText(calls.sample.actionNoop)).toBeInTheDocument();
  });

  it('shows the detail with the recording notice, the lobby sentences and the countdown; Join waits for registration', async () => {
    renderAt(`/webinars/${UPCOMING}`);

    expect(await screen.findByRole('heading', { name: TITLE, level: 1 })).toBeInTheDocument();
    expect(screen.getByText(calls.webinar.recordingNotice)).toBeInTheDocument();
    // WBN-15: the captions status beside the recording notice.
    expect(screen.getByTestId('webinar-captions-statement')).toHaveTextContent(calls.webinar.captionsStatement);
    expect(screen.getByTestId('webinar-registration-status')).toHaveTextContent(calls.webinar.detail.notRegistered);
    const lobby = screen.getByTestId('webinar-detail-lobby');
    expect(within(lobby).getByText(calls.webinar.lobby)).toBeInTheDocument();
    expect(within(lobby).getByTestId('webinar-detail-countdown')).toHaveTextContent('Starts in 31 days');
    expect(within(lobby).getByRole('button', { name: calls.webinar.join })).toBeDisabled();
    expect(within(lobby).getByText(calls.webinar.detail.registerToJoin)).toBeInTheDocument();
    // No attendee list or names in the lobby (D-CW-15).
    expect(screen.queryByText(/Jovan|Ana /)).not.toBeInTheDocument();
    expect(within(lobby).getByRole('link', { name: calls.webinar.detail.sampleDemo })).toHaveAttribute('href', `/webinars/${UPCOMING}/live`);
  });

  it('runs the sample live webinar for an attendee without any camera control', async () => {
    const user = userEvent.setup();
    renderAt(`/webinars/${UPCOMING}/live`);

    expect(await screen.findByText(calls.webinar.liveView.sampleNotice)).toBeInTheDocument();
    expect(screen.getByText(calls.webinar.liveView.prejoinBody)).toBeInTheDocument();
    const join = screen.getByRole('button', { name: calls.prejoin.joinNow });
    await waitFor(() => expect(join).toBeEnabled());
    await user.click(join);

    const controls = await screen.findByTestId('webinar-attendee-controls', {}, { timeout: 5000 });
    expect(within(controls).getByRole('button', { name: calls.webinar.hand.raise })).toBeInTheDocument();
    // Attendees never have a camera control (D-CW-35, CW-R-124).
    expect(screen.queryByRole('button', { name: new RegExp(`${calls.controls.cameraOn}|${calls.controls.cameraOff}`, 'i') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: calls.controls.shareScreen })).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: calls.webinar.liveView.panelsLabel })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: calls.webinar.chat.title })).toBeInTheDocument();
  });

  it('keeps a role without event.register out', async () => {
    const router = renderAt('/webinars', 'operations');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});
