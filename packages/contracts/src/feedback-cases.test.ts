import { describe, expect, it } from 'vitest';
import {
  FEEDBACK_CASE_STATES,
  FEEDBACK_OPEN_STATES,
  FEEDBACK_PSEUDONYM_PATTERN,
  FeedbackCaseCreateRequestSchema,
  FeedbackRoutesUpdateRequestSchema,
  FeedbackStateRequestSchema,
  HandlerFeedbackCaseResponseSchema,
  canTransition,
} from './feedback-cases.ts';

describe('feedback case contracts', () => {
  it('defaults a new case to employer-anonymous and refuses an empty body', () => {
    const parsed = FeedbackCaseCreateRequestSchema.parse({ routeId: 'r1', kind: 'problem', category: 'workload', routeChoice: 'alternate', body: 'The rota changes without notice.' });
    expect(parsed.anonymousToEmployer).toBe(true);
    expect(FeedbackCaseCreateRequestSchema.safeParse({ routeId: 'r1', kind: 'problem', category: 'workload', routeChoice: 'primary', body: '' }).success).toBe(false);
    expect(FeedbackCaseCreateRequestSchema.safeParse({ routeId: 'r1', kind: 'rant', category: 'workload', routeChoice: 'primary', body: 'x' }).success).toBe(false);
  });

  it('requires an explanation to resolve and an outcome reason to close', () => {
    expect(FeedbackStateRequestSchema.safeParse({ state: 'resolved' }).success).toBe(false);
    expect(FeedbackStateRequestSchema.safeParse({ state: 'resolved', reporterExplanation: 'We changed the rota process.' }).success).toBe(true);
    expect(FeedbackStateRequestSchema.safeParse({ state: 'closed' }).success).toBe(false);
    expect(FeedbackStateRequestSchema.safeParse({ state: 'closed', outcomeReason: 'resolved_and_confirmed' }).success).toBe(true);
    expect(FeedbackStateRequestSchema.safeParse({ state: 'in_review', nextAction: 'ask the team lead' }).success).toBe(true);
  });

  it('follows the state machine of spec section 8', () => {
    expect(canTransition('submitted', 'in_review')).toBe(true);
    expect(canTransition('submitted', 'resolved')).toBe(false);
    expect(canTransition('in_review', 'waiting_for_reporter')).toBe(true);
    expect(canTransition('action_in_progress', 'resolved')).toBe(true);
    expect(canTransition('resolved', 'closed')).toBe(true);
    expect(canTransition('resolved', 'in_review')).toBe(true);
    expect(canTransition('closed', 'in_review')).toBe(false);
    for (const state of FEEDBACK_CASE_STATES) {
      expect(FEEDBACK_OPEN_STATES.includes(state)).toBe(state !== 'resolved' && state !== 'closed');
    }
  });

  it('a handler response has no reporter field and rejects one', () => {
    const base = {
      id: 'c1',
      orgId: 'org',
      kind: 'problem',
      category: 'workload',
      state: 'submitted',
      pseudonym: 'Reporter-AB2C',
      anonymousToEmployer: true,
      routeKind: 'standard',
      routeChoice: 'alternate',
      handlerUserId: 'user_ivana',
      nextAction: 'acknowledge',
      dueAt: '2026-11-05T09:00:00.000Z',
      escalatedAt: null,
      resolvedAt: null,
      closedAt: null,
      outcomeReason: null,
      createdAt: '2026-11-02T09:00:00.000Z',
      messages: [],
    };
    expect(HandlerFeedbackCaseResponseSchema.safeParse(base).success).toBe(true);
    expect(HandlerFeedbackCaseResponseSchema.safeParse({ ...base, reporterUserId: 'user_jovan' }).success).toBe(false);
    expect(FEEDBACK_PSEUDONYM_PATTERN.test(base.pseudonym)).toBe(true);
    expect(FEEDBACK_PSEUDONYM_PATTERN.test('Reporter-ab2c')).toBe(false);
  });

  it('a routes update carries one route per kind', () => {
    const route = { kind: 'standard', categories: ['workload'], primaryHandlerUserId: 'a', alternateHandlerUserId: 'b', enabled: true, responseTargetHours: 72 };
    expect(FeedbackRoutesUpdateRequestSchema.safeParse({ routes: [route] }).success).toBe(true);
    expect(FeedbackRoutesUpdateRequestSchema.safeParse({ routes: [route, route] }).success).toBe(false);
    expect(FeedbackRoutesUpdateRequestSchema.safeParse({ routes: [{ ...route, responseTargetHours: 0 }] }).success).toBe(false);
  });
});
