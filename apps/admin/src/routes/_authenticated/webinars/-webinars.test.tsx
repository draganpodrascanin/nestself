/**
 * Admin webinar routes in sample mode (WBN-16, WBN-30 to WBN-32, CW-R-56):
 * the occurrence list, the detail with cancel confirmed first, the form's
 * own validation with its summary, the moderator console (start, attendance,
 * end with confirmation) and the presenter view with the screen share
 * control. Nothing is created, published, canceled or sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SAMPLE_PRINCIPALS, SAMPLE_WEBINARS } from '@nestself/sample-data';
import calls from '@nestself/i18n/locales/en/calls.json';
import common from '@nestself/i18n/locales/en/common.json';
import { routeTree } from '../../../routeTree.gen';
import i18n from '../../../i18n';

const NOW = new Date('2026-10-25T09:00:00.000Z');
const UPCOMING = 'webinar_sample_upcoming';
const TITLE = 'Planning a balanced working week';

function renderAt(path: string, role: keyof typeof SAMPLE_PRINCIPALS) {
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

async function joinFromPrejoin(user: ReturnType<typeof userEvent.setup>) {
  const join = await screen.findByRole('button', { name: calls.prejoin.joinNow }, { timeout: 5000 });
  await waitFor(() => expect(join).toBeEnabled());
  await user.click(join);
}

describe('admin webinars (sample mode)', () => {
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

  it('lists every sample occurrence with status and capacity, and offers a new one', async () => {
    renderAt('/webinars', 'operations');

    expect(await screen.findByRole('heading', { name: calls.webinar.admin.title, level: 1 })).toBeInTheDocument();
    expect(screen.getByText(common.sample.banner)).toBeInTheDocument();
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByRole('link', { name: TITLE })).toHaveAttribute('href', `/webinars/${UPCOMING}`);
    expect(within(rows[0]!).getByText(calls.webinar.status.published)).toBeInTheDocument();
    expect(within(rows[1]!).getByText(calls.webinar.status.ended)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: calls.webinar.admin.new })).toHaveAttribute('href', '/webinars/new');
  });

  it('shows the occurrence with its hosts and cancels nothing after the confirmation', async () => {
    const user = userEvent.setup();
    renderAt(`/webinars/${UPCOMING}`, 'operations');

    expect(await screen.findByRole('heading', { name: TITLE, level: 1 })).toBeInTheDocument();
    const hosts = SAMPLE_WEBINARS.find((webinar) => webinar.id === UPCOMING)!.hosts;
    for (const host of hosts) expect(screen.getByText(host.displayName)).toBeInTheDocument();
    expect(screen.getByText(calls.webinar.admin.audienceAll)).toBeInTheDocument();
    expect(screen.getByText(calls.webinar.recordingNotice)).toBeInTheDocument();
    // Already published: no Publish, but Cancel and the live view.
    expect(screen.queryByRole('button', { name: calls.webinar.admin.publish })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: calls.webinar.admin.openLive })).toHaveAttribute('href', `/webinars/${UPCOMING}/live`);

    await user.click(screen.getByRole('button', { name: calls.webinar.admin.cancel }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(calls.webinar.admin.cancelBody)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: calls.webinar.admin.cancel }));
    expect(await screen.findByText(calls.sample.actionNoop)).toBeInTheDocument();
  });

  it('validates the form, names the capacity limit and creates nothing', async () => {
    const user = userEvent.setup();
    renderAt('/webinars/new', 'operations');

    expect(await screen.findByRole('heading', { name: calls.webinar.form.title, level: 1 })).toBeInTheDocument();
    // Each locale field is labelled with its language, in the reader's language.
    const titleFields = screen.getByRole('group', { name: calls.webinar.form.titleLegend });
    for (const label of ['English', 'Serbian (Latin)', 'Serbian (Cyrillic)', 'Hungarian']) {
      expect(within(titleFields).getByLabelText(label)).toBeInTheDocument();
    }
    expect(Object.values(calls.webinar.form.languages)).toEqual(['English', 'Serbian (Latin)', 'Serbian (Cyrillic)', 'Hungarian']);
    // No recording switch: every webinar is recorded (D-CW-34).
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.getByText(calls.webinar.recordingNotice)).toBeInTheDocument();
    expect(screen.getByText('From 1 to 1,000 attendees.')).toBeInTheDocument();
    expect(screen.getByText('Times are in Europe/Belgrade.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: calls.webinar.form.submit }));
    const summary = await screen.findByRole('alert');
    expect(within(summary).getByText(calls.webinar.form.errorSummary)).toBeInTheDocument();
    expect(within(summary).getByText(new RegExp(calls.webinar.form.titleRequired))).toBeInTheDocument();
    expect(within(summary).getByText(new RegExp(calls.webinar.form.dateRequired))).toBeInTheDocument();

    const titles = screen.getByRole('group', { name: calls.webinar.form.titleLegend });
    await user.type(within(titles).getByLabelText(calls.webinar.form.languages.en), 'Sleep and rest (sample)');
    await user.type(screen.getByLabelText(calls.webinar.form.date), '2026-12-02');
    await user.type(screen.getByLabelText(calls.webinar.form.startTime), '17:00');
    await user.type(screen.getByLabelText(calls.webinar.form.endTime), '18:00');
    await user.click(screen.getByRole('checkbox', { name: 'Milica Ristić' }));
    await user.click(screen.getByRole('button', { name: calls.webinar.form.submit }));
    expect(await screen.findByText(calls.sample.actionNoop)).toBeInTheDocument();
  });

  it('runs the moderator console: start, attendance count, early stop control, end with confirmation', async () => {
    const user = userEvent.setup();
    renderAt(`/webinars/${UPCOMING}/live`, 'operations');

    expect(await screen.findByText(calls.webinar.console.sampleNotice)).toBeInTheDocument();
    expect(screen.getByTestId('webinar-console-registered')).toHaveTextContent('Registered attendees: 0');
    await joinFromPrejoin(user);

    const lobby = await screen.findByTestId('webinar-lobby', {}, { timeout: 5000 });
    await user.click(within(lobby).getByRole('button', { name: calls.webinar.start }));

    const queue = await screen.findByTestId('webinar-moderator-queue');
    await waitFor(() => expect(within(queue).getByTestId('webinar-queue-attendance')).toHaveTextContent('Attending: 86'));
    // The sample people come from the fixtures; the moderator sees the registration name on a raised hand (WBN-10).
    await user.click(within(queue).getByRole('button', { name: 'Give the floor to Ana Nikolić' }));
    // WBN-26: the speaker row offers Mute, then "Ask to unmute" once muted; a host never unmutes.
    await user.click(await within(queue).findByRole('button', { name: 'Mute Ana Nikolić' }));
    expect(await within(queue).findByRole('button', { name: 'Ask Ana Nikolić to unmute' })).toBeInTheDocument();
    expect(within(queue).getByText(calls.webinar.moderation.muted)).toBeInTheDocument();
    // The fixture's pending question waits for review.
    expect(within(queue).getByText('Could you show the stretching example once more?')).toBeInTheDocument();
    expect(within(queue).getByRole('button', { name: calls.webinar.moderation.stopRecording })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: calls.webinar.console.pollTitle })).toBeInTheDocument();
    expect(screen.getByTestId('webinar-share-screen')).toBeInTheDocument();

    // The stage's end control asks with the WBN-21 copy first.
    await user.click(screen.getByRole('button', { name: calls.webinar.endForEveryone }));
    const dialog = await screen.findByRole('alertdialog', { name: calls.webinar.endConfirmTitle });
    expect(within(dialog).getByText(calls.webinar.endConfirmBody)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: calls.webinar.endForEveryone }));
    expect(await screen.findByTestId('webinar-ended', {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('gives the presenter the host stage without the moderator tools', async () => {
    const user = userEvent.setup();
    renderAt(`/webinars/${UPCOMING}/live`, 'expert');
    await joinFromPrejoin(user);

    expect(await screen.findByTestId('webinar-host-controls', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByTestId('webinar-share-screen')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: calls.webinar.console.pollTitle })).not.toBeInTheDocument();
  });

  it('lets the presenter give the floor to a raised hand without seeing a name, and take it back (WBN-25.1)', async () => {
    const user = userEvent.setup();
    renderAt(`/webinars/${UPCOMING}/live`, 'expert');
    await joinFromPrejoin(user);
    const lobby = await screen.findByTestId('webinar-lobby', {}, { timeout: 5000 });
    await user.click(within(lobby).getByRole('button', { name: calls.webinar.start }));

    const queue = await screen.findByTestId('webinar-moderator-queue');
    // The two sample hands, anonymous: "a participant asked to speak", each with Give the floor.
    const hands = await within(queue).findAllByTestId('webinar-queue-hand');
    expect(hands).toHaveLength(2);
    expect(hands[0]).toHaveTextContent(calls.webinar.handRaisedPresenter);
    expect(queue).not.toHaveTextContent('Ana Nikolić');
    await user.click(within(hands[0]!).getByRole('button', { name: calls.webinar.moderation.giveFloor }));

    const speaker = await within(queue).findByTestId('webinar-queue-speaker');
    expect(speaker).not.toHaveTextContent('Ana Nikolić');
    await waitFor(() => expect(within(queue).getAllByTestId('webinar-queue-hand')).toHaveLength(1));
    await user.click(within(speaker).getByRole('button', { name: calls.webinar.moderation.takeFloorFrom.replace('{{name}}', calls.webinar.chat.participant) }));
    await waitFor(() => expect(within(queue).queryByTestId('webinar-queue-speaker')).not.toBeInTheDocument());
  });

  it('shows the ended sample webinar\'s recording state and anonymous attendance rows', async () => {
    renderAt('/webinars/webinar_sample_ended', 'operations');
    expect(await screen.findByTestId('webinar-recording-state')).toHaveTextContent(calls.webinar.admin.recordingStatus.ready);
    expect(screen.getByTestId('webinar-attendance')).toHaveTextContent('Registered: 4');
    const table = screen.getByRole('table', { name: calls.webinar.admin.attendanceCaption });
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(4);
    expect(within(table).getByText('Registration 4')).toBeInTheDocument();
  });

  it('edits the sample occurrence with the audience locked and saves nothing', async () => {
    const user = userEvent.setup();
    renderAt(`/webinars/${UPCOMING}`, 'operations');
    await user.click(await screen.findByRole('link', { name: calls.webinar.admin.edit }));
    expect(await screen.findByRole('heading', { name: calls.webinar.form.editTitle, level: 1 })).toBeInTheDocument();
    expect(screen.getByText(calls.webinar.form.audienceLocked)).toBeInTheDocument();
    const titles = screen.getByRole('group', { name: calls.webinar.form.titleLegend });
    expect(within(titles).getByLabelText(calls.webinar.form.languages.en)).toHaveValue(TITLE);
    await user.click(screen.getByRole('button', { name: calls.webinar.form.save }));
    expect(await screen.findByText(calls.sample.actionNoop)).toBeInTheDocument();
  });

  it('keeps an employee out of the webinar admin', async () => {
    renderAt('/webinars', 'employee');
    expect(await screen.findByText(common.state.permission.title)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
