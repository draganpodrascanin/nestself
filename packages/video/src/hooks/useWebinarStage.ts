import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { WebinarModerationMessage, WebinarPoll } from '@nestself/contracts';
import type { WebinarAction, WebinarActionArea, WebinarClientApi } from '../webinar/types';

/** The open poll: opened and not closed. */
function openPollOf(list: readonly WebinarPoll[]): WebinarPoll | null {
  return list.find((poll) => poll.openedAt !== null && poll.closedAt === null) ?? null;
}

/** The poll an attendee sees: the open one, else the last closed one (its results stay on screen). */
function currentPollOf(list: readonly WebinarPoll[]): WebinarPoll | null {
  const open = openPollOf(list);
  if (open) return open;
  const closed = list.filter((poll) => poll.closedAt !== null);
  return closed.sort((a, b) => (a.closedAt ?? '').localeCompare(b.closedAt ?? '')).at(-1) ?? null;
}

/**
 * The live webinar for React (guidelines 11.2, T-CW-2.3): the client's state
 * slices, a few derived values and the actions. Joins the rooms while
 * mounted (the client counts references, so several components can use the
 * same client). Actions return promises that reject with a coded
 * `WebinarActionError`; the error also stays in `errors[area]` until the next
 * attempt, so the screen that made the call can render it.
 */
export function useWebinarStage(client: WebinarClientApi) {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);

  useEffect(() => client.connect(), [client]);

  return useMemo(() => {
    const isHost = snapshot.role !== 'attendee';
    const isModerator = snapshot.role === 'moderator';
    const pendingMessages: readonly WebinarModerationMessage[] = isModerator
      ? snapshot.moderationMessages.filter((message) => message.status === 'pending')
      : [];
    return {
      ...snapshot,
      isHost,
      isModerator,
      isLive: snapshot.status === 'live',
      isEnded: snapshot.status === 'ended' || snapshot.status === 'canceled',
      /** Show the REC indicator (UX-45). */
      isRecording: snapshot.recording.status === 'recording',
      /** Moderator only: attendee messages and questions waiting for review (WBN-23). */
      pendingMessages,
      /** The poll that is open right now, if any. */
      activePoll: openPollOf(snapshot.polls.list),
      /** The open poll, else the last closed one with its results. */
      currentPoll: currentPollOf(snapshot.polls.list),
      /** True while the action (for this target, when given) is in flight. */
      isPending: (action: WebinarAction, targetId?: string) => snapshot.pending.includes(targetId ? `${action}:${targetId}` : action),
      errorOf: (area: WebinarActionArea) => snapshot.errors[area] ?? null,

      sendMessage: client.sendMessage.bind(client),
      raiseHand: () => client.raiseHand(),
      lowerHand: () => client.lowerHand(),
      toggleHand: () => (snapshot.myHand.raised ? client.lowerHand() : client.raiseHand()),
      vote: (pollId: string, optionId: string) => client.vote(pollId, optionId),
      acknowledgeFloor: () => client.acknowledgeFloor(),
      dismissFloorNotice: () => client.dismissFloorNotice(),
      publish: (messageId: string, text?: string) => client.publish(messageId, text),
      answer: (messageId: string, answerText: string) => client.answer(messageId, answerText),
      dismiss: (messageId: string) => client.dismiss(messageId),
      giveFloor: (participantId: string) => client.giveFloor(participantId),
      takeFloor: (participantId: string) => client.takeFloor(participantId),
      openPoll: (pollId: string) => client.openPoll(pollId),
      closePoll: (pollId: string) => client.closePoll(pollId),
      stopRecording: () => client.stopRecording(),
      clearError: (area: WebinarActionArea) => client.clearError(area),
    };
  }, [client, snapshot]);
}

export type UseWebinarStageResult = ReturnType<typeof useWebinarStage>;
