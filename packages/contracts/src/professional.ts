/**
 * Professional-interaction response schemas (T-2.4, section 4.7).
 *
 * Shared by the API's `/professional/*` routes and the workspace client. The
 * list routes return metadata only (`ConversationSummary`, never a message
 * body); bodies come from the single-record reads, which authorize the row
 * and require a restricted-class step-up.
 */
import { z } from 'zod';

export const ConversationSummarySchema = z.object({
  id: z.string().min(1),
  caseId: z.string().min(1),
  orgId: z.string().min(1),
  employeeUserId: z.string().min(1),
  expertUserId: z.string().min(1),
  createdAt: z.string().datetime(),
  messageCount: z.number().int().nonnegative(),
});
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;

/** Query of both conversation lists: keyset paging on `(createdAt desc, id desc)`. */
export const ConversationListQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ConversationListQuery = z.infer<typeof ConversationListQuerySchema>;

/**
 * `GET /professional/conversations` (assigned) and `GET /professional/me/conversations`
 * (participant), newest first. A page may hold fewer than `limit` items when
 * rows are filtered out by authorization; keep paging while `nextCursor` is set.
 */
export const ConversationListResponseSchema = z.object({
  items: z.array(ConversationSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ConversationListResponse = z.infer<typeof ConversationListResponseSchema>;

export const ConversationMessageSchema = z.object({
  id: z.string().min(1),
  authorUserId: z.string().min(1),
  body: z.string(),
  createdAt: z.string().datetime(),
});
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;

/** `GET /professional/conversations/:id` and `GET /professional/me/conversations/:id`; messages oldest first. */
export const ConversationResponseSchema = z.object({
  id: z.string().min(1),
  caseId: z.string().min(1),
  orgId: z.string().min(1),
  messages: z.array(ConversationMessageSchema),
});
export type ConversationResponse = z.infer<typeof ConversationResponseSchema>;

/** `GET /professional/intake/:id`. */
export const IntakeResponseSchema = z.object({
  id: z.string().min(1),
  caseId: z.string().min(1),
  orgId: z.string().min(1),
  body: z.string(),
  createdAt: z.string().datetime(),
});
export type IntakeResponse = z.infer<typeof IntakeResponseSchema>;
