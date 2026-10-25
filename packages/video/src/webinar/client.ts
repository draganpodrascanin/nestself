/**
 * `WebinarClient`: the framework-agnostic state of a live webinar (T-CW-2.3).
 * It joins `webinar:{webinarId}` (everyone), `webinar:{webinarId}:hosts`
 * (presenters and moderators: counts and the floor holder's id) and
 * `webinar:{webinarId}:moderation` (moderators: names) through an injected
 * `WebinarTransport`, validates every room event with the contract's payload
 * schemas for that room, applies it to an immutable snapshot and performs
 * the chat, hand, floor, poll, recording and end actions.
 *
 * Besides the section 7 events it accepts the two canonical additions of
 * T-CW-2.3 on the public room: `webinar.message.removed` (a published message
 * a host dismissed leaves the chat) and `webinar.floor.state` (an anonymous
 * flag: some attendee has the floor).
 *
 * Role rules held here, on top of the server's (D-CW-15, D-CW-35, WBN-08):
 * - an attendee's state never holds a roster, a name, a hand list or a count;
 *   moderation-room events reaching an attendee client are dropped;
 * - a presenter never joins the moderation room: they get the hand count
 *   and the floor holder's id from the hosts' room, never a name (WBN-10,
 *   WBN-20), and see only published and answered messages;
 * - the floor is audio only: `webinar.floor.given` for this participant calls
 *   `setAudioCapability(true)` and stays muted until the attendee unmutes;
 *   `webinar.floor.taken` mutes and calls `setAudioCapability(false)`. The
 *   client has no other media surface, so it cannot turn a camera on.
 */
import {
  ROOM_EVENT_PAYLOAD_SCHEMAS,
  WEBINAR_HOSTS_ROOM_EVENT_NAMES,
  WEBINAR_HOSTS_ROOM_EVENT_PAYLOAD_SCHEMAS,
  WEBINAR_MODERATION_ROOM_ADDED_EVENT_NAMES,
  WEBINAR_MODERATION_ROOM_ADDED_EVENT_PAYLOAD_SCHEMAS,
  WEBINAR_MODERATION_ROOM_EVENT_NAMES,
  WEBINAR_PARTICIPANT_EVENT_NAMES,
  WEBINAR_ROOM_ADDED_EVENT_NAMES,
  WEBINAR_ROOM_ADDED_EVENT_PAYLOAD_SCHEMAS,
  WEBINAR_ROOM_EVENT_NAMES,
  WebinarFloorResponseSchema,
  WebinarHandRaiseResponseSchema,
  WebinarMessageAnswerRequestSchema,
  WebinarMessageCreateRequestSchema,
  WebinarMessagePublishRequestSchema,
  WebinarMessageSchema,
  WebinarModerationMessageSchema,
  WebinarRecordingStatusResponseSchema,
  webinarHostsRoomName,
  webinarModerationRoomName,
  webinarRoomName,
} from '@nestself/contracts';
import type {
  WebinarEventName,
  WebinarEventPayloads,
  WebinarHostsRoomEventName,
  WebinarHostsRoomEventPayloads,
  WebinarJoinResponse,
  WebinarModerationRoomAddedEventName,
  WebinarMessage,
  WebinarMessageCreateRequest,
  WebinarModerationMessage,
  WebinarPoll,
  WebinarRoomAddedEventName,
  WebinarRoomAddedEventPayloads,
} from '@nestself/contracts';
import { WebinarActionError, toWebinarActionError } from './errors';
import type {
  WebinarAction,
  WebinarActionArea,
  WebinarActionInputs,
  WebinarAudioControl,
  WebinarClientApi,
  WebinarHand,
  WebinarInitialState,
  WebinarSnapshot,
  WebinarSpeaker,
  WebinarTransport,
  WebinarViewerRole,
} from './types';

export interface WebinarClientOptions {
  webinarId: string;
  role: WebinarViewerRole;
  transport: WebinarTransport;
  /** The caller's `call_participants.id` from the join response; attendees need it for the floor events. */
  participantId?: string | null;
  /** The call controller (`CallSessionController`): audio capability and mute for the floor. */
  audio?: WebinarAudioControl | null;
  /**
   * Join the moderation room. Defaults to true for the moderator only: the
   * room carries registration names (D-CW-15), and the server admits
   * moderators and moderating principals only (`event.moderate`). Presenters
   * and moderators always join the hosts' room.
   */
  moderationRoom?: boolean;
  initial?: WebinarInitialState;
}

type ClientEventName = WebinarEventName | WebinarRoomAddedEventName | WebinarModerationRoomAddedEventName;

const PUBLIC_EVENTS: ReadonlySet<string> = new Set<string>([
  ...WEBINAR_ROOM_EVENT_NAMES,
  ...WEBINAR_ROOM_ADDED_EVENT_NAMES,
  ...WEBINAR_PARTICIPANT_EVENT_NAMES,
]);
/** Every payload schema the client validates against: the contract's room events and the T-CW-2.3 additions. */
const PAYLOAD_SCHEMAS = { ...ROOM_EVENT_PAYLOAD_SCHEMAS, ...WEBINAR_ROOM_ADDED_EVENT_PAYLOAD_SCHEMAS, ...WEBINAR_MODERATION_ROOM_ADDED_EVENT_PAYLOAD_SCHEMAS };

/** The `webinar.recording` event status as the snapshot's recording status. */
const RECORDING_STATUS_BY_EVENT = { started: 'recording', stopped: 'processing', ready: 'ready', failed: 'failed' } as const;
const MODERATION_EVENTS: ReadonlySet<string> = new Set<string>([
  ...WEBINAR_MODERATION_ROOM_EVENT_NAMES,
  ...WEBINAR_MODERATION_ROOM_ADDED_EVENT_NAMES,
  'webinar.ended',
]);
const HOSTS_EVENTS: ReadonlySet<string> = new Set<string>(WEBINAR_HOSTS_ROOM_EVENT_NAMES);

const now = () => new Date().toISOString();

const messageOrder = (message: { publishedAt: string | null; createdAt: string; id: string }) => message.publishedAt ?? message.createdAt;

function sortMessages<T extends { publishedAt: string | null; createdAt: string; id: string }>(list: T[], key: (message: T) => string): T[] {
  return list.sort((a, b) => key(a).localeCompare(key(b)) || a.id.localeCompare(b.id));
}

/** The public projection of a moderation message: the registration name and participant id stay behind. */
function toPublicMessage(message: WebinarModerationMessage | WebinarMessage): WebinarMessage {
  return {
    id: message.id,
    webinarId: message.webinarId,
    kind: message.kind,
    status: message.status,
    text: message.text,
    authorFirstName: message.authorFirstName,
    answerText: message.answerText,
    publishedAt: message.publishedAt,
    createdAt: message.createdAt,
  };
}

function isVisible(message: WebinarMessage): boolean {
  return message.status === 'published' || message.status === 'answered';
}

function emptySnapshot(options: WebinarClientOptions): WebinarSnapshot {
  return {
    webinarId: options.webinarId,
    role: options.role,
    participantId: options.participantId ?? null,
    connected: false,
    status: 'published',
    endedAt: null,
    attendanceCount: null,
    recording: { status: null },
    publicMessages: [],
    moderationMessages: [],
    ownMessageIds: [],
    hands: [],
    handCount: null,
    speakers: [],
    polls: { list: [], results: {}, votes: {} },
    myHand: { raised: false, raisedAt: null },
    myFloor: { status: 'none', acknowledged: false },
    floorActive: false,
    pending: [],
    errors: {},
  };
}

export class WebinarClient implements WebinarClientApi {
  private snapshot: WebinarSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly transport: WebinarTransport;
  private readonly audio: WebinarAudioControl | null;
  private readonly moderationRoom: boolean;
  private connections = 0;
  private unsubscribers: Array<() => void> = [];
  /**
   * The moderator's registration names by participant id (from raised hands
   * and messages), so a speaker keeps the name after the hand is lowered.
   * Never filled for anyone else.
   */
  private readonly names = new Map<string, string>();

  constructor(options: WebinarClientOptions) {
    this.transport = options.transport;
    this.audio = options.audio ?? null;
    this.moderationRoom = options.moderationRoom ?? options.role === 'moderator';
    this.snapshot = emptySnapshot(options);
    if (options.initial) this.hydrate(options.initial);
  }

  getSnapshot = (): WebinarSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private get isHost(): boolean {
    return this.snapshot.role !== 'attendee';
  }

  private get isModerator(): boolean {
    return this.snapshot.role === 'moderator';
  }

  private update(patch: Partial<WebinarSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  // -------------------------------------------------------------------------
  // Rooms
  // -------------------------------------------------------------------------

  connect = (): (() => void) => {
    this.connections += 1;
    if (this.connections === 1) {
      const { webinarId } = this.snapshot;
      this.unsubscribers = [this.transport.subscribe(webinarRoomName(webinarId), (event, payload) => this.receive('public', event, payload))];
      if (this.isHost) {
        this.unsubscribers.push(this.transport.subscribe(webinarHostsRoomName(webinarId), (event, payload) => this.receiveHosts(event, payload)));
      }
      if (this.isHost && this.moderationRoom) {
        this.unsubscribers.push(
          this.transport.subscribe(webinarModerationRoomName(webinarId), (event, payload) => this.receive('moderation', event, payload)),
        );
      }
      this.update({ connected: true });
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.connections -= 1;
      if (this.connections === 0) this.teardown();
    };
  };

  private teardown(): void {
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    if (this.snapshot.connected) this.update({ connected: false });
  }

  destroy(): void {
    this.connections = 0;
    this.teardown();
    this.listeners.clear();
  }

  /** Validates an incoming event against its room and its contract schema, then applies it. */
  private receive(room: 'public' | 'moderation', event: string, payload: unknown): void {
    const allowed = room === 'public' ? PUBLIC_EVENTS : MODERATION_EVENTS;
    if (!allowed.has(event)) return;
    // Names never reach anyone but the moderator, whatever a transport delivers (D-CW-15).
    if (room === 'moderation' && !this.isModerator) return;
    const schema = PAYLOAD_SCHEMAS[event as ClientEventName];
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return;
    const data = parsed.data as { webinarId?: string };
    if (data.webinarId !== undefined && data.webinarId !== this.snapshot.webinarId) return;
    this.apply(event as ClientEventName, parsed.data);
  }

  /** The hosts' room: counts and the floor holder's participant id, validated with that room's schemas. */
  private receiveHosts(event: string, payload: unknown): void {
    if (!this.isHost || !HOSTS_EVENTS.has(event)) return;
    const parsed = WEBINAR_HOSTS_ROOM_EVENT_PAYLOAD_SCHEMAS[event as WebinarHostsRoomEventName].safeParse(payload);
    if (!parsed.success) return;
    const data = parsed.data as { webinarId?: string };
    if (data.webinarId !== undefined && data.webinarId !== this.snapshot.webinarId) return;
    switch (event as WebinarHostsRoomEventName) {
      case 'webinar.attendance.count':
        this.update({ attendanceCount: (parsed.data as WebinarHostsRoomEventPayloads['webinar.attendance.count']).count });
        return;
      case 'webinar.hand.count':
        this.update({ handCount: (parsed.data as WebinarHostsRoomEventPayloads['webinar.hand.count']).count });
        return;
      case 'webinar.floor.state':
        this.applyFloorHolder(parsed.data as WebinarHostsRoomEventPayloads['webinar.floor.state']);
        return;
    }
  }

  /** Any host can take the floor back after a reload: the speakers come from the hosts' room (WBN-25). */
  private applyFloorHolder({ active, participantId }: WebinarHostsRoomEventPayloads['webinar.floor.state']): void {
    const speakers = this.snapshot.speakers;
    let next: readonly WebinarSpeaker[] = speakers;
    if (participantId === undefined) {
      if (!active) next = [];
    } else if (active) {
      if (!speakers.some((entry) => entry.participantId === participantId)) {
        next = [...speakers, { participantId, name: this.nameOf(participantId) }];
      }
    } else {
      next = speakers.filter((entry) => entry.participantId !== participantId);
    }
    this.update({ floorActive: active || next.length > 0, ...(next === speakers ? {} : { speakers: next }) });
  }

  private apply(event: ClientEventName, payload: unknown): void {
    switch (event) {
      case 'webinar.message.removed': {
        const { messageId } = payload as WebinarRoomAddedEventPayloads['webinar.message.removed'];
        if (this.snapshot.publicMessages.some((entry) => entry.id === messageId)) {
          this.update({ publicMessages: this.snapshot.publicMessages.filter((entry) => entry.id !== messageId) });
        }
        if (this.isModerator) this.patchModeration(messageId, { status: 'dismissed', answerText: null });
        return;
      }
      case 'webinar.floor.state': {
        const { active } = payload as WebinarRoomAddedEventPayloads['webinar.floor.state'];
        if (active !== this.snapshot.floorActive) this.update({ floorActive: active });
        return;
      }
      case 'webinar.state': {
        const { status } = payload as WebinarEventPayloads['webinar.state'];
        if (status === 'ended') this.markEnded(now());
        else this.update({ status });
        return;
      }
      case 'webinar.ended':
        this.markEnded((payload as WebinarEventPayloads['webinar.ended']).endedAt);
        return;
      case 'webinar.recording': {
        const { status } = payload as WebinarEventPayloads['webinar.recording'];
        this.update({ recording: { status: RECORDING_STATUS_BY_EVENT[status] } });
        return;
      }
      case 'webinar.recording.failed':
        // CW-R-121: the moderators learn of the failure; the reason is for support and is never shown.
        this.update({ recording: { status: 'failed' } });
        return;
      case 'webinar.message.published':
      case 'webinar.message.answered': {
        const message = payload as WebinarMessage;
        this.upsertPublic(message);
        if (this.isModerator) this.patchModeration(message.id, toPublicMessage(message));
        return;
      }
      case 'webinar.poll.opened':
        this.upsertPoll(payload as WebinarPoll);
        return;
      case 'webinar.poll.closed': {
        const { pollId, closedAt } = payload as WebinarEventPayloads['webinar.poll.closed'];
        this.patchPoll(pollId, { closedAt });
        return;
      }
      case 'webinar.poll.results': {
        const results = payload as WebinarEventPayloads['webinar.poll.results'];
        this.update({ polls: { ...this.snapshot.polls, results: { ...this.snapshot.polls.results, [results.pollId]: results } } });
        return;
      }
      case 'webinar.floor.given':
        if (this.isMe((payload as WebinarEventPayloads['webinar.floor.given']).participantId)) void this.floorGiven();
        return;
      case 'webinar.floor.taken':
        if (this.isMe((payload as WebinarEventPayloads['webinar.floor.taken']).participantId)) void this.floorTaken();
        return;
      case 'webinar.message.submitted':
        if (this.isModerator) this.upsertModeration(payload as WebinarModerationMessage);
        return;
      case 'webinar.hand.raised': {
        const hand = payload as WebinarEventPayloads['webinar.hand.raised'];
        this.upsertHand({ participantId: hand.participantId, name: hand.participantName, raisedAt: hand.raisedAt });
        return;
      }
      case 'webinar.hand.lowered':
        this.removeHand((payload as WebinarEventPayloads['webinar.hand.lowered']).participantId);
        return;
      case 'webinar.attendance.count':
        this.update({ attendanceCount: (payload as WebinarEventPayloads['webinar.attendance.count']).count });
        return;
    }
  }

  private nameOf(participantId: string): string | null {
    return this.isModerator ? (this.names.get(participantId) ?? null) : null;
  }

  private rememberName(participantId: string | null, name: string | null): void {
    if (this.isModerator && participantId && name) this.names.set(participantId, name);
  }

  private isMe(participantId: string): boolean {
    return this.snapshot.role === 'attendee' && this.snapshot.participantId !== null && participantId === this.snapshot.participantId;
  }

  private markEnded(endedAt: string): void {
    const recording = this.snapshot.recording.status === 'recording' ? { status: 'processing' as const } : this.snapshot.recording;
    this.update({ status: 'ended', endedAt: this.snapshot.endedAt ?? endedAt, recording, floorActive: false, speakers: [] });
  }

  // -------------------------------------------------------------------------
  // Floor (audio only, D-CW-35)
  // -------------------------------------------------------------------------

  private async floorGiven(): Promise<void> {
    if (this.snapshot.myFloor.status === 'given') return;
    this.update({ myFloor: { status: 'given', acknowledged: false } });
    try {
      await this.audio?.setAudioCapability?.(true);
    } catch (error) {
      this.setError('floor', new WebinarActionError('floor.audio', 'microphone_unavailable', { cause: error }));
    }
  }

  private async floorTaken(): Promise<void> {
    if (this.snapshot.myFloor.status !== 'given') return;
    this.update({ myFloor: { status: 'taken', acknowledged: false } });
    try {
      this.audio?.setMuted(true);
      await this.audio?.setAudioCapability?.(false);
    } catch (error) {
      this.setError('floor', toWebinarActionError('floor.audio', error));
    }
  }

  acknowledgeFloor(): void {
    if (this.snapshot.myFloor.status !== 'given' || this.snapshot.myFloor.acknowledged) return;
    this.update({ myFloor: { status: 'given', acknowledged: true } });
  }

  dismissFloorNotice(): void {
    if (this.snapshot.myFloor.status !== 'taken') return;
    this.update({ myFloor: { status: 'none', acknowledged: false } });
  }

  // -------------------------------------------------------------------------
  // State helpers
  // -------------------------------------------------------------------------

  private upsertPublic(message: WebinarMessage): void {
    const rest = this.snapshot.publicMessages.filter((entry) => entry.id !== message.id);
    const next = isVisible(message) ? [...rest, toPublicMessage(message)] : rest;
    this.update({ publicMessages: sortMessages(next, messageOrder) });
  }

  private upsertModeration(message: WebinarModerationMessage): void {
    this.rememberName(message.authorParticipantId, message.authorName);
    const rest = this.snapshot.moderationMessages.filter((entry) => entry.id !== message.id);
    this.update({ moderationMessages: sortMessages([...rest, message], (entry) => entry.createdAt) });
  }

  private patchModeration(messageId: string, patch: Partial<WebinarModerationMessage>): void {
    const existing = this.snapshot.moderationMessages.find((entry) => entry.id === messageId);
    if (!existing) return;
    this.upsertModeration({ ...existing, ...patch });
  }

  private upsertHand(hand: WebinarHand): void {
    if (!this.isModerator) return;
    this.rememberName(hand.participantId, hand.name);
    const rest = this.snapshot.hands.filter((entry) => entry.participantId !== hand.participantId);
    this.update({ hands: [...rest, hand].sort((a, b) => a.raisedAt.localeCompare(b.raisedAt)) });
  }

  private removeHand(participantId: string): void {
    if (!this.snapshot.hands.some((entry) => entry.participantId === participantId)) return;
    this.update({ hands: this.snapshot.hands.filter((entry) => entry.participantId !== participantId) });
  }

  private upsertPoll(poll: WebinarPoll): void {
    const list = this.snapshot.polls.list;
    const index = list.findIndex((entry) => entry.id === poll.id);
    const next = index === -1 ? [...list, poll] : list.map((entry, i) => (i === index ? poll : entry));
    this.update({ polls: { ...this.snapshot.polls, list: next } });
  }

  private patchPoll(pollId: string, patch: Partial<WebinarPoll>): void {
    const poll = this.snapshot.polls.list.find((entry) => entry.id === pollId);
    if (poll) this.upsertPoll({ ...poll, ...patch });
  }

  private setError(area: WebinarActionArea, error: WebinarActionError): void {
    this.update({ errors: { ...this.snapshot.errors, [area]: error } });
  }

  clearError(area: WebinarActionArea): void {
    if (!this.snapshot.errors[area]) return;
    const errors = { ...this.snapshot.errors };
    delete errors[area];
    this.update({ errors });
  }

  hydrate(initial: WebinarInitialState): void {
    const isHost = this.isHost;
    if (initial.status) this.update({ status: initial.status });
    if (initial.recordingStatus) this.update({ recording: { status: initial.recordingStatus } });
    if (initial.attendanceCount !== undefined && isHost) this.update({ attendanceCount: initial.attendanceCount });
    if (initial.handCount !== undefined && isHost) this.update({ handCount: initial.handCount });
    if (initial.floorActive !== undefined) this.update({ floorActive: initial.floorActive });
    for (const message of initial.publicMessages ?? []) this.upsertPublic(message);
    if (this.isModerator) {
      for (const message of initial.moderationMessages ?? []) {
        this.upsertModeration(message);
        if (isVisible(message)) this.upsertPublic(toPublicMessage(message));
      }
    }
    for (const poll of initial.polls ?? []) this.upsertPoll(poll);
    if (initial.results?.length) {
      const results = { ...this.snapshot.polls.results };
      for (const entry of initial.results) results[entry.pollId] = entry;
      this.update({ polls: { ...this.snapshot.polls, results } });
    }
    if (isHost) {
      if (this.isModerator) for (const hand of initial.hands ?? []) this.upsertHand(hand);
      if (initial.speakers) this.update({ speakers: initial.speakers.map((s) => ({ ...s, name: this.isModerator ? s.name : null })) });
    } else if (initial.myHand) {
      this.update({ myHand: initial.myHand });
    }
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  private fail(area: WebinarActionArea, action: WebinarAction, code: string): Promise<never> {
    const error = new WebinarActionError(action, code);
    this.setError(area, error);
    return Promise.reject(error);
  }

  /** Posts an action, tracking it as pending; a failure is stored for the screen and rethrown with its code. */
  private async run<A extends WebinarAction>(area: WebinarActionArea, action: A, input: WebinarActionInputs[A], target?: string): Promise<unknown> {
    const key = target ? `${action}:${target}` : action;
    this.clearError(area);
    this.update({ pending: [...this.snapshot.pending, key] });
    try {
      return await this.transport.post(action, input);
    } catch (error) {
      const coded = toWebinarActionError(action, error);
      this.setError(area, coded);
      throw coded;
    } finally {
      this.update({ pending: this.snapshot.pending.filter((entry) => entry !== key) });
    }
  }

  async sendMessage(request: WebinarMessageCreateRequest): Promise<void> {
    const parsed = WebinarMessageCreateRequestSchema.safeParse(request);
    if (!parsed.success) return this.fail('chat', 'message.send', 'validation');
    const hostKind = parsed.data.kind === 'host';
    if (hostKind !== this.isHost) return this.fail('chat', 'message.send', 'forbidden');
    const response = await this.run('chat', 'message.send', { body: parsed.data });
    const moderation = WebinarModerationMessageSchema.safeParse(response);
    const message = moderation.success ? moderation.data : WebinarMessageSchema.safeParse(response).data;
    if (!message) return;
    this.update({ ownMessageIds: [...this.snapshot.ownMessageIds, message.id] });
    if (moderation.success && this.isModerator) this.upsertModeration(moderation.data);
    if (isVisible(message)) this.upsertPublic(toPublicMessage(message));
  }

  async raiseHand(): Promise<void> {
    if (this.isHost) return this.fail('hand', 'hand.raise', 'forbidden');
    const response = WebinarHandRaiseResponseSchema.safeParse(await this.run('hand', 'hand.raise', { body: {} }));
    this.update({ myHand: response.success ? response.data : { raised: true, raisedAt: now() } });
  }

  async lowerHand(): Promise<void> {
    if (this.isHost) return this.fail('hand', 'hand.lower', 'forbidden');
    const response = WebinarHandRaiseResponseSchema.safeParse(await this.run('hand', 'hand.lower', { body: {} }));
    this.update({ myHand: response.success ? response.data : { raised: false, raisedAt: null } });
  }

  async vote(pollId: string, optionId: string): Promise<void> {
    if (this.isHost) return this.fail('poll', 'poll.vote', 'forbidden');
    if (this.snapshot.polls.votes[pollId]) return;
    await this.run('poll', 'poll.vote', { pollId, body: { optionId } }, pollId);
    this.update({ polls: { ...this.snapshot.polls, votes: { ...this.snapshot.polls.votes, [pollId]: optionId } } });
  }

  async publish(messageId: string, text?: string): Promise<void> {
    if (!this.isModerator) return this.fail('moderation', 'message.publish', 'forbidden');
    const body = WebinarMessagePublishRequestSchema.safeParse(text === undefined ? {} : { text });
    if (!body.success) return this.fail('moderation', 'message.publish', 'validation');
    const response = await this.run('moderation', 'message.publish', { messageId, body: body.data }, messageId);
    const returned = WebinarModerationMessageSchema.safeParse(response);
    const patch: Partial<WebinarModerationMessage> = returned.success
      ? returned.data
      : { status: 'published', publishedAt: now(), ...(body.data.text ? { text: body.data.text } : {}) };
    this.patchModeration(messageId, patch);
    const updated = this.snapshot.moderationMessages.find((entry) => entry.id === messageId);
    if (updated) this.upsertPublic(toPublicMessage(updated));
  }

  async answer(messageId: string, answerText: string): Promise<void> {
    if (!this.isModerator) return this.fail('moderation', 'message.answer', 'forbidden');
    const body = WebinarMessageAnswerRequestSchema.safeParse({ answerText });
    if (!body.success) return this.fail('moderation', 'message.answer', 'validation');
    const response = await this.run('moderation', 'message.answer', { messageId, body: body.data }, messageId);
    const returned = WebinarModerationMessageSchema.safeParse(response);
    const existing = this.snapshot.moderationMessages.find((entry) => entry.id === messageId);
    this.patchModeration(
      messageId,
      returned.success ? returned.data : { status: 'answered', answerText: body.data.answerText, publishedAt: existing?.publishedAt ?? now() },
    );
    const updated = this.snapshot.moderationMessages.find((entry) => entry.id === messageId);
    if (updated) this.upsertPublic(toPublicMessage(updated));
  }

  async dismiss(messageId: string): Promise<void> {
    if (!this.isModerator) return this.fail('moderation', 'message.dismiss', 'forbidden');
    await this.run('moderation', 'message.dismiss', { messageId, body: {} }, messageId);
    this.patchModeration(messageId, { status: 'dismissed', answerText: null });
    if (this.snapshot.publicMessages.some((entry) => entry.id === messageId)) {
      this.update({ publicMessages: this.snapshot.publicMessages.filter((entry) => entry.id !== messageId) });
    }
  }

  async giveFloor(participantId: string): Promise<void> {
    if (!this.isHost) return this.fail('floor', 'floor.give', 'forbidden');
    const response = WebinarFloorResponseSchema.safeParse(await this.run('floor', 'floor.give', { participantId, body: {} }, participantId));
    if (response.success && !response.data.hasFloor) return;
    const speaker: WebinarSpeaker = { participantId, name: this.nameOf(participantId) };
    this.update({ speakers: [...this.snapshot.speakers.filter((entry) => entry.participantId !== participantId), speaker] });
    this.removeHand(participantId);
  }

  async takeFloor(participantId: string): Promise<void> {
    if (!this.isHost) return this.fail('floor', 'floor.take', 'forbidden');
    await this.run('floor', 'floor.take', { participantId, body: {} }, participantId);
    this.update({ speakers: this.snapshot.speakers.filter((entry) => entry.participantId !== participantId) });
  }

  async openPoll(pollId: string): Promise<void> {
    if (!this.isModerator) return this.fail('poll', 'poll.open', 'forbidden');
    await this.run('poll', 'poll.open', { pollId, body: {} }, pollId);
    const poll = this.snapshot.polls.list.find((entry) => entry.id === pollId);
    if (poll && !poll.openedAt) this.patchPoll(pollId, { openedAt: now(), closedAt: null });
  }

  async closePoll(pollId: string): Promise<void> {
    if (!this.isModerator) return this.fail('poll', 'poll.close', 'forbidden');
    await this.run('poll', 'poll.close', { pollId, body: {} }, pollId);
    const poll = this.snapshot.polls.list.find((entry) => entry.id === pollId);
    if (poll && !poll.closedAt) this.patchPoll(pollId, { closedAt: now() });
  }

  async end(): Promise<void> {
    if (!this.isHost) return this.fail('end', 'webinar.end', 'forbidden');
    await this.run('end', 'webinar.end', { body: {} });
    this.markEnded(now());
  }

  async stopRecording(): Promise<void> {
    if (!this.isModerator) return this.fail('recording', 'recording.stop', 'forbidden');
    const response = WebinarRecordingStatusResponseSchema.safeParse(await this.run('recording', 'recording.stop', { body: {} }));
    this.update({ recording: { status: response.success ? response.data.status : 'processing' } });
  }
}

/**
 * What the join response tells the client before any room event: the
 * recording state for the REC indicator (UX-45). Pass it as `initial` or to
 * `hydrate`. Without a `recordingStatus` the state stays unknown, and a live
 * webinar shows REC (every webinar is recorded, D-CW-34).
 */
export function webinarInitialStateFromJoin(join: Pick<WebinarJoinResponse, 'recordingStatus'>): WebinarInitialState {
  return join.recordingStatus ? { recordingStatus: join.recordingStatus } : {};
}
