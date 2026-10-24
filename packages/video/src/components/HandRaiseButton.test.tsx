import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoA11yViolations } from '@nestself/ui/test';
import { renderWithI18n, t } from '../test/i18n';
import { FakeWebinarClient, FakeWebinarServer } from '../testing/fake-webinar';
import { HandRaiseButton } from './HandRaiseButton';

function setup() {
  const server = new FakeWebinarServer({ status: 'live' });
  const attendee = new FakeWebinarClient({ server, role: 'attendee', name: 'Ana Kovač (sample)' });
  const moderator = new FakeWebinarClient({ server, role: 'moderator' });
  moderator.connect();
  return { server, attendee, moderator };
}

describe('HandRaiseButton (WBN-10, UX-27)', () => {
  it('emits the raised hand to the moderation room only', async () => {
    const user = userEvent.setup();
    const { server, attendee, moderator } = setup();
    renderWithI18n(<HandRaiseButton client={attendee} />);
    await user.click(screen.getByRole('button', { name: t('webinar.hand.raise') }));

    await waitFor(() => expect(moderator.getSnapshot().hands).toHaveLength(1));
    const raised = server.emitted.filter((entry) => entry.event === 'webinar.hand.raised');
    expect(raised).toEqual([expect.objectContaining({ room: 'webinar:sample-webinar:moderation' })]);
    expect(server.requests.at(-1)).toMatchObject({ action: 'hand.raise', input: { body: {} } });
    expect(moderator.getSnapshot().hands[0]).toMatchObject({ name: 'Ana Kovač (sample)' });
  });

  it('shows the raised state and announces it', async () => {
    const user = userEvent.setup();
    const { attendee } = setup();
    renderWithI18n(<HandRaiseButton client={attendee} />);
    const button = screen.getByTestId('webinar-hand-raise');
    expect(button).toHaveAttribute('data-state', 'lowered');
    await user.click(button);
    await waitFor(() => expect(button).toHaveAttribute('data-state', 'raised'));
    expect(button).toHaveAccessibleName(t('webinar.hand.lower'));
    expect(screen.getByTestId('webinar-hand-announcer')).toHaveTextContent(t('webinar.hand.raised'));
    expect(screen.getByTestId('webinar-hand-announcer').closest('[aria-live]')).toHaveAttribute('aria-live', 'polite');
  });

  it('returns to the lowered state after a second toggle, from the keyboard', async () => {
    const user = userEvent.setup();
    const { server, attendee } = setup();
    renderWithI18n(<HandRaiseButton client={attendee} />);
    const button = screen.getByTestId('webinar-hand-raise');
    button.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(button).toHaveAttribute('data-state', 'raised'));
    await user.keyboard(' ');
    await waitFor(() => expect(button).toHaveAttribute('data-state', 'lowered'));
    expect(button).toHaveAccessibleName(t('webinar.hand.raise'));
    expect(screen.getByTestId('webinar-hand-announcer')).toHaveTextContent(t('webinar.hand.lowered'));
    expect(server.emitted.at(-1)).toMatchObject({ room: 'webinar:sample-webinar:moderation', event: 'webinar.hand.lowered' });
  });

  it('shows a failed raise on screen and keeps the hand lowered', async () => {
    const user = userEvent.setup();
    const { server, attendee } = setup();
    server.simulate.failNext('hand.raise', 'webinar_not_open');
    renderWithI18n(<HandRaiseButton client={attendee} error={null} />);
    await user.click(screen.getByRole('button', { name: t('webinar.hand.raise') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t('errors.webinarNotOpen'));
    expect(screen.getByTestId('webinar-hand-raise')).toHaveAttribute('data-state', 'lowered');
  });

  it('renders an error passed from outside and has no accessibility violations', async () => {
    const { attendee } = setup();
    const { container } = renderWithI18n(<HandRaiseButton client={attendee} error={t('errors.network')} />);
    expect(screen.getByRole('alert')).toHaveTextContent(t('errors.network'));
    await expectNoA11yViolations(container);
  });
});
