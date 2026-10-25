/**
 * Public shapes of the webinar client (T-CW-2.3): the state a webinar screen
 * renders, the injected transport the apps implement with the api-client and
 * the Socket.IO client (T-CW-2.4), and the actions.
 *
 * Anonymity is a state property (D-CW-15, WBN-08): an attendee's state holds
 * no roster, no names and no counts; a presenter's state holds hands without
 * names; only the moderator's state carries registration names. Poll state
 * holds aggregate counts and this viewer's own choice, never a voter id
 * (D-CW-16, WEB-35).
 *
 * The client never touches video (D-CW-35): its only media surface is
 * `WebinarAudioControl`, the audio capability and the mute of the call
 * controller.
 *
 * @see docs/tasks/calls-webinars/02-decisions.md D-CW-15, D-CW-16, D-CW-34, D-CW-35, section 7
 * @see docs/tasks/calls-webinars/06-implementation-guidelines.md sections 4.6 to 4.8, 8
 */
import type {
  RecordingStatus,
  WebinarHostRole,
  WebinarMessage,
  WebinarMessageAnswerRequest,
  WebinarMessageCreateRequest,
  WebinarMessagePublishRequest,
  WebinarModerationMessage,
  WebinarPoll,
  WebinarPollResults,
  WebinarPollVoteRequest,
  WebinarStatus,
} from '@nestself/contracts';
import type { CallSessionControllerApi } from '../types';

/** Who is looking at the webinar: an attendee, a presenter or the moderator. */
export type WebinarViewerRole = 'attendee' | WebinarHostRole;

/**
 * The actions the client performs through the transport, one per API route
 * (decision record section 7). `WEBINAR_ACTION_ROUTES` names the route.
 */
export const WEBINAR_ACTIONS = [
  'message.send',
  'message.publish',
  'message.answer',
  'message.dismiss',
  'hand.raise',
  'hand.lower',
  'floor.give',
  'floor.take',
  'poll.open',
  'poll.close',
  'poll.vote',
  'recording.stop',
  'webinar.end',
] as const;
export type WebinarAction = (typeof WEBINAR_ACTIONS)[number];

/** Method and path of each action, for the app's transport (`:id` is the webinar id). */
export const WEBINAR_ACTION_ROUTES = {
  'message.send': { method: 'POST', path: '/webinars/:id/messages' },
  'message.publish': { method: 'POST', path: '/webinars/:id/messages/:messageId/publish' },
  'message.answer': { method: 'POST', path: '/webinars/:id/messages/:messageId/answer' },
  'message.dismiss': { method: 'POST', path: '/webinars/:id/messages/:messageId/dismiss' },
  'hand.raise': { method: 'POST', path: '/webinars/:id/hand' },
  'hand.lower': { method: 'DELETE', path: '/webinars/:id/hand' },
  'floor.give': { method: 'POST', path: '/webinars/:id/participants/:participantId/give-floor' },
  'floor.take': { method: 'POST', path: '/webinars/:id/participants/:participantId/take-floor' },
  'poll.open': { method: 'POST', path: '/webinars/:id/polls/:pollId/open' },
  'poll.close': { method: 'POST', path: '/webinars/:id/polls/:pollId/close' },
  'poll.vote': { method: 'POST', path: '/webinars/:id/polls/:pollId/vote' },
  'recording.stop': { method: 'POST', path: '/webinars/:id/recording/stop' },
  'webinar.end': { method: 'POST', path: '/webinars/:id/end' },
} as const satisfies Record<WebinarAction, { method: 'POST' | 'DELETE'; path: string }>;

type EmptyBody = Record<string, never>;

/**
 * Input of each action: the path parameters and the request body, which is
 * exactly the contract request schema. The vote body is `{ optionId }` only:
 * no voter field fits (CW-R-24).
 */
export interface WebinarActionInputs {
  'message.send': { body: WebinarMessageCreateRequest };
  'message.publish': { messageId: string; body: WebinarMessagePublishRequest };
  'message.answer': { messageId: string; body: WebinarMessageAnswerRequest };
  'message.dismiss': { messageId: string; body: EmptyBody };
  'hand.raise': { body: EmptyBody };
  'hand.lower': { body: EmptyBody };
  'floor.give': { participantId: string; body: EmptyBody };
  'floor.take': { participantId: string; body: EmptyBody };
  'poll.open': { pollId: string; body: EmptyBody };
  'poll.close': { pollId: string; body: EmptyBody };
  'poll.vote': { pollId: string; body: WebinarPollVoteRequest };
  'recording.stop': { body: EmptyBody };
  'webinar.end': { body: EmptyBody };
}

/** Receives one event of a room: its name and its raw payload, validated by the client. */
export type WebinarRoomHandler = (event: string, payload: unknown) => void;

/**
 * What the client needs from the outside world, created by the app for one
 * webinar. `subscribe` joins a Socket.IO room (`webinar:{id}` or
 * `webinar:{id}:moderation`) and returns the unsubscribe; the per-participant
 * floor events (`WEBINAR_PARTICIPANT_EVENT_NAMES`) arrive on the same socket
 * and are delivered through the public room's handler. `post` calls the API
 * route of the action and resolves with the response body; it rejects with
 * an error carrying the API `code` (the api-client's `ApiError`).
 */
export interface WebinarTransport {
  subscribe(room: string, handler: WebinarRoomHandler): () => void;
  post<A extends WebinarAction>(action: A, input: WebinarActionInputs[A]): Promise<unknown>;
}

/**
 * The call controller's audio surface: everything the floor needs, and
 * nothing that sends video. A single meeting changes the audio capability;
 * a replica attendee is promoted onto the primary meeting (T-CW-3.2).
 */
export type WebinarAudioControl = Pick<
  CallSessionControllerApi,
  'setAudioCapability' | 'setMuted' | 'promoteToPrimaryMeeting' | 'demoteFromPrimaryMeeting'
>;

/** Action groups for pending and error state; one error per group is shown at a time. */
export type WebinarActionArea = 'chat' | 'hand' | 'moderation' | 'floor' | 'poll' | 'recording' | 'end';

/** A raised hand as the moderator sees it, with the registration name (WBN-10); presenters get the count only. */
export interface WebinarHand {
  participantId: string;
  name: string | null;
  raisedAt: string;
}

/**
 * An attendee who has the floor; kept until a host takes it back, even if the
 * hand is lowered. Every host learns of it from `webinar.floor.state` on the
 * hosts' room (the participant id); only the moderator may know the name.
 */
export interface WebinarSpeaker {
  participantId: string;
  name: string | null;
}

export interface WebinarPollsState {
  /** Every poll this viewer knows: prepared (not opened), open and closed. */
  list: readonly WebinarPoll[];
  /** Aggregate results by poll id (`webinar.poll.results`). */
  results: Readonly<Record<string, WebinarPollResults>>;
  /** This viewer's own choice by poll id, kept on this device only; never a voter id. */
  votes: Readonly<Record<string, string>>;
}

/**
 * The attendee's floor: `given` from `webinar.floor.given` until
 * `webinar.floor.taken` makes it `taken` (the short notice), `none` once the
 * notice is dismissed. The unmute control is enabled only after the floor
 * notice was acknowledged (CW-R-125).
 */
export interface WebinarFloorState {
  status: 'none' | 'given' | 'taken';
  acknowledged: boolean;
}

export interface WebinarHandState {
  raised: boolean;
  raisedAt: string | null;
}

/**
 * Immutable snapshot. Every field keeps its identity until it changes, so
 * React can select from it with `useSyncExternalStore`.
 */
export interface WebinarSnapshot {
  webinarId: string;
  role: WebinarViewerRole;
  /** The caller's `call_participants.id` (attendees): floor events are matched against it. */
  participantId: string | null;
  connected: boolean;
  status: WebinarStatus;
  endedAt: string | null;
  /** Hosts only (`webinar.attendance.count`, a number, never names); null for attendees and until the first count. */
  attendanceCount: number | null;
  /**
   * Drives the persistent REC indicator (UX-45). Null until the join response
   * or the first `webinar.recording` event says: a live webinar with an
   * unknown status counts as recording, because every webinar is recorded
   * (D-CW-34).
   */
  recording: { status: RecordingStatus | null };
  /** Published and answered messages: the chat everyone sees (CW-R-34a). */
  publicMessages: readonly WebinarMessage[];
  /** Moderator only: every message with the registration name (WBN-23). */
  moderationMessages: readonly WebinarModerationMessage[];
  /** Ids of messages this viewer sent, to tell them when a host publishes one. */
  ownMessageIds: readonly string[];
  /** The moderator only (moderation room, names). */
  hands: readonly WebinarHand[];
  /** Hosts only: raised hands as a number (`webinar.hand.count` on the hosts' room); null until the first count. */
  handCount: number | null;
  /** Hosts only: who has the floor (`webinar.floor.state` on the hosts' room). */
  speakers: readonly WebinarSpeaker[];
  polls: WebinarPollsState;
  /** Attendees: this viewer's hand. */
  myHand: WebinarHandState;
  /** Attendees: this viewer's floor. */
  myFloor: WebinarFloorState;
  /** Some attendee has the floor (`webinar.floor.state`, anonymous): "a participant is speaking" (WBN-25.8). */
  floorActive: boolean;
  /** Keys of actions in flight: `<action>` or `<action>:<target id>`. */
  pending: readonly string[];
  errors: Readonly<Partial<Record<WebinarActionArea, WebinarActionErrorLike>>>;
}

/** The coded failure of an action: `code` is the API error code, or `network`, `validation`, `forbidden`, `unknown`. */
export interface WebinarActionErrorLike {
  readonly code: string;
  readonly action: WebinarAction | 'floor.audio';
  /** The API error's `details`, for copy that names a value (the capacity `limit`). */
  readonly details?: Readonly<Record<string, unknown>>;
}

/** Data loaded by the app before or after connecting (`GET /webinars/:id`, `GET .../messages`, polls). */
export interface WebinarInitialState {
  status?: WebinarStatus;
  recordingStatus?: RecordingStatus;
  attendanceCount?: number | null;
  publicMessages?: readonly WebinarMessage[];
  moderationMessages?: readonly WebinarModerationMessage[];
  polls?: readonly WebinarPoll[];
  results?: readonly WebinarPollResults[];
  hands?: readonly WebinarHand[];
  handCount?: number | null;
  /** Optional: the hosts' room's `webinar.floor.state` fills it after a reload. */
  speakers?: readonly WebinarSpeaker[];
  floorActive?: boolean;
  myHand?: WebinarHandState;
}

/** What hooks and components need from a webinar client; the real one and the fake one implement it. */
export interface WebinarClientApi {
  getSnapshot(): WebinarSnapshot;
  subscribe(listener: () => void): () => void;
  /** Joins the rooms; reference counted, so every caller releases with the returned function. */
  connect(): () => void;
  /** Merges data the app loaded (messages, polls, hands) into the state. */
  hydrate(initial: WebinarInitialState): void;

  sendMessage(request: WebinarMessageCreateRequest): Promise<void>;
  raiseHand(): Promise<void>;
  lowerHand(): Promise<void>;
  vote(pollId: string, optionId: string): Promise<void>;
  /** The attendee read the floor notice; the unmute control is enabled from now on (CW-R-125). */
  acknowledgeFloor(): void;
  /** Hides the "floor taken back" notice. */
  dismissFloorNotice(): void;

  publish(messageId: string, text?: string): Promise<void>;
  answer(messageId: string, answerText: string): Promise<void>;
  dismiss(messageId: string): Promise<void>;
  giveFloor(participantId: string): Promise<void>;
  takeFloor(participantId: string): Promise<void>;
  openPoll(pollId: string): Promise<void>;
  closePoll(pollId: string): Promise<void>;
  stopRecording(): Promise<void>;
  /** Hosts: `POST /webinars/:id/end`, the webinar ends for everyone (WBN-21, WBN-29). */
  end(): Promise<void>;

  clearError(area: WebinarActionArea): void;
  destroy(): void;
}
