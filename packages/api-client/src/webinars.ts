/**
 * Typed wrappers for the webinar routes (T-CW-2.4, decision record section 7,
 * `WebinarsController` and `WebinarsOpsController` of T-CW-2.1), the
 * `webinar:{id}` and `webinar:{id}:moderation` Socket.IO rooms, and the
 * transport the `@nestself/video` webinar client runs on.
 *
 * Every method parses the response through the contracts schema. `join` is
 * the only method that returns meeting credentials: it asks the browser not
 * to cache the response (`cache: 'no-store'`, matching the server) and this
 * module never keeps what it returns; there is no query or mutation option
 * for it (CW-R-59, CW-R-69). An attendee join response that would send on any
 * channel fails the parse (D-CW-35).
 *
 * Eligibility is never a query parameter: `GET /webinars` answers only the
 * occurrences whose audience includes the caller (WBN-01, CW-R-32).
 *
 * The api-client does not depend on `@nestself/video` or `socket.io-client`:
 * the transport is structurally the video package's `WebinarTransport`, and
 * the apps' tests check that its routes match `WEBINAR_ACTION_ROUTES`.
 */
import { z } from 'zod';
import {
  WEBINAR_EVENT_NAMES,
  WEBINAR_ROOM_ADDED_EVENT_NAMES,
  WebinarAttendanceResponseSchema,
  WebinarFloorResponseSchema,
  WebinarHandRaiseResponseSchema,
  WebinarJoinResponseSchema,
  WebinarListResponseSchema,
  WebinarMessageListResponseSchema,
  WebinarMessageSchema,
  WebinarModerationMessageListResponseSchema,
  WebinarModerationMessageSchema,
  WebinarOpsListResponseSchema,
  WebinarOpsResponseSchema,
  WebinarPollResultsSchema,
  WebinarPollSchema,
  WebinarPollVoteResponseSchema,
  WebinarRecordingStatusResponseSchema,
  WebinarRegistrationResponseSchema,
  WebinarResponseSchema,
  WebinarStatusResponseSchema,
  userRoomName,
  webinarRoomName,
} from '@nestself/contracts';
import type {
  WebinarCreateRequestSchema,
  WebinarMessageAnswerRequest,
  WebinarMessageCreateRequest,
  WebinarMessagePublishRequest,
  WebinarPollCreateRequest,
  WebinarPollVoteRequest,
  WebinarStatus,
  WebinarUpdateRequest,
} from '@nestself/contracts';
import type { RoomSocket } from './call-room';
import type { ApiClient } from './client';
import { ApiError } from './errors';

/** Query of `GET /webinars` and `GET /ops/webinars` (`WebinarListQuerySchema`); every field is optional. */
export interface WebinarListParams {
  cursor?: string;
  limit?: number;
  status?: WebinarStatus;
  /** Inclusive lower bound of `startsAt` (ISO date-time). */
  from?: string;
  /** Exclusive upper bound of `startsAt` (ISO date-time). */
  to?: string;
  orgId?: string;
}

/** Query of `GET /webinars/:id/messages`. */
export interface WebinarMessageListParams {
  cursor?: string;
  limit?: number;
}

/** The occurrence form's body before the contract's defaults (`presenterUserIds`, `moderatorUserId`, `capacity`). */
export type WebinarCreateBody = z.input<typeof WebinarCreateRequestSchema>;

function json(method: 'POST' | 'PATCH', body: unknown = {}): RequestInit {
  return { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}

function queryString(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params) as [string, unknown][]) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

const id = encodeURIComponent;
const webinarPath = (webinarId: string, suffix = '') => `/api/webinars/${id(webinarId)}${suffix}`;
const opsPath = (webinarId: string, suffix = '') => `/api/ops/webinars/${id(webinarId)}${suffix}`;

/** Moderators receive every message with the registration name; everyone else the published ones (CW-R-104). */
const MessageListSchema = z.union([WebinarModerationMessageListResponseSchema, WebinarMessageListResponseSchema]);
const SentMessageSchema = z.union([WebinarModerationMessageSchema, WebinarMessageSchema]);

export function createWebinarsApi(client: ApiClient) {
  return {
    // ── Discovery and registration (WBN-01 to WBN-03) ──────────────────────

    /** GET /webinars: one cursor page of the occurrences the caller may attend. */
    list: (params: WebinarListParams = {}) =>
      client.request(`/api/webinars${queryString(params)}`, { method: 'GET', schema: WebinarListResponseSchema }),

    /** GET /webinars/:id: an attendee in the audience, a registrant, a host or moderating staff. */
    get: (webinarId: string) => client.request(webinarPath(webinarId), { method: 'GET', schema: WebinarResponseSchema }),

    /** POST /webinars/:id/register (empty body). 409 `webinar_full`, `already_registered`, `registration_closed`; 403 `not_eligible`. */
    register: (webinarId: string) =>
      client.request(webinarPath(webinarId, '/register'), { ...json('POST'), schema: WebinarRegistrationResponseSchema }),

    /** DELETE /webinars/:id/register, while the occurrence is `published`. */
    unregister: (webinarId: string) =>
      client.request(webinarPath(webinarId, '/register'), { method: 'DELETE', schema: WebinarRegistrationResponseSchema }),

    // ── Live session (WBN-07, WBN-16, WBN-17, WBN-21) ──────────────────────

    /**
     * POST /webinars/:id/join: Chime SDK credentials, receive-only for an
     * attendee. 409 `webinar_not_open` until a host starts the webinar (the
     * lobby). Not cached by the browser, never logged, never stored.
     */
    join: (webinarId: string) =>
      client.request(webinarPath(webinarId, '/join'), { ...json('POST'), cache: 'no-store', schema: WebinarJoinResponseSchema }),

    /** POST /webinars/:id/start: a host moves `published` to `live`; the recording starts with it. */
    start: (webinarId: string) =>
      client.request(webinarPath(webinarId, '/start'), { ...json('POST'), schema: WebinarStatusResponseSchema }),

    /** POST /webinars/:id/end: a host moves `live` to `ended` for everyone. */
    end: (webinarId: string) =>
      client.request(webinarPath(webinarId, '/end'), { ...json('POST'), schema: WebinarStatusResponseSchema }),

    // ── Chat (D-CW-35) ─────────────────────────────────────────────────────

    /** GET /webinars/:id/messages: published and answered for attendees and presenters, every status for the moderator. */
    listMessages: (webinarId: string, params: WebinarMessageListParams = {}) =>
      client.request(webinarPath(webinarId, `/messages${queryString(params)}`), { method: 'GET', schema: MessageListSchema }),

    /** POST /webinars/:id/messages: an attendee writes to the hosts, a host to everyone. */
    sendMessage: (webinarId: string, body: WebinarMessageCreateRequest) =>
      client.request(webinarPath(webinarId, '/messages'), { ...json('POST', body), schema: SentMessageSchema }),

    publishMessage: (webinarId: string, messageId: string, body: WebinarMessagePublishRequest = {}) =>
      client.request(webinarPath(webinarId, `/messages/${id(messageId)}/publish`), {
        ...json('POST', body),
        schema: WebinarModerationMessageSchema,
      }),

    answerMessage: (webinarId: string, messageId: string, body: WebinarMessageAnswerRequest) =>
      client.request(webinarPath(webinarId, `/messages/${id(messageId)}/answer`), {
        ...json('POST', body),
        schema: WebinarModerationMessageSchema,
      }),

    dismissMessage: (webinarId: string, messageId: string) =>
      client.request(webinarPath(webinarId, `/messages/${id(messageId)}/dismiss`), {
        ...json('POST'),
        schema: WebinarModerationMessageSchema,
      }),

    // ── Hand-raise and floor (D-CW-15) ─────────────────────────────────────

    raiseHand: (webinarId: string) =>
      client.request(webinarPath(webinarId, '/hand'), { ...json('POST'), schema: WebinarHandRaiseResponseSchema }),

    lowerHand: (webinarId: string) =>
      client.request(webinarPath(webinarId, '/hand'), { method: 'DELETE', schema: WebinarHandRaiseResponseSchema }),

    /** Audio only: video and content stay `receive` (CW-R-108). */
    giveFloor: (webinarId: string, participantId: string) =>
      client.request(webinarPath(webinarId, `/participants/${id(participantId)}/give-floor`), {
        ...json('POST'),
        schema: WebinarFloorResponseSchema,
      }),

    takeFloor: (webinarId: string, participantId: string) =>
      client.request(webinarPath(webinarId, `/participants/${id(participantId)}/take-floor`), {
        ...json('POST'),
        schema: WebinarFloorResponseSchema,
      }),

    // ── Polls (D-CW-16) ────────────────────────────────────────────────────

    createPoll: (webinarId: string, body: WebinarPollCreateRequest) =>
      client.request(webinarPath(webinarId, '/polls'), { ...json('POST', body), schema: WebinarPollSchema }),

    openPoll: (webinarId: string, pollId: string) =>
      client.request(webinarPath(webinarId, `/polls/${id(pollId)}/open`), { ...json('POST'), schema: WebinarPollSchema }),

    /** Answers the aggregate results; everyone else receives them as `webinar.poll.results`. */
    closePoll: (webinarId: string, pollId: string) =>
      client.request(webinarPath(webinarId, `/polls/${id(pollId)}/close`), { ...json('POST'), schema: WebinarPollResultsSchema }),

    /** The option only: no voter field fits (CW-R-24). */
    vote: (webinarId: string, pollId: string, body: WebinarPollVoteRequest) =>
      client.request(webinarPath(webinarId, `/polls/${id(pollId)}/vote`), { ...json('POST', body), schema: WebinarPollVoteResponseSchema }),

    // ── Recording (D-CW-18, D-CW-34) ───────────────────────────────────────

    /** GET /webinars/:id/recording: the recording state, for the REC indicator of a host or attendee joining late (UX-45). */
    recording: (webinarId: string) =>
      client.request(webinarPath(webinarId, '/recording'), { method: 'GET', schema: WebinarRecordingStatusResponseSchema }),

    /** POST /webinars/:id/recording/stop: the moderator's early stop; the start is automatic. */
    stopRecording: (webinarId: string) =>
      client.request(webinarPath(webinarId, '/recording/stop'), { ...json('POST'), schema: WebinarRecordingStatusResponseSchema }),

    // ── Operations (WBN-30 to WBN-33) ──────────────────────────────────────

    /** GET /ops/webinars: the occurrences the caller may manage or moderate, every status. */
    listOps: (params: WebinarListParams = {}) =>
      client.request(`/api/ops/webinars${queryString(params)}`, { method: 'GET', schema: WebinarOpsListResponseSchema }),

    /** POST /ops/webinars: a `draft`. 400 `capacity_above_limit` above 250 until M3 (D-CW-36). */
    createOps: (body: WebinarCreateBody) =>
      client.request('/api/ops/webinars', { ...json('POST', body), schema: WebinarOpsResponseSchema }),

    /** PATCH /ops/webinars/:id while `draft` or `published`. */
    updateOps: (webinarId: string, body: WebinarUpdateRequest) =>
      client.request(opsPath(webinarId), { ...json('PATCH', body), schema: WebinarOpsResponseSchema }),

    /** POST /ops/webinars/:id/publish: `draft` to `published` (WBN-31). */
    publish: (webinarId: string) =>
      client.request(opsPath(webinarId, '/publish'), { ...json('POST'), schema: WebinarStatusResponseSchema }),

    /** POST /ops/webinars/:id/cancel from `draft` or `published` (WBN-32). */
    cancel: (webinarId: string) =>
      client.request(opsPath(webinarId, '/cancel'), { ...json('POST'), schema: WebinarStatusResponseSchema }),

    /** GET /ops/webinars/:id/attendance: counts and one row per registration id, never a name (WBN-33). */
    attendance: (webinarId: string) =>
      client.request(opsPath(webinarId, '/attendance'), { method: 'GET', schema: WebinarAttendanceResponseSchema }),
  };
}

export type WebinarsApi = ReturnType<typeof createWebinarsApi>;

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

export interface WebinarRoomHandlers {
  /** Every webinar event, raw: the webinar client validates it against the contract. */
  onEvent: (event: string, payload: unknown) => void;
  /** The subscription was refused or the socket could not connect; the media are unaffected. */
  onUnavailable?: (reason: string) => void;
}

export interface WebinarRoomClient {
  /** Joins the rooms on one socket; the returned function leaves them and closes the socket. */
  subscribe(rooms: readonly string[], handlers: WebinarRoomHandlers): () => void;
}

/** Sample mode and tests: no socket, no events. */
export const noopWebinarRoomClient: WebinarRoomClient = {
  subscribe: () => () => undefined,
};

const DeniedSchema = z.object({ room: z.string().nullable().optional(), reason: z.string().optional() });

/** Section 7's webinar events and the public-room additions of T-CW-2.3 (`webinar.message.removed`, `webinar.floor.state`). */
const FORWARDED_EVENTS: readonly string[] = [...WEBINAR_EVENT_NAMES, ...WEBINAR_ROOM_ADDED_EVENT_NAMES];

/**
 * The webinar rooms over Socket.IO. The server derives the authorisation from
 * the room name (`webinar:` needs `event.register`, `:moderation` needs
 * `event.moderate`, `user:` is that user only), so the subscribe message is
 * the room alone.
 */
export function createWebinarRoomClient(connect: () => RoomSocket): WebinarRoomClient {
  return {
    subscribe(rooms, handlers) {
      const socket = connect();
      let active = true;

      // Room membership does not survive a reconnect: subscribe on every connect.
      socket.on('connect', () => {
        if (!active) return;
        for (const room of rooms) socket.emit('subscribe', { room });
      });
      socket.on('connect_error', () => {
        if (active) handlers.onUnavailable?.('connect_error');
      });
      socket.on('subscribe:denied', ((payload: unknown) => {
        const denied = DeniedSchema.safeParse(payload);
        if (active && denied.success && denied.data.room && rooms.includes(denied.data.room)) {
          handlers.onUnavailable?.(denied.data.reason ?? 'denied');
        }
      }) as (...args: never[]) => void);
      for (const event of FORWARDED_EVENTS) {
        socket.on(event, ((payload: unknown) => {
          if (active) handlers.onEvent(event, payload);
        }) as (...args: never[]) => void);
      }

      return () => {
        if (!active) return;
        active = false;
        for (const room of rooms) socket.emit('unsubscribe', { room });
        socket.disconnect();
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Transport of the `@nestself/video` webinar client
// ---------------------------------------------------------------------------

/**
 * The webinar client's actions: `WEBINAR_ACTIONS` of `@nestself/video`, and
 * `webinar.end` (`POST /webinars/:id/end`), which the video package is adding.
 */
export const WEBINAR_TRANSPORT_ACTIONS = [
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
export type WebinarTransportAction = (typeof WEBINAR_TRANSPORT_ACTIONS)[number];

/** The route each action calls, as `WEBINAR_ACTION_ROUTES` in `@nestself/video` names it (`:id` is the webinar). */
export const WEBINAR_TRANSPORT_ROUTES = {
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
} as const satisfies Record<WebinarTransportAction, { method: 'POST' | 'DELETE'; path: string }>;

/** An action's path ids and body; the webinar client validates the body against the contract first. */
export interface WebinarTransportInput {
  body?: unknown;
  messageId?: string;
  participantId?: string;
  pollId?: string;
}

export interface WebinarTransportOptions {
  api: WebinarsApi;
  rooms: WebinarRoomClient;
  webinarId: string;
  /** The signed-in user: the floor events go to `user:{userId}` (CW-R-34) and arrive with the public room's events (`webinar:{id}` only). */
  userId?: string | null;
  onUnavailable?: (reason: string) => void;
}

export interface WebinarTransportImpl {
  subscribe(room: string, handler: (event: string, payload: unknown) => void): () => void;
  post(action: WebinarTransportAction, input: WebinarTransportInput): Promise<unknown>;
}

function pathId(value: string | undefined, action: WebinarTransportAction): string {
  if (value) return value;
  throw new ApiError({ status: 0, code: 'validation', message: `Missing path id for ${action}`, requestId: null });
}

/**
 * The `WebinarTransport` of one webinar: actions call the API routes of
 * `WEBINAR_TRANSPORT_ROUTES` and reject with the `ApiError` and its `code`;
 * the public room is joined together with the user's own room on one socket,
 * so the per-participant floor events reach the public room's handler.
 */
export function createWebinarTransport({ api, rooms, webinarId, userId, onUnavailable }: WebinarTransportOptions): WebinarTransportImpl {
  return {
    subscribe(room, handler) {
      // Only the public room carries the user's room along; the hosts' and moderation rooms stand alone.
      const names = room === webinarRoomName(webinarId) && userId ? [room, userRoomName(userId)] : [room];
      return rooms.subscribe(names, { onEvent: handler, onUnavailable });
    },

    post(action, input) {
      const call = (): Promise<unknown> => {
        switch (action) {
          case 'message.send':
            return api.sendMessage(webinarId, input.body as WebinarMessageCreateRequest);
          case 'message.publish':
            return api.publishMessage(webinarId, pathId(input.messageId, action), (input.body ?? {}) as WebinarMessagePublishRequest);
          case 'message.answer':
            return api.answerMessage(webinarId, pathId(input.messageId, action), input.body as WebinarMessageAnswerRequest);
          case 'message.dismiss':
            return api.dismissMessage(webinarId, pathId(input.messageId, action));
          case 'hand.raise':
            return api.raiseHand(webinarId);
          case 'hand.lower':
            return api.lowerHand(webinarId);
          case 'floor.give':
            return api.giveFloor(webinarId, pathId(input.participantId, action));
          case 'floor.take':
            return api.takeFloor(webinarId, pathId(input.participantId, action));
          case 'poll.open':
            return api.openPoll(webinarId, pathId(input.pollId, action));
          case 'poll.close':
            return api.closePoll(webinarId, pathId(input.pollId, action));
          case 'poll.vote':
            return api.vote(webinarId, pathId(input.pollId, action), input.body as WebinarPollVoteRequest);
          case 'recording.stop':
            return api.stopRecording(webinarId);
          case 'webinar.end':
            return api.end(webinarId);
        }
      };
      try {
        return call();
      } catch (error) {
        return Promise.reject(error);
      }
    },
  };
}

// The query options live beside the calls' ones; re-exported so the package index needs one line.
export * from './queries/webinars';
