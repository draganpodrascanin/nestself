/**
 * Chime event consumer tests (T-CW-1.2, D-CW-12, guidelines 9.1): the
 * normaliser for both envelopes the chime-events queue receives (the direct
 * `NotificationsConfiguration` message and the EventBridge envelope), the
 * fake provider's events, and the SQS loop with aws-sdk-client-mock: long
 * polling parameters, deletion only after the applier committed, redelivery
 * on failure, unknown meetings deleted, and a graceful stop that waits for
 * the batch in flight. No AWS call is made.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
  type Message,
} from '@aws-sdk/client-sqs';
import { FakeVideoProvider } from '../video/fake-video-provider.js';
import type { VideoProvider } from '../video/video-provider.js';
import { ChimeEventsConsumer, fromFakeEvent, normaliseChimeEvent } from './chime-event-consumer.js';
import { CallEventNotReadyError, type ApplyResult, type CallProviderEvent, type EventApplier } from './event-applier.js';

const QUEUE_URL = 'https://sqs.eu-central-1.amazonaws.com/111111111111/nestself-dev-chime-events';
const TIMESTAMP_MS = Date.parse('2026-11-10T15:00:01.234Z');

const detail = {
  version: '0',
  eventType: 'chime:AttendeeJoined',
  timestamp: TIMESTAMP_MS,
  meetingId: 'meeting-1',
  attendeeId: 'attendee-1',
  externalUserId: 'participant-1',
  externalMeetingId: 'session-1',
  mediaRegion: 'eu-central-1',
  networkType: 'Voip',
};

const eventBridgeEnvelope = {
  version: '0',
  id: '5ee1b2b5-0000-4000-8000-000000000001',
  'detail-type': 'Chime Meeting State Change',
  source: 'aws.chime',
  account: '111111111111',
  time: '2026-11-10T15:00:01Z',
  region: 'eu-central-1',
  resources: [],
  detail,
};

const expected: CallProviderEvent = {
  eventType: 'AttendeeJoined',
  providerMeetingId: 'meeting-1',
  providerAttendeeId: 'attendee-1',
  occurredAt: new Date(TIMESTAMP_MS),
  externalMeetingId: 'session-1',
  externalUserId: 'participant-1',
  source: 'notification',
};

describe('normaliseChimeEvent', () => {
  it('reads a direct notification (the event at the top level)', () => {
    expect(normaliseChimeEvent(detail)).toEqual(expected);
  });

  it('reads an EventBridge envelope (the event under detail) to the same event', () => {
    expect(normaliseChimeEvent(eventBridgeEnvelope)).toEqual({ ...expected, source: 'eventbridge' });
  });

  it.each(['MeetingStarted', 'MeetingEnded', 'AttendeeJoined', 'AttendeeLeft', 'AttendeeDropped'])(
    'strips the chime: prefix of %s in both shapes',
    (name) => {
      const meetingLevel = name.startsWith('Meeting');
      const body = meetingLevel
        ? { ...detail, eventType: `chime:${name}`, attendeeId: undefined, externalUserId: undefined }
        : { ...detail, eventType: `chime:${name}` };
      for (const shape of [body, { ...eventBridgeEnvelope, detail: body }]) {
        const event = normaliseChimeEvent(shape);
        expect(event?.eventType).toBe(name);
        expect(event?.providerAttendeeId).toBe(meetingLevel ? null : 'attendee-1');
        expect(event?.externalUserId).toBe(meetingLevel ? null : 'participant-1');
      }
    },
  );

  it('keeps an event name it does not act on, so it can be stored', () => {
    expect(normaliseChimeEvent({ ...detail, eventType: 'chime:AttendeeVideoStarted' })?.eventType).toBe(
      'AttendeeVideoStarted',
    );
  });

  it('reads a timestamp in seconds, in milliseconds or as an ISO string, else the envelope time', () => {
    expect(normaliseChimeEvent({ ...detail, timestamp: TIMESTAMP_MS / 1000 })?.occurredAt).toEqual(new Date(TIMESTAMP_MS));
    expect(normaliseChimeEvent({ ...detail, timestamp: '2026-11-10T15:00:01.234Z' })?.occurredAt).toEqual(
      new Date(TIMESTAMP_MS),
    );
    const { timestamp: _omit, ...withoutTimestamp } = detail;
    expect(normaliseChimeEvent({ ...eventBridgeEnvelope, detail: withoutTimestamp })?.occurredAt).toEqual(
      new Date('2026-11-10T15:00:01Z'),
    );
  });

  it('refuses a body that is not a Chime meeting event', () => {
    expect(normaliseChimeEvent(null)).toBeNull();
    expect(normaliseChimeEvent('chime:AttendeeJoined')).toBeNull();
    expect(normaliseChimeEvent({ ...detail, meetingId: undefined })).toBeNull();
    expect(normaliseChimeEvent({ ...detail, eventType: 'AttendeeJoined' })).toBeNull();
    expect(normaliseChimeEvent({ ...detail, timestamp: 'yesterday' })).toBeNull();
    expect(normaliseChimeEvent({ ...eventBridgeEnvelope, source: 'aws.s3' })).toBeNull();
  });
});

describe('fromFakeEvent', () => {
  it('maps the in-process event of FakeVideoProvider', () => {
    expect(
      fromFakeEvent({
        eventType: 'AttendeeLeft',
        providerMeetingId: 'fake-meeting-s',
        providerAttendeeId: 'fake-attendee-p',
        occurredAt: new Date(TIMESTAMP_MS),
        externalMeetingId: 's',
        externalUserId: 'p',
      }),
    ).toEqual({
      eventType: 'AttendeeLeft',
      providerMeetingId: 'fake-meeting-s',
      providerAttendeeId: 'fake-attendee-p',
      occurredAt: new Date(TIMESTAMP_MS),
      externalMeetingId: 's',
      externalUserId: 'p',
      source: 'fake',
    });
  });
});

describe('ChimeEventsConsumer', () => {
  const sqs = mockClient(SQSClient);
  let apply: ReturnType<typeof vi.fn<(event: CallProviderEvent) => Promise<ApplyResult>>>;
  let applier: EventApplier;
  let warn: ReturnType<typeof vi.spyOn>;

  function config(values: Record<string, string | undefined>): ConfigService {
    return { get: (key: string) => values[key] } as unknown as ConfigService;
  }

  const chimeConfig = config({ VIDEO_PROVIDER: 'chime', CHIME_EVENTS_QUEUE_URL: QUEUE_URL, CHIME_REGION: 'eu-central-1' });

  function message(id: string, body: unknown): Message {
    return { MessageId: id, ReceiptHandle: `receipt-${id}`, Body: typeof body === 'string' ? body : JSON.stringify(body) };
  }

  beforeEach(() => {
    sqs.reset();
    apply = vi.fn(async () => 'applied' as ApplyResult);
    applier = { apply } as unknown as EventApplier;
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    for (const level of ['log', 'error', 'debug'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('long-polls with the D-CW-12 parameters and deletes each message after the applier committed', async () => {
    sqs.on(ReceiveMessageCommand).resolves({
      Messages: [message('m1', detail), message('m2', eventBridgeEnvelope)],
    });
    sqs.on(DeleteMessageCommand).resolves({});
    const consumer = new ChimeEventsConsumer(chimeConfig, applier, {} as VideoProvider);
    expect(consumer.start({ loop: false })).toBe('sqs');

    expect(await consumer.pollOnce()).toBe(2);

    expect(sqs.commandCalls(ReceiveMessageCommand)[0]!.args[0].input).toEqual({
      QueueUrl: QUEUE_URL,
      WaitTimeSeconds: 20,
      VisibilityTimeout: 60,
      MaxNumberOfMessages: 10,
    });
    expect(apply.mock.calls.map(([event]) => event.source)).toEqual(['notification', 'eventbridge']);
    expect(sqs.commandCalls(DeleteMessageCommand).map((c) => c.args[0].input)).toEqual([
      { QueueUrl: QUEUE_URL, ReceiptHandle: 'receipt-m1' },
      { QueueUrl: QUEUE_URL, ReceiptHandle: 'receipt-m2' },
    ]);
    await consumer.stop();
  });

  it('deletes duplicates and events of unknown meetings (no retry)', async () => {
    apply.mockResolvedValueOnce('duplicate').mockResolvedValueOnce('unknown_meeting');
    sqs.on(ReceiveMessageCommand).resolves({ Messages: [message('m1', detail), message('m2', detail)] });
    sqs.on(DeleteMessageCommand).resolves({});
    const consumer = new ChimeEventsConsumer(chimeConfig, applier, {} as VideoProvider);
    consumer.start({ loop: false });
    await consumer.pollOnce();
    expect(sqs.commandCalls(DeleteMessageCommand)).toHaveLength(2);
    await consumer.stop();
  });

  it('leaves a message whose application failed for redelivery, and goes on with the batch', async () => {
    apply.mockRejectedValueOnce(new Error('connection reset')).mockRejectedValueOnce(new CallEventNotReadyError('later'));
    sqs.on(ReceiveMessageCommand).resolves({
      Messages: [message('m1', detail), message('m2', detail), message('m3', detail)],
    });
    sqs.on(DeleteMessageCommand).resolves({});
    const consumer = new ChimeEventsConsumer(chimeConfig, applier, {} as VideoProvider);
    consumer.start({ loop: false });
    await consumer.pollOnce();
    expect(apply).toHaveBeenCalledTimes(3);
    expect(sqs.commandCalls(DeleteMessageCommand).map((c) => c.args[0].input.ReceiptHandle)).toEqual(['receipt-m3']);
    await consumer.stop();
  });

  it('leaves a body that is not a Chime event for the dead-letter queue, logging no ids', async () => {
    sqs.on(ReceiveMessageCommand).resolves({ Messages: [message('m1', 'not json'), message('m2', { hello: 'world' })] });
    const consumer = new ChimeEventsConsumer(chimeConfig, applier, {} as VideoProvider);
    consumer.start({ loop: false });
    await consumer.pollOnce();
    expect(apply).not.toHaveBeenCalled();
    expect(sqs.commandCalls(DeleteMessageCommand)).toHaveLength(0);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('meeting-1');
    await consumer.stop();
  });

  it('stops polling on stop() and waits for the message in flight', async () => {
    let release!: () => void;
    apply.mockImplementationOnce(() => new Promise<ApplyResult>((resolve) => (release = () => resolve('applied'))));
    sqs.on(ReceiveMessageCommand).resolvesOnce({ Messages: [message('m1', detail)] }).resolves({ Messages: [] });
    sqs.on(DeleteMessageCommand).resolves({});
    const consumer = new ChimeEventsConsumer(chimeConfig, applier, {} as VideoProvider);
    consumer.start();
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));

    let stopped = false;
    const stopping = consumer.stop().then(() => (stopped = true));
    await new Promise((resolve) => setImmediate(resolve));
    expect(stopped).toBe(false);

    release();
    await stopping;
    expect(sqs.commandCalls(DeleteMessageCommand).map((c) => c.args[0].input.ReceiptHandle)).toEqual(['receipt-m1']);
    const receives = sqs.commandCalls(ReceiveMessageCommand).length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sqs.commandCalls(ReceiveMessageCommand)).toHaveLength(receives);
  });

  it('subscribes to the fake provider instead of SQS with VIDEO_PROVIDER=none (CW-R-41)', async () => {
    const video = new FakeVideoProvider();
    const consumer = new ChimeEventsConsumer(config({ VIDEO_PROVIDER: 'none' }), applier, video);
    expect(consumer.start()).toBe('fake');

    const created = await video.createSession({
      sessionId: 's1',
      format: 'consultation',
      capacity: 2,
      orgId: 'org_sample',
      webinarId: null,
      participant: { participantId: 'p1', role: 'expert' },
    });
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
    expect(apply.mock.calls.map(([event]) => [event.eventType, event.source])).toEqual([
      ['MeetingStarted', 'fake'],
      ['AttendeeJoined', 'fake'],
    ]);
    expect(sqs.commandCalls(ReceiveMessageCommand)).toHaveLength(0);

    await consumer.stop();
    await video.endSession({ providerMeetingId: created.providerMeetingId });
    await new Promise((resolve) => setImmediate(resolve));
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it('stays off with VIDEO_PROVIDER=chime and no queue URL', () => {
    const consumer = new ChimeEventsConsumer(config({ VIDEO_PROVIDER: 'chime' }), applier, {} as VideoProvider);
    expect(consumer.start()).toBe('disabled');
  });
});
