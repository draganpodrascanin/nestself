/**
 * The webinar wrappers (T-CW-2.4): every route of decision record section 7
 * and `WebinarsController` / `WebinarsOpsController`, with method, path and
 * body asserted, the response parse, the coded failure, and the transport
 * the webinar client runs on (actions to routes, rooms to one socket).
 */
import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';
import { ApiError } from './errors';
import type { RoomSocket } from './call-room';
import {
  WEBINAR_TRANSPORT_ACTIONS,
  WEBINAR_TRANSPORT_ROUTES,
  createWebinarRoomClient,
  createWebinarTransport,
  createWebinarsApi,
  noopWebinarRoomClient,
} from './webinars';
import type { WebinarRoomClient } from './webinars';

const AT = '2030-01-20T16:00:00.000Z';
const END = '2030-01-20T17:00:00.000Z';

const WEBINAR = {
  id: 'web_1',
  title: { en: 'Planning a balanced week' },
  description: null,
  startsAt: AT,
  endsAt: END,
  timeZone: 'Europe/Belgrade',
  status: 'published',
  capacity: 250,
  capacityRemaining: 249,
  presenters: [{ displayName: 'Milica' }],
  registered: false,
};

const OCCURRENCE = {
  id: 'web_1',
  orgId: null,
  title: { en: 'Planning a balanced week' },
  description: null,
  audiencePolicy: { type: 'all_eligible' },
  capacity: 250,
  startsAt: AT,
  endsAt: END,
  timeZone: 'Europe/Belgrade',
  status: 'draft',
  chatPolicy: 'moderated',
  createdByUserId: 'user_nikola',
  hosts: [],
};

const MESSAGE = {
  id: 'msg_1',
  webinarId: 'web_1',
  kind: 'attendee',
  status: 'pending',
  text: 'Could you repeat the example?',
  authorFirstName: null,
  answerText: null,
  publishedAt: null,
  createdAt: AT,
};

const MODERATION_MESSAGE = { ...MESSAGE, authorParticipantId: 'part_1', authorName: 'Jovan Petrović', showFirstName: false };

const POLL = {
  id: 'poll_1',
  webinarId: 'web_1',
  question: 'Which break?',
  options: [
    { id: 'opt_a', label: 'A walk', position: 0 },
    { id: 'opt_b', label: 'Tea', position: 1 },
  ],
  openedAt: null,
  closedAt: null,
};

const RESULTS = { pollId: 'poll_1', totalVotes: 3, results: [{ optionId: 'opt_a', count: 2 }, { optionId: 'opt_b', count: 1 }] };

interface Sent {
  url: string;
  method: string;
  body: unknown;
  cache: RequestCache | undefined;
}

function setup(responseBody: unknown, status = 200) {
  const sent: Sent[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    sent.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      cache: init?.cache,
    });
    return new Response(JSON.stringify(responseBody), { status, headers: { 'content-type': 'application/json' } });
  };
  const api = createWebinarsApi(createApiClient({ baseUrl: 'http://x', mode: 'cookie', fetchImpl }));
  return { api, sent, last: () => sent[sent.length - 1]! };
}

describe('webinar discovery and registration', () => {
  it('lists eligible webinars with the cursor and filters as query parameters, never an eligibility flag', async () => {
    const { api, last } = setup({ items: [WEBINAR], nextCursor: 'next' });
    await expect(api.list({ cursor: 'c1', limit: 20, status: 'published' })).resolves.toEqual({ items: [WEBINAR], nextCursor: 'next' });
    expect(last()).toMatchObject({ url: 'http://x/api/webinars?cursor=c1&limit=20&status=published', method: 'GET' });
    await api.list();
    expect(last().url).toBe('http://x/api/webinars');
  });

  it('reads one webinar', async () => {
    const { api, last } = setup(WEBINAR);
    await expect(api.get('web_1')).resolves.toEqual(WEBINAR);
    expect(last()).toMatchObject({ url: 'http://x/api/webinars/web_1', method: 'GET' });
  });

  it('registers with an empty body and unregisters with DELETE', async () => {
    const { api, last } = setup({ webinarId: 'web_1', registered: true, registeredAt: AT });
    await expect(api.register('web_1')).resolves.toEqual({ webinarId: 'web_1', registered: true, registeredAt: AT });
    expect(last()).toMatchObject({ url: 'http://x/api/webinars/web_1/register', method: 'POST', body: {} });

    const off = setup({ webinarId: 'web_1', registered: false, registeredAt: null });
    await off.api.unregister('web_1');
    expect(off.last()).toMatchObject({ url: 'http://x/api/webinars/web_1/register', method: 'DELETE', body: undefined });
  });

  it('keeps the API code of a refused registration (webinar_full)', async () => {
    const { api } = setup({ code: 'webinar_full', message: 'The webinar is full' }, 409);
    const failure = await api.register('web_1').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 409, code: 'webinar_full' });
  });

  it('encodes the webinar id in the path', async () => {
    const { api, last } = setup(WEBINAR);
    await api.get('web/1');
    expect(last().url).toBe('http://x/api/webinars/web%2F1');
  });
});

describe('webinar live routes', () => {
  it('joins without browser caching and parses the receive-only attendee response', async () => {
    const join = {
      webinarId: 'web_1',
      sessionId: 'sess_1',
      participantId: 'part_1',
      format: 'webinar',
      startsAt: AT,
      endsAt: END,
      meeting: {
        MeetingId: 'm1',
        MediaRegion: 'eu-central-1',
        MediaPlacement: { AudioHostUrl: 'a:1', AudioFallbackUrl: 'b', SignalingUrl: 'c' },
      },
      attendee: { AttendeeId: 'att_1', ExternalUserId: 'part_1', JoinToken: 'token' },
      role: 'attendee',
      capabilities: { audio: 'receive', video: 'receive', content: 'receive' },
    };
    const { api, last } = setup(join);
    await expect(api.join('web_1')).resolves.toMatchObject({ role: 'attendee', participantId: 'part_1' });
    expect(last()).toEqual({ url: 'http://x/api/webinars/web_1/join', method: 'POST', body: {}, cache: 'no-store' });
  });

  it('refuses an attendee join response that would send video', async () => {
    const { api } = setup({
      webinarId: 'web_1',
      sessionId: 'sess_1',
      participantId: 'part_1',
      format: 'webinar',
      startsAt: AT,
      endsAt: END,
      meeting: { MeetingId: 'm1', MediaRegion: 'eu-central-1', MediaPlacement: { AudioHostUrl: 'a:1', AudioFallbackUrl: 'b', SignalingUrl: 'c' } },
      attendee: { AttendeeId: 'att_1', ExternalUserId: 'part_1', JoinToken: 'token' },
      role: 'attendee',
      capabilities: { audio: 'receive', video: 'send_receive', content: 'receive' },
    });
    await expect(api.join('web_1')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('starts and ends the webinar', async () => {
    const { api, last } = setup({ webinarId: 'web_1', status: 'live' });
    await expect(api.start('web_1')).resolves.toEqual({ webinarId: 'web_1', status: 'live' });
    expect(last()).toMatchObject({ url: 'http://x/api/webinars/web_1/start', method: 'POST' });
    await api.end('web_1');
    expect(last()).toMatchObject({ url: 'http://x/api/webinars/web_1/end', method: 'POST' });
  });

  it('lists messages for attendees and for the moderator', async () => {
    const published = { ...MESSAGE, status: 'published', publishedAt: AT };
    const attendee = setup({ items: [published], nextCursor: null });
    await expect(attendee.api.listMessages('web_1', { limit: 50 })).resolves.toEqual({ items: [published], nextCursor: null });
    expect(attendee.last()).toMatchObject({ url: 'http://x/api/webinars/web_1/messages?limit=50', method: 'GET' });

    const moderator = setup({ items: [MODERATION_MESSAGE], nextCursor: null });
    await expect(moderator.api.listMessages('web_1')).resolves.toEqual({ items: [MODERATION_MESSAGE], nextCursor: null });
  });

  it('sends, publishes, answers and dismisses messages', async () => {
    const { api, last } = setup(MODERATION_MESSAGE);
    await api.sendMessage('web_1', { kind: 'question', text: 'Could you repeat the example?', showFirstName: false });
    expect(last()).toMatchObject({
      url: 'http://x/api/webinars/web_1/messages',
      method: 'POST',
      body: { kind: 'question', text: 'Could you repeat the example?', showFirstName: false },
    });
    await api.publishMessage('web_1', 'msg_1', { text: 'Edited' });
    expect(last()).toMatchObject({ url: 'http://x/api/webinars/web_1/messages/msg_1/publish', method: 'POST', body: { text: 'Edited' } });

    const answered = setup({ ...MODERATION_MESSAGE, status: 'answered', answerText: 'Yes', publishedAt: AT });
    await answered.api.answerMessage('web_1', 'msg_1', { answerText: 'Yes' });
    expect(answered.last()).toMatchObject({ url: 'http://x/api/webinars/web_1/messages/msg_1/answer', method: 'POST', body: { answerText: 'Yes' } });

    const dismissed = setup({ ...MODERATION_MESSAGE, status: 'dismissed' });
    await dismissed.api.dismissMessage('web_1', 'msg_1');
    expect(dismissed.last()).toMatchObject({ url: 'http://x/api/webinars/web_1/messages/msg_1/dismiss', method: 'POST', body: {} });
  });

  it('raises and lowers the hand, gives and takes the floor', async () => {
    const hand = setup({ raised: true, raisedAt: AT });
    await hand.api.raiseHand('web_1');
    expect(hand.last()).toMatchObject({ url: 'http://x/api/webinars/web_1/hand', method: 'POST' });
    const lowered = setup({ raised: false, raisedAt: null });
    await lowered.api.lowerHand('web_1');
    expect(lowered.last()).toMatchObject({ url: 'http://x/api/webinars/web_1/hand', method: 'DELETE' });

    const floor = setup({ participantId: 'part_1', hasFloor: true, capabilities: { audio: 'send_receive', video: 'receive', content: 'receive' } });
    await floor.api.giveFloor('web_1', 'part_1');
    expect(floor.last()).toMatchObject({ url: 'http://x/api/webinars/web_1/participants/part_1/give-floor', method: 'POST' });
    const taken = setup({ participantId: 'part_1', hasFloor: false, capabilities: { audio: 'receive', video: 'receive', content: 'receive' } });
    await taken.api.takeFloor('web_1', 'part_1');
    expect(taken.last()).toMatchObject({ url: 'http://x/api/webinars/web_1/participants/part_1/take-floor', method: 'POST' });
  });

  it('creates, opens, closes and votes in polls; the vote carries the option only', async () => {
    const created = setup(POLL);
    await created.api.createPoll('web_1', { question: 'Which break?', options: ['A walk', 'Tea'] });
    expect(created.last()).toMatchObject({ url: 'http://x/api/webinars/web_1/polls', method: 'POST', body: { question: 'Which break?', options: ['A walk', 'Tea'] } });
    await created.api.openPoll('web_1', 'poll_1');
    expect(created.last()).toMatchObject({ url: 'http://x/api/webinars/web_1/polls/poll_1/open', method: 'POST' });

    const closed = setup(RESULTS);
    await expect(closed.api.closePoll('web_1', 'poll_1')).resolves.toEqual(RESULTS);
    expect(closed.last()).toMatchObject({ url: 'http://x/api/webinars/web_1/polls/poll_1/close', method: 'POST' });

    const voted = setup({ pollId: 'poll_1', voted: true });
    await voted.api.vote('web_1', 'poll_1', { optionId: 'opt_a' });
    expect(voted.last()).toEqual({ url: 'http://x/api/webinars/web_1/polls/poll_1/vote', method: 'POST', body: { optionId: 'opt_a' }, cache: undefined });
  });

  it('reads the recording state', async () => {
    const { api, last } = setup({ webinarId: 'web_1', status: 'recording', startedAt: AT, stoppedAt: null });
    await expect(api.recording('web_1')).resolves.toEqual({ webinarId: 'web_1', status: 'recording', startedAt: AT, stoppedAt: null });
    expect(last()).toMatchObject({ url: 'http://x/api/webinars/web_1/recording', method: 'GET' });
  });

  it('stops the recording early', async () => {
    const { api, last } = setup({ webinarId: 'web_1', status: 'processing', startedAt: AT, stoppedAt: END });
    await expect(api.stopRecording('web_1')).resolves.toMatchObject({ status: 'processing' });
    expect(last()).toMatchObject({ url: 'http://x/api/webinars/web_1/recording/stop', method: 'POST', body: {} });
  });
});

describe('webinar operations routes', () => {
  it('lists, creates and edits occurrences', async () => {
    const list = setup({ items: [OCCURRENCE], nextCursor: null });
    await expect(list.api.listOps({ status: 'draft' })).resolves.toEqual({ items: [OCCURRENCE], nextCursor: null });
    expect(list.last()).toMatchObject({ url: 'http://x/api/ops/webinars?status=draft', method: 'GET' });

    const create = setup(OCCURRENCE, 201);
    const body = {
      title: { en: 'Planning a balanced week' },
      startsAt: AT,
      endsAt: END,
      timeZone: 'Europe/Belgrade',
      audiencePolicy: { type: 'all_eligible' as const },
      capacity: 120,
      presenterUserIds: ['user_milica'],
      moderatorUserId: 'user_nikola',
    };
    await expect(create.api.createOps(body)).resolves.toEqual(OCCURRENCE);
    expect(create.last()).toMatchObject({ url: 'http://x/api/ops/webinars', method: 'POST', body });

    const update = setup(OCCURRENCE);
    await update.api.updateOps('web_1', { capacity: 200 });
    expect(update.last()).toMatchObject({ url: 'http://x/api/ops/webinars/web_1', method: 'PATCH', body: { capacity: 200 } });
  });

  it('keeps the capacity_above_limit code of the form validation', async () => {
    const { api } = setup({ code: 'capacity_above_limit', message: 'At most 250', details: { field: 'capacity', limit: 250 } }, 400);
    await expect(api.createOps({ ...OCCURRENCE, capacity: 300 } as never)).rejects.toMatchObject({
      status: 400,
      code: 'capacity_above_limit',
      details: { field: 'capacity', limit: 250 },
    });
  });

  it('publishes and cancels', async () => {
    const { api, last } = setup({ webinarId: 'web_1', status: 'published' });
    await expect(api.publish('web_1')).resolves.toEqual({ webinarId: 'web_1', status: 'published' });
    expect(last()).toMatchObject({ url: 'http://x/api/ops/webinars/web_1/publish', method: 'POST' });
    const canceled = setup({ webinarId: 'web_1', status: 'canceled' });
    await canceled.api.cancel('web_1');
    expect(canceled.last()).toMatchObject({ url: 'http://x/api/ops/webinars/web_1/cancel', method: 'POST' });
  });

  it('reads the attendance report', async () => {
    const report = { webinarId: 'web_1', registeredCount: 3, joinedCount: 2, peakConcurrent: 2, registrants: [] };
    const { api, last } = setup(report);
    await expect(api.attendance('web_1')).resolves.toEqual(report);
    expect(last()).toMatchObject({ url: 'http://x/api/ops/webinars/web_1/attendance', method: 'GET' });
  });
});

class FakeSocket implements RoomSocket {
  readonly listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  readonly emitted: [string, unknown][] = [];
  disconnected = false;

  on(event: string, listener: (...args: never[]) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener as (...args: unknown[]) => void]);
    return this;
  }
  emit(event: string, payload?: unknown) {
    this.emitted.push([event, payload]);
    return this;
  }
  disconnect() {
    this.disconnected = true;
    return this;
  }
  fire(event: string, payload?: unknown) {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }
}

describe('webinar room client', () => {
  it('subscribes to every room of one socket on every connect and leaves them on release', () => {
    const socket = new FakeSocket();
    const release = createWebinarRoomClient(() => socket).subscribe(['webinar:web_1', 'user:user_jovan'], { onEvent: () => undefined });
    socket.fire('connect');
    socket.fire('connect');
    expect(socket.emitted).toEqual([
      ['subscribe', { room: 'webinar:web_1' }],
      ['subscribe', { room: 'user:user_jovan' }],
      ['subscribe', { room: 'webinar:web_1' }],
      ['subscribe', { room: 'user:user_jovan' }],
    ]);
    release();
    release();
    expect(socket.emitted.slice(4)).toEqual([
      ['unsubscribe', { room: 'webinar:web_1' }],
      ['unsubscribe', { room: 'user:user_jovan' }],
    ]);
    expect(socket.disconnected).toBe(true);
  });

  it('forwards every webinar event raw and nothing after release', () => {
    const socket = new FakeSocket();
    const onEvent = vi.fn();
    const release = createWebinarRoomClient(() => socket).subscribe(['webinar:web_1'], { onEvent });
    socket.fire('webinar.state', { webinarId: 'web_1', status: 'live' });
    socket.fire('webinar.floor.given', { participantId: 'part_1' });
    socket.fire('webinar.message.removed', { messageId: 'msg_1' });
    socket.fire('webinar.floor.state', { active: true });
    socket.fire('appointment.remind', { appointmentId: 'a1' });
    expect(onEvent.mock.calls).toEqual([
      ['webinar.state', { webinarId: 'web_1', status: 'live' }],
      ['webinar.floor.given', { participantId: 'part_1' }],
      ['webinar.message.removed', { messageId: 'msg_1' }],
      ['webinar.floor.state', { active: true }],
    ]);
    release();
    socket.fire('webinar.state', { webinarId: 'web_1', status: 'ended' });
    expect(onEvent).toHaveBeenCalledTimes(4);
  });

  it('reports a refused subscription or a failed connection', () => {
    const socket = new FakeSocket();
    const onUnavailable = vi.fn();
    createWebinarRoomClient(() => socket).subscribe(['webinar:web_1:moderation'], { onEvent: () => undefined, onUnavailable });
    socket.fire('subscribe:denied', { room: 'webinar:other', reason: 'forbidden' });
    socket.fire('subscribe:denied', { room: 'webinar:web_1:moderation', reason: 'forbidden' });
    socket.fire('connect_error');
    expect(onUnavailable.mock.calls).toEqual([['forbidden'], ['connect_error']]);
  });

  it('has a no-op client for sample mode and tests', () => {
    const release = noopWebinarRoomClient.subscribe(['webinar:web_1'], { onEvent: () => undefined });
    expect(release()).toBeUndefined();
  });
});

describe('webinar transport', () => {
  const ROUTE_INPUTS = {
    'message.send': { body: { kind: 'attendee', text: 'Hello', showFirstName: false } },
    'message.publish': { messageId: 'msg_1', body: {} },
    'message.answer': { messageId: 'msg_1', body: { answerText: 'Yes' } },
    'message.dismiss': { messageId: 'msg_1', body: {} },
    'hand.raise': { body: {} },
    'hand.lower': { body: {} },
    'floor.give': { participantId: 'part_1', body: {} },
    'floor.take': { participantId: 'part_1', body: {} },
    'poll.open': { pollId: 'poll_1', body: {} },
    'poll.close': { pollId: 'poll_1', body: {} },
    'poll.vote': { pollId: 'poll_1', body: { optionId: 'opt_a' } },
    'recording.stop': { body: {} },
    'webinar.end': { body: {} },
  } as const;

  function transportSetup() {
    const sent: { method: string; path: string; body: unknown }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      sent.push({ method: init?.method ?? 'GET', path: new URL(String(input)).pathname, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      return new Response('{}', { status: 400, headers: { 'content-type': 'application/json' } });
    };
    const api = createWebinarsApi(createApiClient({ baseUrl: 'http://x', mode: 'cookie', fetchImpl }));
    return { api, sent };
  }

  it('posts each action to its route with the action body', async () => {
    const { api, sent } = transportSetup();
    const transport = createWebinarTransport({ api, rooms: noopWebinarRoomClient, webinarId: 'web_1', userId: 'user_jovan' });
    for (const action of WEBINAR_TRANSPORT_ACTIONS) {
      await transport.post(action, ROUTE_INPUTS[action]).catch(() => undefined);
      const route = WEBINAR_TRANSPORT_ROUTES[action];
      const path = route.path
        .replace(':id', 'web_1')
        .replace(':messageId', 'msg_1')
        .replace(':participantId', 'part_1')
        .replace(':pollId', 'poll_1');
      expect(sent.at(-1), action).toMatchObject({ method: route.method, path: `/api${path}` });
    }
    expect(sent.find((entry) => entry.path.endsWith('/vote'))?.body).toEqual({ optionId: 'opt_a' });
    expect(sent.find((entry) => entry.path.endsWith('/answer'))?.body).toEqual({ answerText: 'Yes' });
  });

  it('rejects with the API code, which the webinar client turns into copy', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ code: 'floor_not_available', message: 'No' }), { status: 409, headers: { 'content-type': 'application/json' } });
    const api = createWebinarsApi(createApiClient({ baseUrl: 'http://x', mode: 'cookie', fetchImpl }));
    const transport = createWebinarTransport({ api, rooms: noopWebinarRoomClient, webinarId: 'web_1' });
    await expect(transport.post('floor.give', { participantId: 'part_1', body: {} })).rejects.toMatchObject({ code: 'floor_not_available' });
  });

  it('refuses an action without its path id', async () => {
    const { api, sent } = transportSetup();
    const transport = createWebinarTransport({ api, rooms: noopWebinarRoomClient, webinarId: 'web_1' });
    await expect(transport.post('poll.vote', { body: { optionId: 'opt_a' } })).rejects.toMatchObject({ code: 'validation' });
    expect(sent).toHaveLength(0);
  });

  it('joins the public room with the user room on one socket, so the floor events reach the public handler', () => {
    const subscribe = vi.fn<WebinarRoomClient['subscribe']>(() => () => undefined);
    const { api } = transportSetup();
    const transport = createWebinarTransport({ api, rooms: { subscribe }, webinarId: 'web_1', userId: 'user_jovan' });
    const handler = vi.fn();
    transport.subscribe('webinar:web_1', handler);
    transport.subscribe('webinar:web_1:moderation', handler);
    transport.subscribe('webinar:web_1:hosts', handler);
    expect(subscribe.mock.calls.map(([rooms]) => rooms)).toEqual([
      ['webinar:web_1', 'user:user_jovan'],
      ['webinar:web_1:moderation'],
      ['webinar:web_1:hosts'],
    ]);
    subscribe.mock.calls[0]![1].onEvent('webinar.floor.given', { participantId: 'part_1' });
    expect(handler).toHaveBeenCalledWith('webinar.floor.given', { participantId: 'part_1' });
  });

  it('reports an unavailable room to the app', () => {
    const onUnavailable = vi.fn();
    const subscribe = vi.fn<WebinarRoomClient['subscribe']>((_rooms, handlers) => {
      handlers.onUnavailable?.('forbidden');
      return () => undefined;
    });
    const { api } = transportSetup();
    createWebinarTransport({ api, rooms: { subscribe }, webinarId: 'web_1', onUnavailable }).subscribe('webinar:web_1', () => undefined);
    expect(onUnavailable).toHaveBeenCalledWith('forbidden');
  });
});
