import { describe, expect, it } from 'vitest';
import {
  ReviewEngagementResponseSchema,
  ReviewPackResponseSchema,
  ReviewQueueResponseSchema,
  ReviewRequestOpsResponseSchema,
  ReviewRequestResponseSchema,
  ReviewServicesResponseSchema,
  ReviewerCandidatesResponseSchema,
} from '@nestself/contracts';
import {
  SAMPLE_REVIEWER_CANDIDATES,
  SAMPLE_REVIEW_ENGAGEMENT,
  SAMPLE_REVIEW_ENGAGEMENT_PENDING,
  SAMPLE_REVIEW_PACK,
  SAMPLE_REVIEW_QUEUE,
  SAMPLE_REVIEW_REQUEST,
  SAMPLE_REVIEW_REQUEST_OPS,
  SAMPLE_REVIEW_REQUEST_OPS_NEW,
  SAMPLE_REVIEW_SERVICES,
} from './reviews.ts';

describe('workplace review fixtures (ADR 0002)', () => {
  it('every fixture has the shape of the API response it stands in for', () => {
    expect(ReviewServicesResponseSchema.safeParse(SAMPLE_REVIEW_SERVICES).success).toBe(true);
    expect(ReviewRequestResponseSchema.safeParse(SAMPLE_REVIEW_REQUEST).success).toBe(true);
    expect(ReviewEngagementResponseSchema.safeParse(SAMPLE_REVIEW_ENGAGEMENT).success).toBe(true);
    expect(ReviewEngagementResponseSchema.safeParse(SAMPLE_REVIEW_ENGAGEMENT_PENDING).success).toBe(true);
    expect(ReviewPackResponseSchema.safeParse(SAMPLE_REVIEW_PACK).success).toBe(true);
    expect(ReviewQueueResponseSchema.safeParse(SAMPLE_REVIEW_QUEUE).success).toBe(true);
    expect(ReviewRequestOpsResponseSchema.safeParse(SAMPLE_REVIEW_REQUEST_OPS).success).toBe(true);
    expect(ReviewRequestOpsResponseSchema.safeParse(SAMPLE_REVIEW_REQUEST_OPS_NEW).success).toBe(true);
    expect(ReviewerCandidatesResponseSchema.safeParse(SAMPLE_REVIEWER_CANDIDATES).success).toBe(true);
  });

  it('shows a quoted service and a free one, a shared report with an agreed action, and a pending booking', () => {
    expect(SAMPLE_REVIEW_SERVICES.items.map((s) => s.pricing)).toEqual(['quote', 'free']);
    expect(SAMPLE_REVIEW_ENGAGEMENT.sharedReport?.status).toBe('shared');
    expect(SAMPLE_REVIEW_ENGAGEMENT.actions[0]).toMatchObject({ status: 'agreed', proposedBy: 'reviewer' });
    expect(SAMPLE_REVIEW_ENGAGEMENT_PENDING.proposedWindows).toHaveLength(2);
    expect(SAMPLE_REVIEW_QUEUE.items.some((i) => i.overdue)).toBe(true);
    expect(JSON.stringify(SAMPLE_REVIEW_ENGAGEMENT)).not.toMatch(/user_milica|Radović/);
  });
});
