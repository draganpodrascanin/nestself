import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoA11yViolations } from '@nestself/ui/test';
import { renderWithI18n, t } from '../test/i18n';
import { SessionTimer } from './SessionTimer';

const STARTS = Date.parse('2030-01-10T09:00:00.000Z');
const ENDS = Date.parse('2030-01-10T09:45:00.000Z');
const MINUTE = 60_000;
const window = { startsAt: new Date(STARTS).toISOString(), endsAt: new Date(ENDS).toISOString() };
/** The timer ticks every second on a real interval. */
const TICK = { timeout: 2500 };

beforeEach(() => {
  // Only the clock is fake: jsdom runs animation frames on Node's setInterval,
  // so faking intervals would stall Motion's exit animations.
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SessionTimer (UX-15, CALL-13)', () => {
  it('shows elapsed and remaining time and keeps counting', async () => {
    vi.setSystemTime(STARTS + 10 * MINUTE);
    renderWithI18n(<SessionTimer {...window} participantRole="employee" />);
    expect(screen.getByText(t('timer.elapsed', { time: '10:00' }))).toBeInTheDocument();
    expect(screen.getByText(t('timer.remaining', { time: '35:00' }))).toBeInTheDocument();
    vi.setSystemTime(STARTS + 11 * MINUTE);
    expect(await screen.findByText(t('timer.remaining', { time: '34:00' }), undefined, TICK)).toBeInTheDocument();
  });

  it('shows the five-minute cue in a live region when five minutes are left', async () => {
    vi.setSystemTime(ENDS - 6 * MINUTE);
    renderWithI18n(<SessionTimer {...window} participantRole="employee" />);
    expect(screen.queryByText(t('consultation.fiveMinutesRemaining'))).toBeNull();
    vi.setSystemTime(ENDS - 5 * MINUTE);
    const cue = await screen.findByText(t('consultation.fiveMinutesRemaining'), undefined, TICK);
    expect(cue.closest('[aria-live]')).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByText(t('timer.followUpHint'))).toBeNull();
  });

  it('dismisses the cue: it stays mounted while it animates out, then is gone for good', async () => {
    vi.setSystemTime(ENDS - 4 * MINUTE);
    renderWithI18n(<SessionTimer {...window} participantRole="employee" />);
    await userEvent.setup().click(screen.getByRole('button', { name: t('timer.dismiss') }));
    expect(screen.queryByText(t('consultation.fiveMinutesRemaining'))).not.toBeNull();
    await waitFor(() => expect(screen.queryByText(t('consultation.fiveMinutesRemaining'))).toBeNull());
  });

  it('reminds the expert that a follow-up can be proposed after the call (D-CW-37)', () => {
    vi.setSystemTime(ENDS - 4 * MINUTE);
    renderWithI18n(<SessionTimer {...window} participantRole="expert" />);
    expect(screen.getByText(t('consultation.fiveMinutesRemaining'))).toBeInTheDocument();
    expect(screen.getByText(t('timer.followUpHint'))).toBeInTheDocument();
  });

  it('marks the end, warns before the room closes and closes it once', async () => {
    const onRoomClose = vi.fn();
    vi.setSystemTime(ENDS);
    renderWithI18n(<SessionTimer {...window} participantRole="employee" onRoomClose={onRoomClose} />);
    expect(screen.getByText(t('timer.timeEnded'))).toBeInTheDocument();
    vi.setSystemTime(ENDS + 10 * MINUTE);
    expect(await screen.findByText(t('timer.roomClosing', { count: 5 }), undefined, TICK)).toBeInTheDocument();
    expect(onRoomClose).not.toHaveBeenCalled();
    vi.setSystemTime(ENDS + 15 * MINUTE);
    await waitFor(() => expect(onRoomClose).toHaveBeenCalledOnce(), TICK);
    vi.setSystemTime(ENDS + 16 * MINUTE);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(onRoomClose).toHaveBeenCalledOnce();
  });

  it('passes axe', async () => {
    vi.setSystemTime(ENDS - 4 * MINUTE);
    const { container } = renderWithI18n(<SessionTimer {...window} participantRole="expert" />);
    await expectNoA11yViolations(container);
  });
});
