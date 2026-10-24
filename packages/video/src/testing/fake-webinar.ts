/**
 * An in-memory webinar for stories, unit tests and the apps' sample mode
 * (T-CW-2.3). `FakeWebinarServer` plays the API and the two Socket.IO rooms:
 * it answers the client's actions, keeps messages, hands, polls and the
 * recording state, and emits the contract events (validated with
 * `ROOM_EVENT_PAYLOAD_SCHEMAS` before they leave, so a malformed fake event
 * fails loudly). `FakeWebinarClient` is a real `WebinarClient` on a transport
 * of that server, so several clients (an attendee and a moderator) can share
 * one webinar. Nothing reaches a network, and votes are counted without a
 * voter, as on the server (D-CW-16).
 */
import { ROOM_EVENT_PAYLOAD_SCHEMAS, webinarModerationRoomName, webinarRoomName } from '@nestself/contracts';
import type {
  RecordingStatus,
  WebinarEventName,
  WebinarMessage,
  WebinarMessageKind,
  WebinarModerationMessage,
  WebinarPoll,
  WebinarPollResults,
  WebinarStatus,
} from '@nestself/contracts';
import { WebinarClient } from '../webinar/client';
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
}

export interface FakeWebinarEmission {
  room: string;
  event: WebinarEventName;
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

const HOST_ACTIONS: ReadonlySet<WebinarAction> = new Set<WebinarAction>(['floor.give', 'floor.take']);
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
  private readonly failures = new Map<WebinarAction, string>();
  private readonly delayMs: number;
  private status: WebinarStatus;
  private recordingStatus: RecordingStatus = 'scheduled';
  private recordingStartedAt: string | null = null;
  private attendance = 0;
  private nextId = 1;

  constructor(options: FakeWebinarServerOptions = {}) {
    this.webinarId = options.webinarId ?? 'sample-webinar';
    this.status = options.status ?? 'published';
    this.delayMs = options.delayMs ?? 0;
    for (const poll of options.polls ?? []) this.addPoll(poll);
  }

  private get room(): string {
    return webinarRoomName(this.webinarId);
  }

  private get moderationRoom(): string {
    return webinarModerationRoomName(this.webinarId);
  }

  private id(prefix: string): string {
    return `sample-${prefix}-${this.nextId++}`;
  }

  /** A participant id the server hands out, as `POST /webinars/:id/join` would. */
  nextParticipantId(): string {
    return this.id('participant');
  }

  addPoll(poll: WebinarPoll): void {
    this.polls.set(poll.id, { poll, counts: new Map(poll.options.map((option) => [option.id, 0])) });
  }

  /** The state a client of this identity would load on entering (`GET /webinars/:id`, messages, polls). */
  initialFor(identity: FakeWebinarIdentity): WebinarInitialState {
    const all = [...this.messages.values()];
    const host = identity.role !== 'attendee';
    return {
      status: this.status,
      recordingStatus: this.recordingStatus,
      polls: [...this.polls.values()].map((entry) => entry.poll).filter((poll) => identity.role === 'moderator' || poll.openedAt !== null),
      results: [...this.polls.values()].filter((entry) => entry.poll.closedAt !== null).map((entry) => this.results(entry.poll.id)),
      publicMessages: all.filter((m) => m.status === 'published' || m.status === 'answered').map(toPublic),
      ...(identity.role === 'moderator' ? { moderationMessages: all } : {}),
      ...(host
        ? {
            attendanceCount: this.attendance,
            hands: [...this.hands].map(([participantId, hand]) => ({ participantId, name: hand.name, raisedAt: hand.raisedAt })),
          }
        : identity.participantId && this.hands.has(identity.participantId)
          ? { myHand: { raised: true, raisedAt: this.hands.get(identity.participantId)?.raisedAt ?? null } }
          : {}),
    };
  }

  transportFor(identity: FakeWebinarIdentity): WebinarTransport {
    return {
      subscribe: (room, handler) => {
        // The moderation room needs `event.moderate`: an attendee's subscription is refused.
        if (room === this.moderationRoom && identity.role === 'attendee') return () => undefined;
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

  private emit(room: string, event: WebinarEventName, payload: unknown, to?: string): void {
    ROOM_EVENT_PAYLOAD_SCHEMAS[event].parse(payload);
    this.emitted.push({ room, event, payload, ...(to ? { to } : {}) });
    for (const subscription of [...this.subscriptions]) {
      if (subscription.room !== room) continue;
      if (to !== undefined && subscription.identity.participantId !== to) continue;
      subscription.handler(event, structuredClone(payload));
    }
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
    this.emit(this.moderationRoom, 'webinar.hand.raised', { participantId, participantName: name, raisedAt });
    return raisedAt;
  }

  private lower(participantId: string): void {
    if (!this.hands.delete(participantId)) return;
    this.emit(this.moderationRoom, 'webinar.hand.lowered', { participantId });
  }

  private floor(participantId: string, given: boolean) {
    const capabilities = { audio: given ? ('send_receive' as const) : ('receive' as const), video: 'receive' as const, content: 'receive' as const };
    this.emit(this.room, given ? 'webinar.floor.given' : 'webinar.floor.taken', { participantId, capabilities }, participantId);
    return { participantId, hasFloor: given, capabilities };
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

  private setRecording(status: 'started' | 'stopped'): void {
    if (status === 'started') {
      this.recordingStatus = 'recording';
      this.recordingStartedAt = now();
    } else {
      this.recordingStatus = 'processing';
    }
    this.emit(this.room, 'webinar.recording', { webinarId: this.webinarId, status });
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
        return this.change(messageId, { status: 'dismissed', answerText: null });
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
    recording: (status: 'started' | 'stopped') => this.setRecording(status),
    /** `webinar.ended` on both rooms (guidelines 4.8). */
    end: () => {
      this.status = 'ended';
      if (this.recordingStatus === 'recording') this.recordingStatus = 'processing';
      const payload = { webinarId: this.webinarId, endedAt: now() };
      this.emit(this.room, 'webinar.ended', payload);
      this.emit(this.moderationRoom, 'webinar.ended', payload);
    },
    /** Attendees joined or left: the moderation room gets the new count, a number only (WBN-19). */
    attendance: (delta: number) => {
      this.attendance = Math.max(0, this.attendance + delta);
      this.emit(this.moderationRoom, 'webinar.attendance.count', { webinarId: this.webinarId, count: this.attendance });
    },
    /** An attendee wrote to the hosts. */
    attendeeMessage: (from: { participantId: string; name: string }, text: string, options: { kind?: 'attendee' | 'question'; showFirstName?: boolean } = {}) =>
      this.submit({ role: 'attendee', ...from }, options.kind ?? 'attendee', text, options.showFirstName ?? false),
    /** A host posted to everyone. */
    hostMessage: (name: string, text: string) => this.postHost({ role: 'presenter', name }, text),
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
