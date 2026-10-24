import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { WebinarPoll } from '@nestself/contracts';
import { FakeWebinarClient, FakeWebinarServer } from '../testing/fake-webinar';
import { useWebinarStage } from './useWebinarStage';

const POLL: WebinarPoll = {
  id: 'poll-1',
  webinarId: 'sample-webinar',
  question: 'Which break would you like to try?',
  options: [
    { id: 'a', label: 'A short walk', position: 0 },
    { id: 'b', label: 'Stretching', position: 1 },
  ],
  openedAt: null,
  closedAt: null,
};

describe('useWebinarStage', () => {
  it('joins the rooms while mounted and leaves them on unmount', () => {
    const client = new FakeWebinarClient({ role: 'attendee' });
    const { result, unmount } = renderHook(() => useWebinarStage(client));
    expect(result.current.connected).toBe(true);
    unmount();
    expect(client.getSnapshot().connected).toBe(false);
  });

  it('re-renders on room events and derives live, recording and the current poll', () => {
    const server = new FakeWebinarServer({ polls: [POLL] });
    const moderator = new FakeWebinarClient({ server, role: 'moderator' });
    const attendee = new FakeWebinarClient({ server, role: 'attendee' });
    const { result } = renderHook(() => useWebinarStage(attendee));
    renderHook(() => useWebinarStage(moderator));
    expect(result.current).toMatchObject({ isLive: false, isRecording: false, currentPoll: null, activePoll: null });

    act(() => server.simulate.start());
    expect(result.current).toMatchObject({ isLive: true, isRecording: true });

    act(() => void server.simulate.openPoll('poll-1'));
    expect(result.current.activePoll?.id).toBe('poll-1');
    act(() => void server.simulate.closePoll('poll-1'));
    expect(result.current.activePoll).toBeNull();
    expect(result.current.currentPoll?.id).toBe('poll-1');
    expect(result.current.polls.results['poll-1']?.totalVotes).toBe(0);
  });

  it('tracks pending actions per target and exposes the coded error of the area', async () => {
    const server = new FakeWebinarServer({ status: 'live' });
    const moderator = new FakeWebinarClient({ server, role: 'moderator' });
    const { result } = renderHook(() => useWebinarStage(moderator));
    const message = server.simulate.attendeeMessage({ participantId: 'p1', name: 'Ana (sample)' }, 'Hello');
    await waitFor(() => expect(result.current.pendingMessages).toHaveLength(1));

    server.simulate.failNext('message.publish', 'not_found');
    let publishing: Promise<void> = Promise.resolve();
    act(() => {
      publishing = result.current.publish(message.id);
    });
    expect(result.current.isPending('message.publish', message.id)).toBe(true);
    await act(async () => {
      await publishing.catch(() => undefined);
    });
    expect(result.current.isPending('message.publish', message.id)).toBe(false);
    expect(result.current.errorOf('moderation')).toMatchObject({ code: 'not_found' });

    await act(() => result.current.publish(message.id));
    expect(result.current.errorOf('moderation')).toBeNull();
    expect(result.current.pendingMessages).toEqual([]);
    expect(result.current.publicMessages.map((entry) => entry.id)).toEqual([message.id]);
  });

  it('toggles the hand between raised and lowered', async () => {
    const attendee = new FakeWebinarClient({ role: 'attendee', name: 'Ana (sample)' });
    const { result } = renderHook(() => useWebinarStage(attendee));
    await act(() => result.current.toggleHand());
    expect(result.current.myHand.raised).toBe(true);
    await act(() => result.current.toggleHand());
    expect(result.current.myHand.raised).toBe(false);
  });
});
