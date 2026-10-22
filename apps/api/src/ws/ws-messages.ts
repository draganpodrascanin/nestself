/**
 * Zod schemas for WebSocket messages (T-1.11).
 *
 * These are internal to the WS module; no contracts export is needed.
 *
 * @see 4.6.7, AUTHZ-R-58, AUTHZ-R-59
 */
import { z } from 'zod';

export const SubscribeMessageSchema = z.object({
  room: z.string().min(1).max(256),
  action: z.string().min(1).max(128),
  resource: z.object({
    type: z.string().min(1).max(64),
    id: z.string().max(256).optional(),
    orgId: z.string().max(256).optional(),
    orgUnitId: z.string().max(256).optional(),
    queueId: z.string().max(256).optional(),
    practiceGroupId: z.string().max(256).optional(),
    collectionId: z.string().max(256).optional(),
    ownerId: z.string().max(256).optional(),
    amountMinor: z.number().int().nonnegative().optional(),
    currency: z.string().length(3).optional(),
    category: z.string().max(256).optional(),
    isConfidential: z.boolean().optional(),
  }),
});

export type SubscribePayload = z.infer<typeof SubscribeMessageSchema>;

export const UnsubscribeMessageSchema = z.object({
  room: z.string().min(1).max(256),
});

export type UnsubscribePayload = z.infer<typeof UnsubscribeMessageSchema>;
