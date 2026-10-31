/**
 * RoomEventRelay (T-CW-1.6): delivers the room events every process
 * publishes to the sockets of this API task.
 *
 * `RoomEmitter` publishes `{ room, event, payload }` on the room events
 * channel (`ROOM_EVENTS_CHANNEL`) from the API and the worker and never emits
 * locally. Each API task runs one relay, modelled on `WsInvalidationService`:
 * it subscribes at start-up, checks each message again against `ROOM_EVENTS`
 * (event, room kind, strict payload; a failure is dropped and logged at
 * error level with the event name only), then emits it with
 * `server.to(room)`, which reaches this task's sockets. Several tasks behind
 * the load balancer each deliver to their own sockets, so a subscriber
 * receives an event once whichever task it is connected to.
 *
 * In a process without a Socket.IO server (the worker) a message is dropped
 * silently. With the in-memory store (tests, local development without
 * Redis) publish and delivery happen synchronously in one process.
 */
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Server } from 'socket.io';
import { KEY_VALUE_STORE, type KeyValueStore } from '../redis/key-value-store.js';
import { ROOM_EVENTS_CHANNEL } from '../redis/redis-keys.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { EventsGateway } from './events.gateway.js';
import { RoomEventEnvelopeSchema, checkRoomEvent } from './ws-messages.js';

@Injectable()
export class RoomEventRelay implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RoomEventRelay.name);
  private unsubscribe: (() => Promise<void>) | null = null;

  constructor(
    @Inject(KEY_VALUE_STORE) private readonly store: KeyValueStore,
    private readonly gateway: EventsGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      this.unsubscribe = await this.store.subscribe(ROOM_EVENTS_CHANNEL, (message) => this.handleMessage(message));
      this.logger.log('Room event relay active');
    } catch (error) {
      this.logger.warn(
        { error: error instanceof Error ? error.name : 'UnknownError' },
        'Failed to subscribe to the room events channel',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.unsubscribe) {
      await this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /** Synchronous, so the in-memory store delivers within the emitter's call. */
  handleMessage(raw: string): void {
    // The worker has no sockets to deliver to; the API tasks validate and log.
    const server = this.gateway.server as Server | undefined;
    if (!server) return;

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      this.logger.error({ event: null }, 'Room event message is not JSON; dropped');
      return;
    }

    const envelope = RoomEventEnvelopeSchema.safeParse(data);
    const payload = envelope.success
      ? checkRoomEvent(envelope.data.room, envelope.data.event, envelope.data.payload)
      : null;
    if (!envelope.success || !payload) {
      this.logger.error({ event: eventNameOf(data) }, 'Room event failed its schema; not relayed');
      return;
    }
    server.to(envelope.data.room).emit(envelope.data.event, payload);
  }
}

/** The event name of a message, for the log line only; nothing else of it is logged. */
function eventNameOf(data: unknown): string | null {
  const event = typeof data === 'object' && data !== null ? (data as { event?: unknown }).event : undefined;
  return typeof event === 'string' ? event.slice(0, 128) : null;
}
