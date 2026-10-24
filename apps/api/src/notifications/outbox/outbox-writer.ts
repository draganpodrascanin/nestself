/**
 * OutboxWriter — writes outbox events within a caller's transaction [C-23].
 *
 * The dispatcher (T-C2.03) reads these rows later, so this module only
 * inserts. The payload is validated as a JSON object (no body text).
 */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../db/db.service.js';
import { outboxEvents } from '../../db/schema/notifications.js';

export interface OutboxEventInput {
  type: string;
  aggregateType: string;
  aggregateId: string;
  orgId?: string | null;
  payload: Record<string, unknown>;
}

@Injectable()
export class OutboxWriter {
  /**
   * Insert an outbox event within the caller's transaction.
   * The payload must be a plain object (no body text, ids and codes only).
   */
  async write(tx: Transaction, input: OutboxEventInput): Promise<void> {
    if (typeof input.payload !== 'object' || input.payload === null || Array.isArray(input.payload)) {
      throw new Error('OutboxWriter: payload must be a plain object');
    }
    await tx.insert(outboxEvents).values({
      id: randomUUID(),
      type: input.type,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      orgId: input.orgId ?? null,
      payload: input.payload,
    });
  }
}
