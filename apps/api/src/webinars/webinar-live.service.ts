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
 *   the moderation room gets the registration name and the hosts' room the
 *   number of raised hands with their participant ids, never a name
 *   (`webinar.hand.count`, so a presenter can give the floor, WBN-25.1),
 *   nobody else anything.
 * - Floor (WBN-25, WBN-26, D-CW-35, CW-R-108): a host gives an attendee the
 *   floor with `UpdateAttendeeCapabilities` audio `SendReceive` and video and
 *   content `Receive`, and takes it back to receive-only. An attendee seated
 *   in a replica cannot be given audio there (SPIKE-CW-06): the floor is an
 *   audio-only attendee on the primary (`promoteToPrimary`), whose credentials
 *   travel in `webinar.floor.given` as `primaryAttendee` for the client's
 *   `promoteToPrimaryMeeting` (WEB-09), and taking it back deletes that
 *   attendee (`demoteFromPrimary`, T-CW-3.2). The events go to
 *   that attendee's own room only (CW-R-34); the audience gets the anonymous
 *   `webinar.floor.state { active }` (WBN-25.8) and the hosts' room
 *   `webinar:{id}:hosts` gets `{ active, participantId }` for the attendee
 *   whose floor changed. `webinar.floor.given` is audited
 *   with `recordingNoticeShown: true` (CW-R-128): the client shows the
 *   recording notice before it lets the attendee unmute.
 * - Mute (WBN-26): a host mutes the floor holder (audio back to `Receive`,
 *   the floor kept) or asks them to unmute; only the attendee unmutes, on
 *   their own participant, while they hold the floor, and after a host's
 *   mute only once a host asked (`WebinarFloorState`, Redis). `webinar.floor.muted`
 *   and `webinar.floor.unmuted` reach the hosts room with the participant
 *   id; the attendee's own room gets `webinar.floor.muted {}` and
 *   `webinar.floor.unmute_requested {}`.
 * - Polls (WBN-11, WBN-27, CW-R-24): created, opened and closed by moderating
 *   principals; an attendee votes once per poll; a vote row holds the option
 *   only and the registration holds only the fact that it voted. Results
 *   are counts per option. The vote and the marker are written in one
 *   transaction, so while the poll is open the two rows share a transaction
 *   id (`xmin`); closing the poll rewrites every voter's registration row in
 *   the close's transaction, after which nothing in the rows links a vote to
 *   a voter. `GET /webinars/:id/polls` returns the poll state for late
 *   joiners and reloaded consoles; `GET .../polls/:pollId/results` the counts
 *   for the hosts once a poll is closed.
 *
 * No route here returns a roster (WBN-08): a participant id appears only in
 * the moderation views and, without a name, in the hosts' room.
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  ACTIONS,
  WEBINAR_MESSAGE_LIST_DEFAULT_LIMIT,
  type Principal,
  type WebinarFloorResponse,
  type WebinarHandRaiseResponse,
  type WebinarPrimaryAttendee,
  type WebinarMessage,
  type WebinarMessageAnswerRequest,
  type WebinarMessageCreateRequest,
  type WebinarMessageListQuery,
  type WebinarMessageListResponse,
  type WebinarMessagePublishRequest,
  type WebinarModerationMessage,
  type WebinarModerationMessageListResponse,
  type WebinarPoll,
  type WebinarFloorMuteResponse,
  type WebinarFloorUnmuteResponse,
  type WebinarUnmuteRequestResponse,
  type WebinarPollCreateRequest,
  type WebinarPollListResponse,
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
import { WebinarFloorState } from './webinar-floor-state.js';
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
    private readonly floorState: WebinarFloorState,
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
    await this.announceHandCount(webinar);
    return { raised: true, raisedAt: raisedAt.toISOString() };
  }

  async lowerHand(webinarId: string, principal: Principal): Promise<WebinarHandRaiseResponse> {
    const webinar = await this.access.load(webinarId);
    const registration = await this.registrant(webinar, principal);
    if (!registration.handRaisedAt) return { raised: false, raisedAt: null };
    await this.access.scoped(webinar.orgId, (tx) => this.repo.setHand(registration.id, null, tx));
    const participant = await this.currentParticipant(webinar, principal.userId);
    if (participant) this.events.toModeration(webinarId, 'webinar.hand.lowered', { participantId: participant.id });
    await this.announceHandCount(webinar);
    return { raised: false, raisedAt: null };
  }

  /**
   * `webinar.hand.count` to the hosts' room: the number of raised hands and,
   * oldest first, the participant ids that raised them, never names (WBN-10,
   * WBN-19), so a presenter can give the floor too (WBN-25.1). A raised hand
   * whose owner has no attendee in the open session is counted only.
   */
  private async announceHandCount(webinar: Pick<WebinarRecord, 'id' | 'orgId'>): Promise<void> {
    const payload = await this.access.scoped(webinar.orgId, async (tx) => {
      const raised = (await this.repo.listActiveRegistrations(webinar.id, tx))
        .flatMap((registration) => (registration.handRaisedAt ? [{ userId: registration.userId, raisedAt: registration.handRaisedAt }] : []))
        .sort((a, b) => a.raisedAt.getTime() - b.raisedAt.getTime());
      const session = raised.length > 0 ? await this.repo.findOpenSession(webinar.id, tx) : null;
      const hands: { participantId: string; raisedAt: string }[] = [];
      for (const hand of raised) {
        const participant = session ? await this.calls.findParticipant(session.id, hand.userId, tx) : null;
        if (participant?.role === 'attendee') hands.push({ participantId: participant.id, raisedAt: hand.raisedAt.toISOString() });
      }
      return { count: raised.length, hands };
    });
    this.events.toHosts(webinar.id, 'webinar.hand.count', payload);
  }

  // ── Floor (WBN-25, WBN-26, D-CW-35) ───────────────────────────────────────

  async giveFloor(webinarId: string, participantId: string, principal: Principal): Promise<WebinarFloorResponse> {
    const target = await this.floorTarget(webinarId, participantId, principal);
    let primaryAttendee: WebinarPrimaryAttendee | undefined;
    if (target.replicaIndex === null) {
      await this.video.updateParticipantCapabilities({
        providerMeetingId: target.providerMeetingId,
        providerAttendeeId: target.providerAttendeeId,
        role: 'attendee',
        capabilities: attendeeCapabilities(true),
      });
    } else {
      // A second grant replaces the first promotion rather than leaving two attendees on the primary.
      if (target.floorAttendeeId) await this.demote(target, target.floorAttendeeId);
      const promoted = await this.video.promoteToPrimary({
        sessionId: target.sessionId,
        providerMeetingId: target.providerMeetingId,
        participantId,
      });
      await this.access.scoped(target.webinar.orgId, (tx) =>
        this.repo.setFloorAttendee(participantId, promoted.providerAttendeeId, tx),
      );
      // Credentials only, never the primary's meeting id; to this attendee's own socket (CW-R-34, CW-R-69).
      primaryAttendee = {
        AttendeeId: promoted.attendee.AttendeeId,
        ExternalUserId: promoted.attendee.ExternalUserId,
        JoinToken: promoted.attendee.JoinToken,
      };
    }
    await this.access.scoped(target.webinar.orgId, (tx) => this.repo.setFloor(target.registration.id, new Date(), tx));
    // A new floor starts unmuted, with no request pending (WBN-26).
    await this.floorState.clear(webinarId, participantId);
    if (target.registration.handRaisedAt) this.events.toModeration(webinarId, 'webinar.hand.lowered', { participantId });
    this.events.toParticipant(target.registration.userId, 'webinar.floor.given', {
      participantId,
      capabilities: FLOOR,
      ...(primaryAttendee ? { primaryAttendee } : {}),
    });
    // The audience learns that a participant is speaking, never who (WBN-25.8, D-CW-15); the hosts learn which participant.
    this.events.toAudienceAdded(webinarId, 'webinar.floor.state', { active: true });
    this.events.toHosts(webinarId, 'webinar.floor.state', { active: true, participantId });
    // The floor lowered the hand (`setFloor`).
    if (target.registration.handRaisedAt) await this.announceHandCount(target.webinar);
    await this.record(principal.userId, target.webinar, 'webinar.floor.given', {
      webinarId,
      participantId,
      recordingNoticeShown: true,
    });
    return { participantId, hasFloor: true, capabilities: FLOOR };
  }

  async takeFloor(webinarId: string, participantId: string, principal: Principal): Promise<WebinarFloorResponse> {
    const target = await this.floorTarget(webinarId, participantId, principal);
    if (target.floorAttendeeId) {
      // The client is demoted when its primary attendee goes (WEB-09).
      await this.demote(target, target.floorAttendeeId);
    } else if (target.replicaIndex === null) {
      await this.video.updateParticipantCapabilities({
        providerMeetingId: target.providerMeetingId,
        providerAttendeeId: target.providerAttendeeId,
        role: 'attendee',
        capabilities: attendeeCapabilities(false),
      });
    }
    await this.access.scoped(target.webinar.orgId, (tx) => this.repo.setFloor(target.registration.id, null, tx));
    await this.floorState.clear(webinarId, participantId);
    this.events.toParticipant(target.registration.userId, 'webinar.floor.taken', {
      participantId,
      capabilities: RECEIVE_ONLY,
    });
    // Still active while another attendee holds the floor.
    const active = (
      await this.access.scoped(target.webinar.orgId, (tx) => this.repo.listActiveRegistrations(webinarId, tx))
    ).some((registration) => registration.floorGivenAt !== null);
    this.events.toAudienceAdded(webinarId, 'webinar.floor.state', { active });
    // The hosts' flag is this attendee's: the floor they held is back (another may still hold one).
    this.events.toHosts(webinarId, 'webinar.floor.state', { active: false, participantId });
    await this.record(principal.userId, target.webinar, 'webinar.floor.taken', { webinarId, participantId });
    return { participantId, hasFloor: false, capabilities: RECEIVE_ONLY };
  }

  // ── Mute and unmute of the floor holder (WBN-26) ──────────────────────────

  /**
   * A host mutes the floor holder: audio back to `Receive` (a replica
   * attendee loses its promotion attendee on the primary, as at take-floor),
   * while the floor stays theirs, so they can unmute again with consent. The
   * hand-raise record is untouched. Same callers as take-floor.
   */
  async muteFloor(webinarId: string, participantId: string, principal: Principal): Promise<WebinarFloorMuteResponse> {
    const target = await this.floorTarget(webinarId, participantId, principal);
    if (!target.registration.floorGivenAt) floorNotAvailable('The participant does not hold the floor');
    if (target.floorAttendeeId) {
      await this.demote(target, target.floorAttendeeId);
    } else if (target.replicaIndex === null) {
      await this.video.updateParticipantCapabilities({
        providerMeetingId: target.providerMeetingId,
        providerAttendeeId: target.providerAttendeeId,
        role: 'attendee',
        capabilities: attendeeCapabilities(false),
      });
    }
    // Muted by a host: the attendee may unmute again only once a host asks (WBN-26 criterion 3).
    await this.floorState.set(target.webinar, participantId, { muted: true, unmuteRequested: false });
    this.events.toHostsFloorMute(webinarId, 'webinar.floor.muted', { participantId });
    this.events.toParticipantFloorMute(target.registration.userId, 'webinar.floor.muted', {});
    await this.record(principal.userId, target.webinar, 'webinar.floor.muted', { webinarId, participantId });
    return { participantId, hasFloor: true, muted: true, capabilities: RECEIVE_ONLY };
  }

  /**
   * A host asks the floor holder to unmute (WBN-26 criterion 3): the client
   * asks the attendee, and nothing changes here until they consent through
   * `unmuteFloor`. A host can never unmute an attendee.
   */
  async requestUnmute(webinarId: string, participantId: string, principal: Principal): Promise<WebinarUnmuteRequestResponse> {
    const target = await this.floorTarget(webinarId, participantId, principal);
    if (!target.registration.floorGivenAt) floorNotAvailable('The participant does not hold the floor');
    const state = await this.floorState.get(webinarId, participantId);
    await this.floorState.set(target.webinar, participantId, { ...state, unmuteRequested: true });
    this.events.toParticipantFloorMute(target.registration.userId, 'webinar.floor.unmute_requested', {});
    await this.record(principal.userId, target.webinar, 'webinar.floor.unmute_requested', { webinarId, participantId });
    return { participantId, requested: true };
  }

  /**
   * The attendee unmutes themselves, on their own participant and only while
   * they hold the floor: audio `SendReceive` again, video and content
   * `Receive` (D-CW-35); a replica attendee is promoted again and gets the
   * primary credentials in the response, to themselves only (CW-R-69).
   */
  async unmuteFloor(webinarId: string, participantId: string, principal: Principal): Promise<WebinarFloorUnmuteResponse> {
    const webinar = await this.access.load(webinarId);
    const registration = await this.registrant(webinar, principal);
    const participant = await this.access.scoped(webinar.orgId, (tx) =>
      this.repo.findParticipantOfWebinar(webinarId, participantId, tx),
    );
    // Somebody else's participant reads as unknown (D-CW-15).
    if (participant?.userId !== principal.userId) throw notFound();
    if (webinar.status !== 'live') floorNotAvailable('The webinar is not live');
    if (participant.role !== 'ATTENDEE' || !registration.floorGivenAt) {
      floorNotAvailable('You do not hold the floor');
    }
    // A host muted this floor and has not asked to unmute since: the attendee waits for the request (WBN-26).
    const state = await this.floorState.get(webinarId, participantId);
    if (state.muted && !state.unmuteRequested) floorNotAvailable('A host muted you; wait until a host asks you to unmute');
    const session = await this.access.scoped(webinar.orgId, (tx) => this.calls.findSessionById(participant.sessionId, tx));
    if (session?.status !== 'active' || !session.providerMeetingId || !participant.providerAttendeeId) {
      floorNotAvailable('You are not in the live meeting');
    }

    let primaryAttendee: WebinarPrimaryAttendee | undefined;
    if ((participant.replicaIndex ?? null) === null) {
      await this.video.updateParticipantCapabilities({
        providerMeetingId: session.providerMeetingId,
        providerAttendeeId: participant.providerAttendeeId,
        role: 'attendee',
        capabilities: attendeeCapabilities(true),
      });
    } else if (!participant.floorAttendeeId) {
      const promoted = await this.video.promoteToPrimary({
        sessionId: session.id,
        providerMeetingId: session.providerMeetingId,
        participantId,
      });
      await this.access.scoped(webinar.orgId, (tx) => this.repo.setFloorAttendee(participantId, promoted.providerAttendeeId, tx));
      primaryAttendee = {
        AttendeeId: promoted.attendee.AttendeeId,
        ExternalUserId: promoted.attendee.ExternalUserId,
        JoinToken: promoted.attendee.JoinToken,
      };
    }
    await this.floorState.clear(webinarId, participantId);
    this.events.toHostsFloorMute(webinarId, 'webinar.floor.unmuted', { participantId });
    await this.record(principal.userId, webinar, 'webinar.floor.unmuted', { webinarId, participantId });
    return { participantId, hasFloor: true, muted: false, capabilities: FLOOR, ...(primaryAttendee ? { primaryAttendee } : {}) };
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
    const registration = await this.access.scoped(webinar.orgId, (tx) =>
      this.repo.findRegistration(webinarId, participant.userId, tx),
    );
    if (!registration) floorNotAvailable('The participant is no longer registered');
    return {
      webinar,
      registration,
      sessionId: session.id,
      participantId: participant.id,
      /** The primary meeting. */
      providerMeetingId: session.providerMeetingId,
      providerAttendeeId: participant.providerAttendeeId,
      /** Null when the attendee sits in the primary (a single meeting). */
      replicaIndex: participant.replicaIndex ?? null,
      floorAttendeeId: participant.floorAttendeeId ?? null,
    };
  }

  /** Deletes a replica attendee's promotion attendee on the primary and forgets it (T-CW-3.2). */
  private async demote(
    target: { webinar: WebinarRecord; sessionId: string; participantId: string; providerMeetingId: string },
    floorAttendeeId: string,
  ): Promise<void> {
    await this.video.demoteFromPrimary({
      sessionId: target.sessionId,
      providerMeetingId: target.providerMeetingId,
      participantId: target.participantId,
      providerAttendeeId: floorAttendeeId,
    });
    await this.access.scoped(target.webinar.orgId, (tx) => this.repo.setFloorAttendee(target.participantId, null, tx));
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
    // The close also rewrites every voter's registration row in the same transaction: until now a vote and
    // its voter's marker shared a transaction id (`xmin`); afterwards nothing in the rows links them (CW-R-24).
    const closed = await this.access.transaction(webinar.orgId, async (tx) => {
      if (!(await this.repo.closePoll(pollId, closedAt, tx))) return false;
      await this.repo.rewriteVoters(webinarId, pollId, tx);
      return true;
    });
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

  /**
   * `GET /webinars/:id/polls`: the poll state a late joiner or a reloaded
   * console needs. Moderating principals get every poll, presenters and
   * registrants the opened ones; results only for closed polls (D-CW-16);
   * `voted` from the registrant's marker, never the option (CW-R-24).
   */
  async listPolls(webinarId: string, principal: Principal): Promise<WebinarPollListResponse> {
    const webinar = await this.access.load(webinarId);
    let openedOnly = true;
    let voted: readonly string[] = [];
    if (await this.access.canModerate(webinar, principal)) openedOnly = false;
    else if (!(await this.access.host(webinar, principal))) voted = (await this.registrant(webinar, principal)).votedPollIds;
    const polls = await this.access.scoped(webinar.orgId, (tx) => this.repo.listPolls(webinarId, openedOnly, tx));
    const items = [];
    for (const poll of polls) {
      items.push({
        poll: toPoll(poll),
        results: poll.closedAt ? await this.results(webinar, poll) : null,
        voted: voted.includes(poll.id),
      });
    }
    return { items };
  }

  /** `GET /webinars/:id/polls/:pollId/results`: the aggregate counts for the hosts, once the poll is closed. */
  async pollResults(webinarId: string, pollId: string, principal: Principal): Promise<WebinarPollResults> {
    const webinar = await this.access.load(webinarId);
    if (!(await this.access.host(webinar, principal)) && !(await this.access.canModerate(webinar, principal))) {
      return this.access.deny(principal, ACTIONS['event.moderate'], webinar);
    }
    const poll = await this.poll(webinar, pollId);
    if (!poll.closedAt) throw conflict('poll_not_closed', 'Results are shown once the poll is closed');
    return this.results(webinar, poll);
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
    const registration = await this.access.scoped(webinar.orgId, (tx) =>
      this.repo.findRegistration(webinar.id, principal.userId, tx),
    );
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
