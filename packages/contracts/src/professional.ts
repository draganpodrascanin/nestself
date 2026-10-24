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

/** `GET /professional/conversations` (assigned) and `GET /professional/me/conversations` (participant), newest first. */
export const ConversationListResponseSchema = z.object({
  items: z.array(ConversationSummarySchema),
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
