/**
 * ChimeEventsConsumer: `chime.events.consume`, the long-running poller of the
 * chime-events queue in the worker process (T-CW-1.2, D-CW-12, guidelines
 * 9.1). Not a BullMQ job: its own `ReceiveMessage` loop with long polling
 * (`WaitTimeSeconds` 20), a 60-second visibility timeout and up to 10
 * messages per receive.
 *
 * The queue holds two copies of most events: the direct `CreateMeeting`
 * notification (the event object at the top level) and the EventBridge
 * envelope (`detail-type: Chime Meeting State Change`, the event under
 * `detail`). {@link normaliseChimeEvent} turns both into one
 * {@link CallProviderEvent}; the applier's `call_events` key drops the second
 * copy when both carry the same timestamp (SPIKE-CW-07 checks that).
 *
 * A message is deleted only after the applier committed (applied, duplicate,
 * or a meeting no session knows, which a retry would not change). A thrown
 * error, including {@link CallEventNotReadyError}, leaves it for redelivery
 * after the visibility timeout; after 5 receives SQS moves it to the
 * dead-letter queue. A body that is not a Chime meeting event is left for
 * the dead-letter queue as well, where it raises the DLQ alarm.
 *
 * `start()` picks the source: SQS when `VIDEO_PROVIDER=chime` and
 * `CHIME_EVENTS_QUEUE_URL` is set; with the fake provider it subscribes the
 * applier to `FakeVideoProvider`'s in-process events instead, and never
 * creates an SQS client (CW-R-41). `stop()` (also on module destroy, so on
 * SIGTERM through Nest's shutdown hooks) ends the loop, aborts a receive in
 * progress and waits for the message being applied.
 *
 * Logs: message ids, event names and error names. Meeting and attendee ids
 * appear at debug level only (in the applier); no body is logged.
 */
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ConfigService } from '@nestjs/config';
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient, type Message } from '@aws-sdk/client-sqs';
import { FakeVideoProvider } from '../video/fake-video-provider.js';
import {
  VIDEO_MEDIA_REGION,
  VIDEO_PROVIDER,
  type VideoProvider,
  type VideoProviderEvent,
} from '../video/video-provider.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { CallEventNotReadyError, EventApplier, type CallProviderEvent } from './event-applier.js';

/** D-CW-12, guidelines 9.1. */
export const CHIME_EVENTS_WAIT_TIME_SECONDS = 20;
export const CHIME_EVENTS_VISIBILITY_TIMEOUT_SECONDS = 60;
export const CHIME_EVENTS_MAX_MESSAGES = 10;

const CHIME_PREFIX = 'chime:';
const EVENTBRIDGE_DETAIL_TYPE = 'Chime Meeting State Change';
/** Backoff after a failed receive: doubles from 1 second up to 30. */
const RECEIVE_BACKOFF_MS = { min: 1_000, max: 30_000 };

export type ConsumerMode = 'sqs' | 'fake' | 'disabled';

type Fields = Record<string, unknown>;

function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Chime sends epoch milliseconds; seconds and ISO strings are accepted too. */
function instant(value: unknown): Date | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(value < 1e12 ? value * 1000 : value);
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed);
  }
  return null;
}

/**
 * One chime-events message body, in either envelope, as a
 * {@link CallProviderEvent}; null when it is not a Chime meeting event.
 * `chime:AttendeeJoined` becomes `AttendeeJoined`, the names
 * `FakeVideoProvider` emits.
 */
export function normaliseChimeEvent(body: unknown): CallProviderEvent | null {
  if (!isRecord(body)) return null;
  const envelope = isRecord(body.detail);
  if (envelope && (body.source !== 'aws.chime' || body['detail-type'] !== EVENTBRIDGE_DETAIL_TYPE)) return null;
  const event = envelope ? (body.detail as Fields) : body;

  const eventType = text(event.eventType);
  const providerMeetingId = text(event.meetingId);
  if (!eventType?.startsWith(CHIME_PREFIX) || eventType.length === CHIME_PREFIX.length || !providerMeetingId) {
    return null;
  }
  const occurredAt = event.timestamp !== undefined ? instant(event.timestamp) : envelope ? instant(body.time) : null;
  if (!occurredAt) return null;

  return {
    eventType: eventType.slice(CHIME_PREFIX.length),
    providerMeetingId,
    providerAttendeeId: text(event.attendeeId),
    occurredAt,
    externalMeetingId: text(event.externalMeetingId),
    externalUserId: text(event.externalUserId),
    source: envelope ? 'eventbridge' : 'notification',
  };
}

/** `FakeVideoProvider`'s in-process event as a {@link CallProviderEvent}. */
export function fromFakeEvent(event: VideoProviderEvent): CallProviderEvent {
  return {
    eventType: event.eventType,
    providerMeetingId: event.providerMeetingId,
    providerAttendeeId: event.providerAttendeeId,
    occurredAt: event.occurredAt,
    externalMeetingId: event.externalMeetingId,
    externalUserId: event.externalUserId,
    source: 'fake',
  };
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'AbortSignal');
}

@Injectable()
export class ChimeEventsConsumer implements OnModuleDestroy {
  private readonly logger = new Logger(ChimeEventsConsumer.name);
  private mode: ConsumerMode | null = null;
  private client: SQSClient | null = null;
  private queueUrl: string | null = null;
  private stopping = false;
  private loopDone: Promise<void> | null = null;
  private receive: AbortController | null = null;
  private wake: (() => void) | null = null;
  private unsubscribe: (() => void) | null = null;
  private pendingFake = new Set<Promise<void>>();

  constructor(
    private readonly config: ConfigService,
    private readonly applier: EventApplier,
    @Inject(VIDEO_PROVIDER) private readonly video: VideoProvider,
  ) {}

  /**
   * Starts consuming and returns the source. `loop: false` sets up SQS
   * without the background loop, for tests that call {@link pollOnce}.
   */
  start(options: { loop?: boolean } = {}): ConsumerMode {
    if (this.mode) return this.mode;
    this.stopping = false;
    const queueUrl = this.config.get<string>('CHIME_EVENTS_QUEUE_URL');

    if (this.config.get<string>('VIDEO_PROVIDER') === 'chime') {
      if (!queueUrl) {
        this.logger.warn('CHIME_EVENTS_QUEUE_URL not set; Chime events are not consumed');
        this.mode = 'disabled';
        return this.mode;
      }
      this.queueUrl = queueUrl;
      this.client = new SQSClient({ region: this.config.get<string>('CHIME_REGION') ?? VIDEO_MEDIA_REGION });
      this.mode = 'sqs';
      if (options.loop !== false) this.loopDone = this.loop();
      this.logger.log('Chime events consumer polling the chime-events queue');
      return this.mode;
    }

    if (this.video instanceof FakeVideoProvider) {
      this.unsubscribe = this.video.onEvent((event) => this.applyFake(event));
      this.mode = 'fake';
      this.logger.log('Chime events consumer subscribed to the fake video provider');
      return this.mode;
    }

    this.mode = 'disabled';
    return this.mode;
  }

  /** Ends the loop, aborts a receive in progress and waits for the message being applied. */
  async stop(): Promise<void> {
    this.stopping = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.receive?.abort();
    this.wake?.();
    await this.loopDone;
    await Promise.all(this.pendingFake);
    this.loopDone = null;
    this.client?.destroy();
    this.client = null;
    this.mode = null;
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  /** One receive and its messages, in order. The number of messages received. */
  async pollOnce(): Promise<number> {
    if (!this.client || !this.queueUrl) throw new Error('The SQS consumer is not started');
    const abort = new AbortController();
    this.receive = abort;
    let messages: Message[];
    try {
      const received = await this.client.send(
        new ReceiveMessageCommand({
          QueueUrl: this.queueUrl,
          WaitTimeSeconds: CHIME_EVENTS_WAIT_TIME_SECONDS,
          VisibilityTimeout: CHIME_EVENTS_VISIBILITY_TIMEOUT_SECONDS,
          MaxNumberOfMessages: CHIME_EVENTS_MAX_MESSAGES,
        }),
        { abortSignal: abort.signal },
      );
      messages = received.Messages ?? [];
    } finally {
      this.receive = null;
    }
    // Messages already received are applied even while stopping: deleting them is cheaper than a redelivery.
    for (const message of messages) await this.handleMessage(message);
    return messages.length;
  }

  private async loop(): Promise<void> {
    let failures = 0;
    while (!this.stopping) {
      try {
        await this.pollOnce();
        failures = 0;
      } catch (error) {
        if (this.stopping || isAbort(error)) break;
        failures += 1;
        const delay = Math.min(RECEIVE_BACKOFF_MS.max, RECEIVE_BACKOFF_MS.min * 2 ** (failures - 1));
        this.logger.warn({ operation: 'receive', error: errorName(error), retryInMs: delay }, 'Chime events receive failed');
        await this.sleep(delay);
      }
    }
  }

  /** Applies one message; deletes it only once the applier is done with it. */
  private async handleMessage(message: Message): Promise<void> {
    const messageId = message.MessageId ?? 'unknown';
    let event: CallProviderEvent | null = null;
    try {
      event = normaliseChimeEvent(JSON.parse(message.Body ?? ''));
    } catch {
      event = null;
    }
    if (!event) {
      this.logger.warn({ messageId, operation: 'parse' }, 'Not a Chime meeting event; left for the dead-letter queue');
      return;
    }

    try {
      await this.applier.apply(event);
    } catch (error) {
      const fields = { messageId, eventType: event.eventType, operation: 'apply', error: errorName(error) };
      if (error instanceof CallEventNotReadyError) this.logger.warn(fields, 'Chime event not applicable yet; retried');
      else this.logger.error(fields, 'Chime event not applied; retried');
      return;
    }

    try {
      await this.client!.send(new DeleteMessageCommand({ QueueUrl: this.queueUrl!, ReceiptHandle: message.ReceiptHandle }));
    } catch (error) {
      // Redelivered later and dropped as a duplicate.
      this.logger.warn({ messageId, operation: 'delete', error: errorName(error) }, 'Chime event message not deleted');
    }
  }

  private applyFake(event: VideoProviderEvent): Promise<void> {
    const pending = this.applier
      .apply(fromFakeEvent(event))
      .then(() => undefined)
      .catch((error: unknown) => {
        this.logger.error({ eventType: event.eventType, operation: 'apply', error: errorName(error) }, 'Fake video event not applied');
      })
      .finally(() => this.pendingFake.delete(pending));
    this.pendingFake.add(pending);
    return pending;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        this.wake = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.wake = done;
    });
  }
}
