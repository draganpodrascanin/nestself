import { describe, expect, it } from 'vitest';
import {
  ConversationListResponseSchema,
  ConversationResponseSchema,
  ConversationSummarySchema,
  IntakeResponseSchema,
} from './professional.ts';

const SUMMARY = {
  id: 'conv_1',
  caseId: 'case_1',
  orgId: 'org_1',
  employeeUserId: 'user_jovan',
  expertUserId: 'user_milica',
  createdAt: '2026-10-01T09:00:00.000Z',
  messageCount: 2,
};

describe('professional schemas', () => {
  it('ConversationSummarySchema accepts metadata and strips any body', () => {
    const parsed = ConversationSummarySchema.parse({ ...SUMMARY, messages: [{ body: 'x' }] });
    expect(parsed).toEqual(SUMMARY);
    expect(parsed).not.toHaveProperty('messages');
  });

  it('ConversationSummarySchema rejects a negative or fractional messageCount', () => {
    expect(ConversationSummarySchema.safeParse({ ...SUMMARY, messageCount: -1 }).success).toBe(false);
    expect(ConversationSummarySchema.safeParse({ ...SUMMARY, messageCount: 1.5 }).success).toBe(false);
  });

  it('ConversationListResponseSchema accepts an empty list', () => {
    expect(ConversationListResponseSchema.parse({ items: [] })).toEqual({ items: [] });
  });

  it('ConversationResponseSchema accepts messages and rejects a non-ISO createdAt', () => {
    const body = {
      id: 'conv_1',
      caseId: 'case_1',
      orgId: 'org_1',
      messages: [{ id: 'm1', authorUserId: 'user_jovan', body: 'Sample (fixture)', createdAt: '2026-10-01T09:00:00.000Z' }],
    };
    expect(ConversationResponseSchema.parse(body)).toEqual(body);
    expect(
      ConversationResponseSchema.safeParse({ ...body, messages: [{ ...body.messages[0], createdAt: 'yesterday' }] }).success,
    ).toBe(false);
  });

  it('IntakeResponseSchema accepts an intake record', () => {
    const body = { id: 'in_1', caseId: 'case_1', orgId: 'org_1', body: 'Sample (fixture)', createdAt: '2026-10-01T09:00:00.000Z' };
    expect(IntakeResponseSchema.parse(body)).toEqual(body);
  });
});
