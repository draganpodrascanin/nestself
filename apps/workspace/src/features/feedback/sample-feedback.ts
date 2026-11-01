/**
 * Sample-mode feedback data, from the shared fixtures. Nothing here was
 * raised, read or answered by anyone; the screens say so.
 */
import {
  SAMPLE_FEEDBACK_INBOX,
  SAMPLE_FEEDBACK_ROUTES,
  SAMPLE_FEEDBACK_ROUTES_ADMIN,
  SAMPLE_HANDLER_FEEDBACK_CASE,
  SAMPLE_MY_FEEDBACK_CASE,
  SAMPLE_MY_FEEDBACK_CASES,
} from '@nestself/sample-data';
import type {
  FeedbackRoutesAdminResponse,
  FeedbackRoutesResponse,
  HandlerFeedbackCaseResponse,
  HandlerFeedbackInboxResponse,
  MyFeedbackCaseResponse,
  MyFeedbackCasesResponse,
} from '@nestself/contracts';

export const sampleFeedbackRoutes = (): FeedbackRoutesResponse => SAMPLE_FEEDBACK_ROUTES;
export const sampleFeedbackRoutesAdmin = (): FeedbackRoutesAdminResponse => SAMPLE_FEEDBACK_ROUTES_ADMIN;
export const sampleMyFeedbackCases = (): MyFeedbackCasesResponse => SAMPLE_MY_FEEDBACK_CASES;
export const sampleFeedbackInbox = (): HandlerFeedbackInboxResponse => SAMPLE_FEEDBACK_INBOX;

/** The sample reporter's case, under whichever id the route carries (the list links to the fixture id). */
export const sampleMyFeedbackCase = (id: string): MyFeedbackCaseResponse => ({ ...SAMPLE_MY_FEEDBACK_CASE, id });
export const sampleHandlerFeedbackCase = (id: string): HandlerFeedbackCaseResponse => ({ ...SAMPLE_HANDLER_FEEDBACK_CASE, id });
