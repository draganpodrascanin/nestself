/**
 * WebinarLiveService: the chat, hand-raise, floor and polls of a live
 * webinar (T-CW-2.1, D-CW-15, D-CW-16, D-CW-35).
 *
 * - Chat (WBN-09, WBN-20, WBN-23, WBN-24, WBN-37, CW-R-103, CW-R-104,
 *   CW-R-110): a host (a presenter, the moderator or moderating staff) posts
 *   `host` messages, published at once to `webinar:{id}`; an attendee writes
 *   `attendee` messages or `question`s to the hosts, PENDING and sent only to
 *   `webinar:{id}:moderation` with the registration name, anonymous towards
 *   the audience unless they attached their first name. Each side is refused
 *   the other's kind (403). The moderator publishes (optionally editing the
 *   text, the original kept), answers or dismisses; dismissing a published
 *   message sends `webinar.message.removed { messageId }` to the audience
 *   (WBN-24.2). Attendees and presenters
 *   read published and answered messages only; moderating principals read
 *   every message with its author's registration name.
 * - Hand-raise (WBN-10): an attendee who joined raises or lowers their hand;
 *   the moderation room gets the registration name, nobody else anything.
 * - Floor (WBN-25, WBN-26, D-CW-35, CW-R-108): a host gives an attendee the
 *   floor with `UpdateAttendeeCapabilities` audio `SendReceive` and video and
 *   content `Receive`, and takes it back to receive-only; the events go to
 *   that attendee's own room only (CW-R-34); the audience gets the anonymous
 *   `webinar.floor.state { active }` (WBN-25.8). `webinar.floor.given` is audited
 *   with `recordingNoticeShown: true` (CW-R-128): the client shows the
 *   recording notice before it lets the attendee unmute.
 * - Polls (WBN-11, WBN-27, CW-R-24): created, opened and closed by moderating
 *   principals; an attendee votes once per poll; a vote row holds the option
 *   only and the registration holds only the fact that it voted. Results
 *   are counts per option.
 *
 * No route here returns a roster (WBN-08): a participant id appears only in
 * the moderation views.
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  ACTIONS,
  WEBINAR_MESSAGE_LIST_DEFAULT_LIMIT,
  type Principal,
  type WebinarFloorResponse,
  type WebinarHandRaiseResponse,
  type WebinarMessage,
  type WebinarMessageAnswerRequest,
  type WebinarMessageCreateRequest,
  type WebinarMessageListQuery,
  type WebinarMessageListResponse,
  type WebinarMessagePublishRequest,
  type WebinarModerationMessage,
  type WebinarModerationMessageListResponse,
  type WebinarPoll,
  type WebinarPollCreateRequest,
  type WebinarPollResults,
  type WebinarPollVoteRequest,
  type WebinarPollVoteResponse,
} from '@nestself/contracts';
import { ParticipantForbiddenException } from '../appointments/appointment-non-disclosure.filter.js';
import { firstNameOf } from '../appointments/appointment-mapper.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter, type AuditEventInput } from '../audit/audit-writer.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { CallsRepository } from '../calls/calls.repository.js';
import { VIDEO_PROVIDER, type VideoProvider } from '../video/video-provider.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WebinarAccess, apiError, conflict, invalidField, notFound, webinarNotOpen } from './webinar-access.js';
import { attendeeCapabilities, decodePageCursor, paginate } from './webinar-mapper.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WebinarRoomEvents } from './webinar-room-events.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import {
  WebinarsRepository,
  type WebinarMessageRecord,
  type WebinarPollRecord,
  type WebinarRecord,
  type WebinarRegistrationRecord,
} from './webinars.repository.js';

const RECEIVE_ONLY = { audio: 'receive', video: 'receive', content: 'receive' } as const;
const FLOOR = { audio: 'send_receive', video: 'receive', content: 'receive' } as const;

function floorNotAvailable(message = 'The floor cannot be given to this participant now'): never {
  throw apiError(409, 'floor_not_available', message);
}

/** A message as attendees and presenters see it (D-CW-15). */
export function toPublicMessage(message: WebinarMessageRecord): WebinarMessage {
  return {
    id: message.id,
    webinarId: message.webinarId,
    kind: message.kind,
    status: message.status,
    text: message.text,
    authorFirstName: message.authorFirstName,
    answerText: message.answerText,
    publishedAt: message.publishedAt?.toISOString() ?? null,
    createdAt: message.createdAt.toISOString(),
  };
}

/** A message as the moderator sees it: the registration name even for an anonymous one (WBN-23). */
export function toModerationMessage(message: WebinarMessageRecord, authorName: string | null): WebinarModerationMessage {
  return {
    ...toPublicMessage(message),
    authorParticipantId: message.authorParticipantId,
    authorName: message.kind === 'host' ? null : authorName,
    showFirstName: message.showFirstName,
  };
}

export function toPoll(poll: WebinarPollRecord): WebinarPoll {
  return {
    id: poll.id,
    webinarId: poll.webinarId,
    question: poll.question,
    options: poll.options.map((option) => ({ id: option.id, label: option.label, position: option.position })),
    openedAt: poll.openedAt?.toISOString() ?? null,
    closedAt: poll.closedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class WebinarLiveService {
  constructor(
    private readonly repo: WebinarsRepository,
    private readonly access: WebinarAccess,
    private readonly calls: CallsRepository,
    @Inject(VIDEO_PROVIDER) private readonly video: VideoProvider,
    private readonly events: WebinarRoomEvents,
    private readonly audit: AuditWriter,
  ) {}

  // ── Chat ──────────────────────────────────────────────────────────────────

  async createMessage(
    webinarId: string,
    principal: Principal,
    body: WebinarMessageCreateRequest,
  ): Promise<WebinarMessage | WebinarModerationMessage> {
    const webinar = await this.access.load(webinarId);
    const host = await this.access.host(webinar, principal);
    const moderating = host?.role === 'moderator' || (await this.access.canModerate(webinar, principal));

    if (body.kind === 'host') {
      if (!host && !moderating) {
        if (await this.access.canRegister(webinar, principal)) {
          throw new ParticipantForbiddenException('Only hosts post to everyone');
        }
        return this.access.deny(principal, ACTIONS['event.moderate'], webinar);
      }
      if (webinar.status !== 'published' && webinar.status !== 'live') throw webinarNotOpen();
      const names = await this.repo.displayNames([principal.userId]);
      const now = new Date();
      const author = await this.currentParticipant(webinar, principal.userId);
      const message = await this.access.scoped(webinar.orgId, (tx) =>
        this.repo.insertMessage(
          {
            webinarId,
            orgId: webinar.orgId,
            sessionId: author?.sessionId ?? null,
            authorParticipantId: author?.id ?? null,
            authorUserId: principal.userId,
            kind: 'host',
            status: 'published',
            text: body.text,
            showFirstName: false,
            authorFirstName: host?.displayName ?? firstNameOf(names.get(principal.userId)),
            publishedAt: now,
            publishedByUserId: principal.userId,
          },
          tx,
        ),
      );
      this.events.toAudience(webinarId, 'webinar.message.published', toPublicMessage(message));
      await this.record(principal.userId, webinar, 'webinar.message.published', { webinarId, messageId: message.id });
      return moderating ? toModerationMessage(message, null) : toPublicMessage(message);
    }

    if (host || moderating) throw new ParticipantForbiddenException('Hosts post host messages');
    const registration = await this.registrant(webinar, principal);
    if (webinar.status !== 'live') throw webinarNotOpen();
    const name = (await this.repo.displayNames([principal.userId])).get(principal.userId) ?? null;
    const firstName = body.showFirstName ? firstNameOf(name) : null;
    const author = await this.currentParticipant(webinar, principal.userId);
    const message = await this.access.scoped(webinar.orgId, (tx) =>
      this.repo.insertMessage(
        {
          webinarId,
          orgId: webinar.orgId,
          sessionId: author?.sessionId ?? null,
          authorParticipantId: author?.id ?? null,
          authorUserId: registration.userId,
          kind: body.kind,
          status: 'pending',
          text: body.text,
          showFirstName: firstName !== null,
          authorFirstName: firstName,
          publishedAt: null,
          publishedByUserId: null,
        },
        tx,
      ),
    );
    this.events.toModeration(webinarId, 'webinar.message.submitted', toModerationMessage(message, name));
    await this.record(principal.userId, webinar, 'webinar.message.submitted', { webinarId, messageId: message.id });
    return toPublicMessage(message);
  }

  async listMessages(
    webinarId: string,
    principal: Principal,
    query: WebinarMessageListQuery,
  ): Promise<WebinarMessageListResponse | WebinarModerationMessageListResponse> {
    const after = query.cursor ? decodePageCursor(query.cursor) : undefined;
    if (after === null) throw invalidField('cursor', 'The cursor is not valid');
    const limit = query.limit ?? WEBINAR_MESSAGE_LIST_DEFAULT_LIMIT;
    const webinar = await this.access.load(webinarId);
    const keyOf = (message: WebinarMessageRecord) => ({ at: message.createdAt, id: message.id });

    if (await this.access.canModerate(webinar, principal)) {
      const rows = await this.access.scoped(webinar.orgId, (tx) =>
        this.repo.listMessages(webinarId, { after, limit: limit + 1 }, tx),
      );
      const page = paginate(rows, limit, keyOf);
      // An author link removed after 12 months (D-CW-29) has no name to show.
      const names = await this.repo.displayNames(page.items.flatMap((message) => message.authorUserId ?? []));
      return {
        items: page.items.map((message) =>
          toModerationMessage(message, (message.authorUserId && names.get(message.authorUserId)) ?? null),
        ),
        nextCursor: page.nextCursor,
      };
    }

    if (!(await this.access.host(webinar, principal))) await this.registrant(webinar, principal);
    const rows = await this.access.scoped(webinar.orgId, (tx) =>
      this.repo.listMessages(webinarId, { statuses: ['published', 'answered'], after, limit: limit + 1 }, tx),
    );
    const page = paginate(rows, limit, keyOf);
    return { items: page.items.map(toPublicMessage), nextCursor: page.nextCursor };
  }

  /** WBN-24: publish an attendee message, edited or not; the original text is kept. */
  async publishMessage(
    webinarId: string,
    messageId: string,
    principal: Principal,
    body: WebinarMessagePublishRequest,
  ): Promise<WebinarModerationMessage> {
    const { webinar, message } = await this.moderatedMessage(webinarId, messageId);
    const edited = body.text !== undefined && body.text !== message.text;
    const published = await this.access.scoped(webinar.orgId, (tx) =>
      this.repo.updateMessage(
        message.id,
        ['pending'],
        {
          status: 'published',
          publishedAt: new Date(),
          publishedByUserId: principal.userId,
          ...(edited ? { text: body.text, originalText: message.originalText ?? message.text } : {}),
        },
        tx,
      ),
    );
    if (!published) throw conflict('message_not_pending', 'Only a pending message can be published');
    this.events.toAudience(webinarId, 'webinar.message.published', toPublicMessage(published));
    await this.record(principal.userId, webinar, 'webinar.message.published', { webinarId, messageId });
    return this.moderationView(published);
  }

  async answerMessage(
    webinarId: string,
    messageId: string,
    principal: Principal,
    body: WebinarMessageAnswerRequest,
  ): Promise<WebinarModerationMessage> {
    const { webinar, message } = await this.moderatedMessage(webinarId, messageId);
    const answered = await this.access.scoped(webinar.orgId, (tx) =>
      this.repo.updateMessage(
        message.id,
        ['pending', 'published'],
        {
          status: 'answered',
          answerText: body.answerText,
          answeredByUserId: principal.userId,
          publishedAt: message.publishedAt ?? new Date(),
          ...(message.publishedAt ? {} : { publishedByUserId: principal.userId }),
        },
        tx,
      ),
    );
    if (!answered) throw conflict('message_not_answerable', 'Only a pending or published message can be answered');
    this.events.toAudience(webinarId, 'webinar.message.answered', toPublicMessage(answered));
    await this.record(principal.userId, webinar, 'webinar.message.answered', { webinarId, messageId });
    return this.moderationView(answered);
  }

  async dismissMessage(webinarId: string, messageId: string, principal: Principal): Promise<WebinarModerationMessage> {
    const { webinar, message } = await this.moderatedMessage(webinarId, messageId);
    const dismissed = await this.access.scoped(webinar.orgId, (tx) =>
      this.repo.updateMessage(message.id, ['pending', 'published'], { status: 'dismissed' }, tx),
    );
    if (!dismissed) throw conflict('message_not_dismissable', 'Only a pending or published message can be dismissed');
    // The audience saw a published message; it leaves the public chat (WBN-24.2). A pending one never reached it.
    if (message.status === 'published') this.events.toAudienceAdded(webinarId, 'webinar.message.removed', { messageId });
    await this.record(principal.userId, webinar, 'webinar.message.dismissed', { webinarId, messageId });
    return this.moderationView(dismissed);
  }

  /** The guard has checked `event.moderate`; host posts are not moderated (CW-R-103). */
  private async moderatedMessage(
    webinarId: string,
    messageId: string,
  ): Promise<{ webinar: WebinarRecord; message: WebinarMessageRecord }> {
    const webinar = await this.access.load(webinarId);
    const message = await this.access.scoped(webinar.orgId, (tx) => this.repo.findMessage(webinarId, messageId, tx));
    if (!message) throw notFound();
    if (message.kind === 'host') throw conflict('host_message', 'Host messages are published as they are posted');
    return { webinar, message };
  }

  private async moderationView(message: WebinarMessageRecord): Promise<WebinarModerationMessage> {
    if (!message.authorUserId) return toModerationMessage(message, null);
    const names = await this.repo.displayNames([message.authorUserId]);
    return toModerationMessage(message, names.get(message.authorUserId) ?? null);
  }

  // ── Hand-raise (WBN-10) ───────────────────────────────────────────────────

  async raiseHand(webinarId: string, principal: Principal): Promise<WebinarHandRaiseResponse> {
    const { webinar, registration, participantId } = await this.joinedAttendee(webinarId, principal);
    if (registration.handRaisedAt) return { raised: true, raisedAt: registration.handRaisedAt.toISOString() };
    const raisedAt = new Date();
    await this.access.scoped(webinar.orgId, (tx) => this.repo.setHand(registration.id, raisedAt, tx));
    const name = (await this.repo.displayNames([principal.userId])).get(principal.userId) ?? 'Participant';
    this.events.toModeration(webinarId, 'webinar.hand.raised', {
      participantId,
      participantName: name,
      raisedAt: raisedAt.toISOString(),
    });
    return { raised: true, raisedAt: raisedAt.toISOString() };
  }

  async lowerHand(webinarId: string, principal: Principal): Promise<WebinarHandRaiseResponse> {
    const webinar = await this.access.load(webinarId);
    const registration = await this.registrant(webinar, principal);
    if (!registration.handRaisedAt) return { raised: false, raisedAt: null };
    await this.access.scoped(webinar.orgId, (tx) => this.repo.setHand(registration.id, null, tx));
    const participant = await this.currentParticipant(webinar, principal.userId);
    if (participant) this.events.toModeration(webinarId, 'webinar.hand.lowered', { participantId: participant.id });
    return { raised: false, raisedAt: null };
  }

  // ── Floor (WBN-25, WBN-26, D-CW-35) ───────────────────────────────────────

  async giveFloor(webinarId: string, participantId: string, principal: Principal): Promise<WebinarFloorResponse> {
    const target = await this.floorTarget(webinarId, participantId, principal);
    await this.video.updateParticipantCapabilities({
      providerMeetingId: target.providerMeetingId,
      providerAttendeeId: target.providerAttendeeId,
      role: 'attendee',
      capabilities: attendeeCapabilities(true),
    });
    await this.access.scoped(target.webinar.orgId, (tx) => this.repo.setFloor(target.registration.id, new Date(), tx));
    if (target.registration.handRaisedAt) this.events.toModeration(webinarId, 'webinar.hand.lowered', { participantId });
    this.events.toParticipant(target.registration.userId, 'webinar.floor.given', { participantId, capabilities: FLOOR });
    // The audience learns that a participant is speaking, never who (WBN-25.8, D-CW-15).
    this.events.toAudienceAdded(webinarId, 'webinar.floor.state', { active: true });
    await this.record(principal.userId, target.webinar, 'webinar.floor.given', {
      webinarId,
      participantId,
      recordingNoticeShown: true,
    });
    return { participantId, hasFloor: true, capabilities: FLOOR };
  }

  async takeFloor(webinarId: string, participantId: string, principal: Principal): Promise<WebinarFloorResponse> {
    const target = await this.floorTarget(webinarId, participantId, principal);
    await this.video.updateParticipantCapabilities({
      providerMeetingId: target.providerMeetingId,
      providerAttendeeId: target.providerAttendeeId,
      role: 'attendee',
      capabilities: attendeeCapabilities(false),
    });
    await this.access.scoped(target.webinar.orgId, (tx) => this.repo.setFloor(target.registration.id, null, tx));
    this.events.toParticipant(target.registration.userId, 'webinar.floor.taken', {
      participantId,
      capabilities: RECEIVE_ONLY,
    });
    // Still active while another attendee holds the floor.
    const active = (
      await this.access.scoped(target.webinar.orgId, (tx) => this.repo.listActiveRegistrations(webinarId, tx))
    ).some((registration) => registration.floorGivenAt !== null);
    this.events.toAudienceAdded(webinarId, 'webinar.floor.state', { active });
    await this.record(principal.userId, target.webinar, 'webinar.floor.taken', { webinarId, participantId });
    return { participantId, hasFloor: false, capabilities: RECEIVE_ONLY };
  }

  /**
   * A host (a presenter or the moderator of the occurrence) or a moderating
   * principal; anyone else gets 404. The participant must be an attendee in
   * the live meeting with an active registration.
   */
  private async floorTarget(webinarId: string, participantId: string, principal: Principal) {
    const webinar = await this.access.load(webinarId);
    if (!(await this.access.host(webinar, principal)) && !(await this.access.canModerate(webinar, principal))) {
      return this.access.deny(principal, ACTIONS['event.moderate'], webinar);
    }
    const participant = await this.access.scoped(webinar.orgId, (tx) =>
      this.repo.findParticipantOfWebinar(webinarId, participantId, tx),
    );
    if (!participant) throw notFound();
    if (webinar.status !== 'live') floorNotAvailable('The webinar is not live');
    if (participant.role !== 'ATTENDEE') floorNotAvailable('Only an attendee can be given the floor');
    const session = await this.access.scoped(webinar.orgId, (tx) => this.calls.findSessionById(participant.sessionId, tx));
    if (session?.status !== 'active' || !session.providerMeetingId || !participant.providerAttendeeId) {
      floorNotAvailable('The participant is not in the live meeting');
    }
    const registration = await this.repo.findRegistration(webinarId, participant.userId);
    if (!registration) floorNotAvailable('The participant is no longer registered');
    return {
      webinar,
      registration,
      providerMeetingId: session.providerMeetingId,
      providerAttendeeId: participant.providerAttendeeId,
    };
  }

  // ── Polls (WBN-11, WBN-27) ────────────────────────────────────────────────

  async createPoll(webinarId: string, principal: Principal, body: WebinarPollCreateRequest): Promise<WebinarPoll> {
    const webinar = await this.access.load(webinarId);
    if (webinar.status !== 'published' && webinar.status !== 'live') throw webinarNotOpen();
    const session = await this.access.scoped(webinar.orgId, (tx) => this.repo.findOpenSession(webinarId, tx));
    const poll = await this.access.transaction(webinar.orgId, (tx) =>
      this.repo.createPoll(
        {
          webinarId,
          orgId: webinar.orgId,
          sessionId: session?.id ?? null,
          question: body.question,
          options: body.options,
          createdByUserId: principal.userId,
        },
        tx,
      ),
    );
    return toPoll(poll);
  }

  async openPoll(webinarId: string, pollId: string, principal: Principal): Promise<WebinarPoll> {
    const webinar = await this.access.load(webinarId);
    if (webinar.status !== 'live') throw webinarNotOpen();
    const poll = await this.poll(webinar, pollId);
    const openedAt = new Date();
    const opened = await this.access.scoped(webinar.orgId, (tx) => this.repo.openPoll(pollId, openedAt, tx));
    if (!opened) throw conflict('poll_already_opened', 'The poll was already opened');
    const definition = toPoll({ ...poll, openedAt });
    this.events.toAudience(webinarId, 'webinar.poll.opened', definition);
    await this.record(principal.userId, webinar, 'webinar.poll.opened', { webinarId, pollId });
    return definition;
  }

  async closePoll(webinarId: string, pollId: string, principal: Principal): Promise<WebinarPollResults> {
    const webinar = await this.access.load(webinarId);
    const poll = await this.poll(webinar, pollId);
    const closedAt = new Date();
    const closed = await this.access.scoped(webinar.orgId, (tx) => this.repo.closePoll(pollId, closedAt, tx));
    if (!closed) throw conflict('poll_not_open', 'The poll is not open');
    const results = await this.results(webinar, poll);
    this.events.toAudience(webinarId, 'webinar.poll.closed', { pollId, closedAt: closedAt.toISOString() });
    this.events.toAudience(webinarId, 'webinar.poll.results', results);
    await this.record(principal.userId, webinar, 'webinar.poll.closed', { webinarId, pollId });
    return results;
  }

  /** One vote per registration and poll; the vote row holds the option only (CW-R-24). */
  async vote(webinarId: string, pollId: string, principal: Principal, body: WebinarPollVoteRequest): Promise<WebinarPollVoteResponse> {
    const webinar = await this.access.load(webinarId);
    const registration = await this.registrant(webinar, principal);
    if (webinar.status !== 'live') throw webinarNotOpen();
    const poll = await this.poll(webinar, pollId);
    if (!poll.openedAt || poll.closedAt) throw conflict('poll_not_open', 'The poll is not open');
    if (!poll.options.some((option) => option.id === body.optionId)) {
      throw invalidField('optionId', 'The option is not one of the poll');
    }
    await this.access.transaction(registration.orgId ?? webinar.orgId, async (tx) => {
      if (!(await this.repo.markVoted(registration.id, pollId, tx))) {
        throw conflict('already_voted', 'You already voted in this poll');
      }
      await this.repo.insertVote({ pollId, optionId: body.optionId, orgId: poll.orgId }, tx);
    });
    return { pollId, voted: true };
  }

  private async poll(webinar: WebinarRecord, pollId: string): Promise<WebinarPollRecord> {
    const poll = await this.access.scoped(webinar.orgId, (tx) => this.repo.findPoll(webinar.id, pollId, tx));
    if (!poll) throw notFound();
    return poll;
  }

  private async results(webinar: WebinarRecord, poll: WebinarPollRecord): Promise<WebinarPollResults> {
    const counts = await this.access.scoped(webinar.orgId, (tx) => this.repo.pollCounts(poll.id, tx));
    const results = poll.options.map((option) => ({ optionId: option.id, count: counts.get(option.id) ?? 0 }));
    return { pollId: poll.id, totalVotes: results.reduce((sum, r) => sum + r.count, 0), results };
  }

  // ── Shared ────────────────────────────────────────────────────────────────

  /** The caller's active registration; 404 without `event.register`, 403 without a registration. */
  private async registrant(webinar: WebinarRecord, principal: Principal): Promise<WebinarRegistrationRecord> {
    if (!(await this.access.canRegister(webinar, principal))) {
      return this.access.deny(principal, ACTIONS['event.register'], webinar);
    }
    const registration = await this.repo.findRegistration(webinar.id, principal.userId);
    if (!registration) throw new ParticipantForbiddenException('Register for the webinar first');
    return registration;
  }

  /** A registered attendee who joined the live meeting, with their participant id (hand-raise). */
  private async joinedAttendee(webinarId: string, principal: Principal) {
    const webinar = await this.access.load(webinarId);
    const registration = await this.registrant(webinar, principal);
    if (webinar.status !== 'live') throw webinarNotOpen();
    const participant = await this.currentParticipant(webinar, principal.userId);
    if (participant?.role !== 'attendee') throw conflict('not_joined', 'Join the webinar first');
    return { webinar, registration, participantId: participant.id };
  }

  /** The person's participant in the occurrence's open session, or null. */
  private async currentParticipant(webinar: WebinarRecord, userId: string) {
    return this.access.scoped(webinar.orgId, async (tx) => {
      const session = await this.repo.findOpenSession(webinar.id, tx);
      return session ? this.calls.findParticipant(session.id, userId, tx) : null;
    });
  }

  /** A webinar audit event; `details` carries identifiers only (CW-R-33a). */
  private record(
    actorUserId: string,
    webinar: Pick<WebinarRecord, 'id' | 'orgId'>,
    action: AuditEventInput['action'],
    details: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record({
      action,
      actorUserId,
      actorKind: 'USER',
      orgId: webinar.orgId,
      recordType: 'webinar',
      recordId: webinar.id,
      result: 'ALLOWED',
      details,
    });
  }
}
