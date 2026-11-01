import { describe, expect, it } from 'vitest';
import {
  FeedbackRoutesAdminResponseSchema,
  FeedbackRoutesResponseSchema,
  HandlerFeedbackCaseResponseSchema,
  HandlerFeedbackInboxResponseSchema,
  MyFeedbackCaseResponseSchema,
  MyFeedbackCasesResponseSchema,
} from '@nestself/contracts';
import {
  SAMPLE_FEEDBACK_INBOX,
  SAMPLE_FEEDBACK_ROUTES,
  SAMPLE_FEEDBACK_ROUTES_ADMIN,
  SAMPLE_HANDLER_FEEDBACK_CASE,
  SAMPLE_MY_FEEDBACK_CASE,
  SAMPLE_MY_FEEDBACK_CASES,
} from './feedback.ts';

describe('feedback case fixtures (ADR 0002)', () => {
  it('every fixture has the shape of the API response it stands in for', () => {
    expect(FeedbackRoutesResponseSchema.safeParse(SAMPLE_FEEDBACK_ROUTES).success).toBe(true);
    expect(FeedbackRoutesAdminResponseSchema.safeParse(SAMPLE_FEEDBACK_ROUTES_ADMIN).success).toBe(true);
    expect(MyFeedbackCaseResponseSchema.safeParse(SAMPLE_MY_FEEDBACK_CASE).success).toBe(true);
    expect(MyFeedbackCasesResponseSchema.safeParse(SAMPLE_MY_FEEDBACK_CASES).success).toBe(true);
    expect(HandlerFeedbackInboxResponseSchema.safeParse(SAMPLE_FEEDBACK_INBOX).success).toBe(true);
    expect(HandlerFeedbackCaseResponseSchema.safeParse(SAMPLE_HANDLER_FEEDBACK_CASE).success).toBe(true);
  });

  it('the reporter view carries no internal note and no handler account; the handler view carries the note and no reporter', () => {
    expect(SAMPLE_MY_FEEDBACK_CASE.messages.every((m) => !m.internal)).toBe(true);
    expect(JSON.stringify(SAMPLE_MY_FEEDBACK_CASE)).not.toMatch(/user_ivana|user_jovan|orgId/);
    expect(SAMPLE_HANDLER_FEEDBACK_CASE.messages.filter((m) => m.internal)).toHaveLength(1);
    expect(JSON.stringify(SAMPLE_HANDLER_FEEDBACK_CASE)).not.toMatch(/user_jovan|reporterUserId|email/);
    expect(SAMPLE_FEEDBACK_INBOX.items.some((i) => i.overdue && i.escalatedAt)).toBe(true);
  });
});
