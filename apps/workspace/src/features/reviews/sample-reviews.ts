/**
 * Sample-mode workplace review data, from the shared fixtures. Nothing here
 * was requested, scoped, booked or paid.
 */
import {
  SAMPLE_REVIEW_ENGAGEMENT,
  SAMPLE_REVIEW_ENGAGEMENTS,
  SAMPLE_REVIEW_REPORT,
  SAMPLE_REVIEW_REQUEST,
  SAMPLE_REVIEW_REQUESTS,
  SAMPLE_REVIEW_SERVICES,
} from '@nestself/sample-data';
import type { ReviewEngagementResponse, ReviewReportView, ReviewRequestResponse, ReviewServicesResponse } from '@nestself/contracts';

export const sampleReviewServices = (): ReviewServicesResponse => SAMPLE_REVIEW_SERVICES;
export const sampleReviewRequests = (): ReviewRequestResponse[] => SAMPLE_REVIEW_REQUESTS;
export const sampleReviewRequest = (id: string): ReviewRequestResponse => ({ ...SAMPLE_REVIEW_REQUEST, id });
export const sampleEngagements = (): ReviewEngagementResponse[] => SAMPLE_REVIEW_ENGAGEMENTS;
export const sampleEngagement = (id: string): ReviewEngagementResponse => SAMPLE_REVIEW_ENGAGEMENTS.find((e) => e.id === id) ?? { ...SAMPLE_REVIEW_ENGAGEMENT, id };
export const sampleReport = (): ReviewReportView => SAMPLE_REVIEW_REPORT;
