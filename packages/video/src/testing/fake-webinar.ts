/**
 * An in-memory webinar for stories, unit tests and the apps' sample mode
 * (T-CW-2.3). `FakeWebinarServer` plays the API and the Socket.IO rooms as
 * the API serves them: the public room, the moderation room (moderators
 * only) and the hosts' room (presenters and moderators). It answers the
 * client's actions, keeps messages, hands, the floor, polls and the
 * recording state, and emits what the API emits: `webinar.hand.lowered` and
 * `webinar.floor.state` on giving the floor, `webinar.message.removed` on
 * dismissing a published message, the hand count and the floor holder on
 * the hosts' room. Every payload is validated with the contract schema of
 * its room before it leaves, so a malformed fake event fails loudly. `FakeWebinarClient` is a real `WebinarClient` on a transport
 * of that server, so several clients (an attendee and a moderator) can share
 * one webinar. Nothing reaches a network, and votes are counted without a
 * voter, as on the server (D-CW-16).
 */
import {
  ROOM_EVENT_PAYLOAD_SCHEMAS,
  WEBINAR_FLOOR_MUTE_HOSTS_EVENT_PAYLOAD_SCHEMAS,
  WEBINAR_FLOOR_MUTE_PARTICIPANT_EVENT_PAYLOAD_SCHEMAS,
  WEBINAR_HOSTS_ROOM_EVENT_PAYLOAD_SCHEMAS,
  WEBINAR_MODERATION_ROOM_ADDED_EVENT_PAYLOAD_SCHEMAS,
  WEBINAR_ROOM_ADDED_EVENT_PAYLOAD_SCHEMAS,
  webinarHostsRoomName,
  webinarModerationRoomName,
  webinarRoomName,
} from '@nestself/contracts';
import type {
  RecordingStatus,
  WebinarEventName,
  WebinarHostsRoomEventName,
  WebinarModerationRoomAddedEventName,
  WebinarRoomAddedEventName,
  WebinarMessage,
  WebinarMessageKind,
  WebinarModerationMessage,
  WebinarPoll,
  WebinarPollResults,
  WebinarStatus,
} from '@nestself/contracts';
import { WebinarClient } from '../webinar/client';
import type { WebinarFloorConsentEventName } from '../webinar/floor-consent';
import type { WebinarClientOptions } from '../webinar/client';
import type { WebinarAction, WebinarActionInputs, WebinarInitialState, WebinarRoomHandler, WebinarTransport, WebinarViewerRole } from '../webinar/types';

export interface FakeWebinarIdentity {
  role: WebinarViewerRole;
  participantId?: string | null;
  /** The registration name of an attendee, or a host's display name. */
  name?: string | null;
}

export interface FakeWebinarServerOptions {
  webinarId?: string;
  status?: WebinarStatus;
  /** Prepared polls; the moderator opens them. */
  polls?: WebinarPoll[];
  /** Delay of every action in milliseconds (0 in tests). */
  delayMs?: number;
  /**
   * Attendees sit in replica meetings (media replication, T-CW-3.2): giving
   * the floor sends `primaryAttendee` sample credentials for a promotion
   * instead of a capability change.
   */
  replicated?: boolean;
}

type FakeEventName =
  | WebinarEventName
  | WebinarRoomAddedEventName
  | WebinarHostsRoomEventName
  | WebinarModerationRoomAddedEventName
  | WebinarFloorConsentEventName;


export interface FakeWebinarEmission {
  room: string;
  event: FakeEventName;
  payload: unknown;
  /** Set for per-participant events (`webinar.floor.given`, `webinar.floor.taken`). */
  to?: string;
}

export interface FakeWebinarRequest {
  action: WebinarAction;
  input: unknown;
  from: FakeWebinarIdentity;
}

interface Subscription {
  room: string;
  handler: WebinarRoomHandler;
  identity: FakeWebinarIdentity;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const now = () => new Date().toISOString();

/** An API-style failure: the api-client's `ApiError` carries `code` the same way. */
function apiError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

function firstName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

function toPublic(message: WebinarModerationMessage): WebinarMessage {
  const { authorParticipantId: _participant, authorName: _name, showFirstName: _show, ...rest } = message;
  return rest;
}

const HOST_ACTIONS: ReadonlySet<WebinarAction> = new Set<WebinarAction>(['floor.give', 'floor.take', 'floor.mute', 'floor.unmuteRequest', 'webinar.end']);
const MODERATOR_ACTIONS: ReadonlySet<WebinarAction> = new Set<WebinarAction>([
  'message.publish',
  'message.answer',
  'message.dismiss',
  'poll.open',
  'poll.close',
  'recording.stop',
]);

export class FakeWebinarServer {
  readonly webinarId: string;
  /** Every event the server emitted, in order. */
  readonly emitted: FakeWebinarEmission[] = [];
  /** Every action the server received, in order, with exactly the input the client sent. */
  readonly requests: FakeWebinarRequest[] = [];

  private readonly subscriptions = new Set<Subscription>();
  private readonly messages = new Map<string, WebinarModerationMessage>();
  private readonly polls = new Map<string, { poll: WebinarPoll; counts: Map<string, number> }>();
  private readonly hands = new Map<string, { name: string; raisedAt: string }>();
  /** Attendees who have the floor, with the registration name the moderator may see and whether a host muted them. */
  private readonly speakers = new Map<string, { name: string | null; muted: boolean }>();
  /** Registration names by participant id, for the moderator's view of the speakers. */
  private readonly names = new Map<string, string>();
  private readonly failures = new Map<WebinarAction, string>();
  private readonly delayMs: number;
  private readonly replicated: boolean;
  private status: WebinarStatus;
  private recordingStatus: RecordingStatus = 'scheduled';
  private recordingStartedAt: string | null = null;
  private attendance = 0;
  private nextId = 1;

  constructor(options: FakeWebinarServerOptions = {}) {
    this.webinarId = options.webinarId ?? 'sample-webinar';
    this.status = options.status ?? 'published';
    this.delayMs = options.delayMs ?? 0;
    this.replicated = options.replicated ?? false;
    for (const poll of options.polls ?? []) this.addPoll(poll);
  }

  private get room(): string {
    return webinarRoomName(this.webinarId);
  }

  private get moderationRoom(): string {
    return webinarModerationRoomName(this.webinarId);
  }

  private get hostsRoom(): string {
    return webinarHostsRoomName(this.webinarId);
  }

  private id(prefix: string): string {
    return `sample-${prefix}-${this.nextId++}`;
  }

  /** A participant id the server hands out, as `POST /webinars/:id/join` would. */
  nextParticipantId(): string {
    return this.id('participant');
  }

  addPoll(poll: WebinarPoll, results: readonly { optionId: string; count: number }[] = []): void {
    const counts = new Map(poll.options.map((option) => [option.id, 0]));
    for (const result of results) if (counts.has(result.optionId)) counts.set(result.optionId, result.count);
    this.polls.set(poll.id, { poll: { ...poll, webinarId: this.webinarId }, counts });
  }

  /** Puts an existing message in the server's state without emitting anything (sample data). */
  seedMessage(message: WebinarModerationMessage): void {
    this.messages.set(message.id, { ...message, webinarId: this.webinarId });
  }

  /** The state a client of this identity would load on entering (`GET /webinars/:id`, messages, polls). */
  initialFor(identity: FakeWebinarIdentity): WebinarInitialState {
    const all = [...this.messages.values()];
    const host = identity.role !== 'attendee';
    const moderator = identity.role === 'moderator';
    return {
      status: this.status,
      recordingStatus: this.recordingStatus,
      floorActive: this.speakers.size > 0,
      polls: [...this.polls.values()].map((entry) => entry.poll).filter((poll) => identity.role === 'moderator' || poll.openedAt !== null),
      results: [...this.polls.values()].filter((entry) => entry.poll.closedAt !== null).map((entry) => this.results(entry.poll.id)),
      publicMessages: all.filter((m) => m.status === 'published' || m.status === 'answered').map(toPublic),
      ...(identity.role === 'moderator' ? { moderationMessages: all } : {}),
      ...(host
        ? {
            attendanceCount: this.attendance,
            handCount: this.hands.size,
            speakers: [...this.speakers].map(([participantId, speaker]) => ({
              participantId,
              name: moderator ? speaker.name : null,
              muted: speaker.muted,
              unmuteRequested: false,
            })),
            // A presenter gets the raised hands without names (WBN-25.1, D-CW-15).
            hands: [...this.hands].map(([participantId, hand]) => ({ participantId, name: moderator ? hand.name : null, raisedAt: hand.raisedAt })),
          }
        : identity.participantId && this.hands.has(identity.participantId)
          ? { myHand: { raised: true, raisedAt: this.hands.get(identity.participantId)?.raisedAt ?? null } }
          : {}),
    };
  }

  transportFor(identity: FakeWebinarIdentity): WebinarTransport {
    return {
      subscribe: (room, handler) => {
        // As the API: the moderation room admits moderators only (names), the hosts' room presenters and moderators.
        if (room === this.moderationRoom && identity.role !== 'moderator') return () => undefined;
        if (room === this.hostsRoom && identity.role === 'attendee') return () => undefined;
        if (identity.participantId && identity.name) this.names.set(identity.participantId, identity.name);
        const subscription: Subscription = { room, handler, identity };
        this.subscriptions.add(subscription);
        return () => {
          this.subscriptions.delete(subscription);
        };
      },
      post: async <A extends WebinarAction>(action: A, input: WebinarActionInputs[A]) => {
        this.requests.push({ action, input: structuredClone(input), from: identity });
        await wait(this.delayMs);
        const failure = this.failures.get(action);
        if (failure) {
          this.failures.delete(action);
          throw apiError(failure);
        }
        if (MODERATOR_ACTIONS.has(action) && identity.role !== 'moderator') throw apiError('not_found');
        if (HOST_ACTIONS.has(action) && identity.role === 'attendee') throw apiError('not_found');
        return this.handle(action, input, identity);
      },
    };
  }

  private emit(room: string, event: FakeEventName, payload: unknown, to?: string): void {
    this.schemaFor(room, event).parse(payload);
    this.emitted.push({ room, event, payload, ...(to ? { to } : {}) });
    for (const subscription of [...this.subscriptions]) {
      if (subscription.room !== room) continue;
      if (to !== undefined && subscription.identity.participantId !== to) continue;
      subscription.handler(event, structuredClone(payload));
    }
  }

  /** The contract schema of `event` on `room`: the hosts' room and the T-CW-2.3 additions have their own. */
  private schemaFor(room: string, event: FakeEventName) {
    if (room === this.hostsRoom) {
      if (event in WEBINAR_FLOOR_MUTE_HOSTS_EVENT_PAYLOAD_SCHEMAS) {
        return WEBINAR_FLOOR_MUTE_HOSTS_EVENT_PAYLOAD_SCHEMAS[event as keyof typeof WEBINAR_FLOOR_MUTE_HOSTS_EVENT_PAYLOAD_SCHEMAS];
      }
      return WEBINAR_HOSTS_ROOM_EVENT_PAYLOAD_SCHEMAS[event as WebinarHostsRoomEventName];
    }
    // The attendee's own room (delivered with the public room): the WBN-26 events carry `{}`.
    if (event === 'webinar.floor.muted' || event === 'webinar.floor.unmute_requested') return WEBINAR_FLOOR_MUTE_PARTICIPANT_EVENT_PAYLOAD_SCHEMAS[event];
    if (event in WEBINAR_ROOM_ADDED_EVENT_PAYLOAD_SCHEMAS) return WEBINAR_ROOM_ADDED_EVENT_PAYLOAD_SCHEMAS[event as WebinarRoomAddedEventName];
    if (event in WEBINAR_MODERATION_ROOM_ADDED_EVENT_PAYLOAD_SCHEMAS) {
      return WEBINAR_MODERATION_ROOM_ADDED_EVENT_PAYLOAD_SCHEMAS[event as WebinarModerationRoomAddedEventName];
    }
    return ROOM_EVENT_PAYLOAD_SCHEMAS[event as WebinarEventName];
  }

  /** As the API: the count and the participant ids, oldest first, never names (WBN-25.1). */
  private handCount(): void {
    const hands = [...this.hands]
      .map(([participantId, hand]) => ({ participantId, raisedAt: hand.raisedAt }))
      .sort((a, b) => a.raisedAt.localeCompare(b.raisedAt));
    this.emit(this.hostsRoom, 'webinar.hand.count', { count: this.hands.size, hands });
  }

  private results(pollId: string): WebinarPollResults {
    const entry = this.polls.get(pollId);
    const results = entry ? [...entry.counts].map(([optionId, count]) => ({ optionId, count })) : [];
    return { pollId, totalVotes: results.reduce((sum, r) => sum + r.count, 0), results };
  }

  private submit(identity: FakeWebinarIdentity, kind: Exclude<WebinarMessageKind, 'host'>, text: string, showFirstName: boolean): WebinarModerationMessage {
    const message: WebinarModerationMessage = {
      id: this.id('message'),
      webinarId: this.webinarId,
      kind,
      status: 'pending',
      text,
      authorFirstName: showFirstName ? firstName(identity.name) : null,
      answerText: null,
      publishedAt: null,
      createdAt: now(),
      authorParticipantId: identity.participantId ?? null,
      authorName: identity.name ?? 'Participant (sample)',
      showFirstName,
    };
    this.messages.set(message.id, message);
    this.emit(this.moderationRoom, 'webinar.message.submitted', message);
    return message;
  }

  private postHost(identity: FakeWebinarIdentity, text: string): WebinarModerationMessage {
    const at = now();
    const message: WebinarModerationMessage = {
      id: this.id('message'),
      webinarId: this.webinarId,
      kind: 'host',
      status: 'published',
      text,
      authorFirstName: identity.name ?? null,
      answerText: null,
      publishedAt: at,
      createdAt: at,
      authorParticipantId: identity.participantId ?? null,
      authorName: null,
      showFirstName: false,
    };
    this.messages.set(message.id, message);
    this.emit(this.room, 'webinar.message.published', toPublic(message));
    return message;
  }

  private change(messageId: string, patch: Partial<WebinarModerationMessage>): WebinarModerationMessage {
    const message = this.messages.get(messageId);
    if (!message) throw apiError('not_found');
    const next = { ...message, ...patch };
    this.messages.set(messageId, next);
    return next;
  }

  private raise(participantId: string, name: string): string {
    const raisedAt = now();
    this.hands.set(participantId, { name, raisedAt });
    this.names.set(participantId, name);
    this.emit(this.moderationRoom, 'webinar.hand.raised', { participantId, participantName: name, raisedAt });
    this.handCount();
    return raisedAt;
  }

  private lower(participantId: string): void {
    if (!this.hands.delete(participantId)) return;
    this.emit(this.moderationRoom, 'webinar.hand.lowered', { participantId });
    this.handCount();
  }

  /**
   * As the API: giving the floor lowers the hand, then the attendee's own
   * room gets the floor event, the audience the anonymous flag and the hosts
   * the holder's participant id.
   */
  private floor(participantId: string, given: boolean) {
    const capabilities = { audio: given ? ('send_receive' as const) : ('receive' as const), video: 'receive' as const, content: 'receive' as const };
    if (given) {
      this.lower(participantId);
      this.speakers.set(participantId, { name: this.names.get(participantId) ?? null, muted: false });
    } else {
      this.speakers.delete(participantId);
    }
    // A replica attendee gets sample primary-meeting credentials to promote with; the API sends real ones (T-CW-3.2).
    const primaryAttendee =
      given && this.replicated
        ? { AttendeeId: this.id('primary-attendee'), ExternalUserId: participantId, JoinToken: this.id('join-token') }
        : undefined;
    this.emit(
      this.room,
      given ? 'webinar.floor.given' : 'webinar.floor.taken',
      { participantId, capabilities, ...(primaryAttendee ? { primaryAttendee } : {}) },
      participantId,
    );
    this.emit(this.room, 'webinar.floor.state', { active: this.speakers.size > 0 });
    this.emit(this.hostsRoom, 'webinar.floor.state', { active: given, participantId });
    return { participantId, hasFloor: given, capabilities };
  }

  private endWebinar(): void {
    this.status = 'ended';
    if (this.recordingStatus === 'recording') this.recordingStatus = 'processing';
    this.speakers.clear();
    const payload = { webinarId: this.webinarId, endedAt: now() };
    this.emit(this.room, 'webinar.ended', payload);
    this.emit(this.moderationRoom, 'webinar.ended', payload);
  }

  private openPoll(pollId: string): WebinarPoll {
    const entry = this.polls.get(pollId);
    if (!entry) throw apiError('not_found');
    entry.poll = { ...entry.poll, openedAt: now(), closedAt: null };
    this.emit(this.room, 'webinar.poll.opened', entry.poll);
    return entry.poll;
  }

  private closePoll(pollId: string): WebinarPollResults {
    const entry = this.polls.get(pollId);
    if (!entry) throw apiError('not_found');
    const closedAt = now();
    entry.poll = { ...entry.poll, closedAt };
    this.emit(this.room, 'webinar.poll.closed', { pollId, closedAt });
    const results = this.results(pollId);
    this.emit(this.room, 'webinar.poll.results', results);
    return results;
  }

  private setRecording(status: 'started' | 'stopped' | 'ready' | 'failed'): void {
    if (status === 'started') this.recordingStartedAt = now();
    this.recordingStatus = { started: 'recording', stopped: 'processing', ready: 'ready', failed: 'failed' }[status] as RecordingStatus;
    this.emit(this.room, 'webinar.recording', { webinarId: this.webinarId, status });
    if (status === 'failed') this.emit(this.moderationRoom, 'webinar.recording.failed', { webinarId: this.webinarId, reason: 'SamplePipelineFailure' });
  }

  private handle(action: WebinarAction, rawInput: unknown, identity: FakeWebinarIdentity): unknown {
    switch (action) {
      case 'message.send': {
        const { body } = rawInput as WebinarActionInputs['message.send'];
        if (body.kind === 'host') {
          const message = this.postHost(identity, body.text);
          return identity.role === 'moderator' ? message : toPublic(message);
        }
        return toPublic(this.submit(identity, body.kind, body.text, body.showFirstName));
      }
      case 'message.publish': {
        const { messageId, body } = rawInput as WebinarActionInputs['message.publish'];
        const message = this.change(messageId, { status: 'published', publishedAt: now(), ...(body.text ? { text: body.text } : {}) });
        this.emit(this.room, 'webinar.message.published', toPublic(message));
        return message;
      }
      case 'message.answer': {
        const { messageId, body } = rawInput as WebinarActionInputs['message.answer'];
        const existing = this.messages.get(messageId);
        const message = this.change(messageId, { status: 'answered', answerText: body.answerText, publishedAt: existing?.publishedAt ?? now() });
        this.emit(this.room, 'webinar.message.answered', toPublic(message));
        return message;
      }
      case 'message.dismiss': {
        const { messageId } = rawInput as WebinarActionInputs['message.dismiss'];
        const wasPublic = ['published', 'answered'].includes(this.messages.get(messageId)?.status ?? '');
        const message = this.change(messageId, { status: 'dismissed', answerText: null });
        if (wasPublic) this.emit(this.room, 'webinar.message.removed', { messageId });
        return message;
      }
      case 'hand.raise': {
        if (!identity.participantId) throw apiError('not_found');
        const raisedAt = this.raise(identity.participantId, identity.name ?? 'Participant (sample)');
        return { raised: true, raisedAt };
      }
      case 'hand.lower':
        if (identity.participantId) this.lower(identity.participantId);
        return { raised: false, raisedAt: null };
      case 'floor.give':
        return this.floor((rawInput as WebinarActionInputs['floor.give']).participantId, true);
      case 'floor.take':
        return this.floor((rawInput as WebinarActionInputs['floor.take']).participantId, false);
      case 'poll.open':
        return this.openPoll((rawInput as WebinarActionInputs['poll.open']).pollId);
      case 'poll.close':
        return this.closePoll((rawInput as WebinarActionInputs['poll.close']).pollId);
      case 'poll.vote': {
        const { pollId, body } = rawInput as WebinarActionInputs['poll.vote'];
        const entry = this.polls.get(pollId);
        if (!entry || !entry.poll.openedAt || entry.poll.closedAt || !entry.counts.has(body.optionId)) throw apiError('validation');
        // Only the aggregate changes: the vote is not linked to the voter (D-CW-16).
        entry.counts.set(body.optionId, (entry.counts.get(body.optionId) ?? 0) + 1);
        return { pollId, voted: true };
      }
      case 'recording.stop': {
        if (this.recordingStatus !== 'recording') throw apiError('recording_not_allowed');
        this.setRecording('stopped');
        return { webinarId: this.webinarId, status: this.recordingStatus, startedAt: this.recordingStartedAt, stoppedAt: now() };
      }
      case 'floor.mute': {
        // WBN-26: the attendee's own room gets the mute, the hosts the muted row.
        const { participantId } = rawInput as WebinarActionInputs['floor.mute'];
        const speaker = this.speakers.get(participantId);
        if (!speaker) throw apiError('floor_not_available');
        speaker.muted = true;
        this.emit(this.room, 'webinar.floor.muted', {}, participantId);
        this.emit(this.hostsRoom, 'webinar.floor.muted', { participantId });
        return { participantId, hasFloor: true, muted: true, capabilities: { audio: 'receive', video: 'receive', content: 'receive' } };
      }
      case 'floor.unmuteRequest': {
        const { participantId } = rawInput as WebinarActionInputs['floor.unmuteRequest'];
        if (!this.speakers.get(participantId)?.muted) throw apiError('floor_not_available');
        this.emit(this.room, 'webinar.floor.unmute_requested', {}, participantId);
        return { participantId, requested: true };
      }
      case 'floor.unmute': {
        // Only the attendee themselves consents to unmute.
        const { participantId } = rawInput as WebinarActionInputs['floor.unmute'];
        const speaker = this.speakers.get(participantId);
        if (identity.participantId !== participantId || !speaker) throw apiError('not_found');
        speaker.muted = false;
        this.emit(this.hostsRoom, 'webinar.floor.unmuted', { participantId });
        // A replica attendee comes back on the primary meeting with fresh sample credentials (T-CW-3.2).
        const primaryAttendee = this.replicated
          ? { AttendeeId: this.id('primary-attendee'), ExternalUserId: participantId, JoinToken: this.id('join-token') }
          : undefined;
        return {
          participantId,
          hasFloor: true,
          muted: false,
          capabilities: { audio: 'send_receive', video: 'receive', content: 'receive' },
          ...(primaryAttendee ? { primaryAttendee } : {}),
        };
      }
      case 'webinar.end': {
        if (this.status !== 'live') throw apiError('webinar_not_open');
        this.endWebinar();
        return { webinarId: this.webinarId, status: this.status };
      }
    }
  }

  /** Scripted server-side happenings for stories and tests. */
  readonly simulate = {
    /** A host started the webinar: `webinar.state` live, then the recording starts (WBN-17, WBN-28). */
    start: () => {
      this.status = 'live';
      this.emit(this.room, 'webinar.state', { webinarId: this.webinarId, status: 'live' });
      this.setRecording('started');
    },
    recording: (status: 'started' | 'stopped' | 'ready' | 'failed') => this.setRecording(status),
    /** `webinar.ended` on both rooms (guidelines 4.8). */
    end: () => this.endWebinar(),
    /** Attendees joined or left: the moderation and hosts' rooms get the new count, a number only (WBN-19). */
    attendance: (delta: number) => {
      this.attendance = Math.max(0, this.attendance + delta);
      const payload = { webinarId: this.webinarId, count: this.attendance };
      this.emit(this.moderationRoom, 'webinar.attendance.count', payload);
      this.emit(this.hostsRoom, 'webinar.attendance.count', payload);
    },
    /** An attendee wrote to the hosts. */
    attendeeMessage: (from: { participantId: string; name: string }, text: string, options: { kind?: 'attendee' | 'question'; showFirstName?: boolean } = {}) =>
      this.submit({ role: 'attendee', ...from }, options.kind ?? 'attendee', text, options.showFirstName ?? false),
    /** A host posted to everyone. */
    hostMessage: (name: string, text: string) => this.postHost({ role: 'presenter', name }, text),
    /** A host dismissed a message; a published one leaves the public chat. */
    dismiss: (messageId: string) => this.handle('message.dismiss', { messageId, body: {} }, { role: 'moderator' }),
    publish: (messageId: string) => {
      const message = this.change(messageId, { status: 'published', publishedAt: now() });
      this.emit(this.room, 'webinar.message.published', toPublic(message));
    },
    handRaised: (participantId: string, name: string) => this.raise(participantId, name),
    handLowered: (participantId: string) => this.lower(participantId),
    floorGiven: (participantId: string) => this.floor(participantId, true),
    floorTaken: (participantId: string) => this.floor(participantId, false),
    openPoll: (pollId: string) => this.openPoll(pollId),
    closePoll: (pollId: string) => this.closePoll(pollId),
    /** Another attendee voted; only the aggregate moves. */
    vote: (pollId: string, optionId: string) => {
      const entry = this.polls.get(pollId);
      entry?.counts.set(optionId, (entry.counts.get(optionId) ?? 0) + 1);
    },
    /** The next request of this action fails with this API error code. */
    failNext: (action: WebinarAction, code: string) => {
      this.failures.set(action, code);
    },
  };
}

export interface FakeWebinarClientOptions extends Omit<WebinarClientOptions, 'transport' | 'webinarId'> {
  server?: FakeWebinarServer;
  /** The registration name (attendee) or display name (host) the fake server attaches. */
  name?: string | null;
}

/** A real `WebinarClient` on a `FakeWebinarServer`; several clients can share one server. */
export class FakeWebinarClient extends WebinarClient {
  readonly server: FakeWebinarServer;

  constructor(options: FakeWebinarClientOptions) {
    const server = options.server ?? new FakeWebinarServer();
    const participantId = options.participantId ?? (options.role === 'attendee' ? server.nextParticipantId() : null);
    const identity: FakeWebinarIdentity = { role: options.role, participantId, name: options.name ?? null };
    super({
      ...options,
      participantId,
      webinarId: server.webinarId,
      transport: server.transportFor(identity),
      initial: { ...server.initialFor(identity), ...options.initial },
    });
    this.server = server;
  }

  /** The server's scripted happenings. */
  get simulate(): FakeWebinarServer['simulate'] {
    return this.server.simulate;
  }
}
