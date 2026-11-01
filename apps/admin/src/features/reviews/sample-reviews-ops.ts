/**
 * Sample-mode data for the coordinator and reviewer screens, from the shared
 * fixtures. Nothing here was requested by, scoped for or shared with a real
 * client; the screens say so and save nothing.
 */
import {
  SAMPLE_REVIEWER_CANDIDATES,
  SAMPLE_REVIEW_ENGAGEMENT,
  SAMPLE_REVIEW_ENGAGEMENTS,
  SAMPLE_REVIEW_ENGAGEMENT_ID,
  SAMPLE_REVIEW_PACK,
  SAMPLE_REVIEW_QUEUE,
  SAMPLE_REVIEW_REPORT,
  SAMPLE_REVIEW_REQUEST_OPS,
  SAMPLE_REVIEW_REQUEST_OPS_NEW,
  SAMPLE_REVIEW_SERVICES,
} from '@nestself/sample-data';
import type {
  ReviewEngagementResponse,
  ReviewPackResponse,
  ReviewQueueItem,
  ReviewReportView,
  ReviewRequestOpsResponse,
  ReviewServiceView,
  ReviewerCandidatesResponse,
} from '@nestself/contracts';

export function sampleQueue(): ReviewQueueItem[] {
  return [...SAMPLE_REVIEW_QUEUE.items];
}

export function sampleOpsRequest(id: string): ReviewRequestOpsResponse | undefined {
  return [SAMPLE_REVIEW_REQUEST_OPS, SAMPLE_REVIEW_REQUEST_OPS_NEW].find((r) => r.id === id);
}

export function sampleOpsEngagement(id: string): ReviewEngagementResponse | undefined {
  return SAMPLE_REVIEW_ENGAGEMENTS.find((e) => e.id === id);
}

export function sampleServices(): ReviewServiceView[] {
  return [...SAMPLE_REVIEW_SERVICES.items];
}

export function sampleCandidates(): ReviewerCandidatesResponse {
  return SAMPLE_REVIEWER_CANDIDATES;
}

export function sampleMyEngagements(): ReviewEngagementResponse[] {
  return [...SAMPLE_REVIEW_ENGAGEMENTS];
}

export function sampleMyEngagement(id: string): ReviewEngagementResponse | undefined {
  return SAMPLE_REVIEW_ENGAGEMENTS.find((e) => e.id === id);
}

/** The pack exists only for the engagement whose employer shared results. */
export function samplePack(id: string): ReviewPackResponse | null {
  return id === SAMPLE_REVIEW_ENGAGEMENT_ID ? SAMPLE_REVIEW_PACK : null;
}

export function sampleReport(id: string): ReviewReportView | null {
  return id === SAMPLE_REVIEW_ENGAGEMENT.id ? SAMPLE_REVIEW_REPORT : null;
}
