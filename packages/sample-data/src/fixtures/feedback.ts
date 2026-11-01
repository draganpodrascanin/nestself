/**
 * Feedback case fixtures for sample mode (ADR 0002, spec Epic F): what the
 * workspace shows when `VITE_DATA_SOURCE=sample`. Fictional values with the
 * shape of the API responses they stand in for; the fixture test parses each
 * with its contract schema. The sample organization's standard route has
 * Stefan as the designated recipient and Ivana as the independent alternative;
 * the sample reporter chose the alternative, so Stefan never sees the case.
 */
import {
  FEEDBACK_CATEGORIES,
  type FeedbackMessageView,
  type FeedbackRoutesAdminResponse,
  type FeedbackRoutesResponse,
  type HandlerFeedbackCaseResponse,
  type HandlerFeedbackInboxResponse,
  type MyFeedbackCaseResponse,
  type MyFeedbackCasesResponse,
} from '@nestself/contracts';
import { SAMPLE_ORG } from './org.ts';

export const SAMPLE_FEEDBACK_ROUTE_ID = 'feedback_route_org_sample_standard';
export const SAMPLE_FEEDBACK_CASE_ID = 'feedback_case_sample_1';
export const SAMPLE_FEEDBACK_CASE_RESOLVED_ID = 'feedback_case_sample_2';
export const SAMPLE_FEEDBACK_CASE_OVERDUE_ID = 'feedback_case_sample_3';

const PRIMARY_NAME = 'Stefan Marković';
const ALTERNATE_NAME = 'Ivana Jovanović';
const CREATED_AT = '2026-10-27T08:10:00.000Z';
const DUE_AT = '2026-10-30T08:10:00.000Z';
const LAST_MESSAGE_AT = '2026-10-27T15:40:00.000Z';

export const SAMPLE_FEEDBACK_ROUTES: FeedbackRoutesResponse = {
  feedbackEnabled: true,
  sensitiveEnabled: false,
  items: [
    {
      id: SAMPLE_FEEDBACK_ROUTE_ID,
      kind: 'standard',
      categories: [...FEEDBACK_CATEGORIES],
      primary: { displayName: PRIMARY_NAME, functionLabel: 'primary' },
      alternate: { displayName: ALTERNATE_NAME, functionLabel: 'alternate' },
      enabled: true,
      operatingHours: null,
      responseTargetHours: 72,
    },
  ],
};

export const SAMPLE_FEEDBACK_ROUTES_ADMIN: FeedbackRoutesAdminResponse = {
  feedbackEnabled: true,
  sensitiveAllowed: false,
  items: [
    {
      id: SAMPLE_FEEDBACK_ROUTE_ID,
      kind: 'standard',
      categories: [...FEEDBACK_CATEGORIES],
      primaryHandlerUserId: 'user_stefan',
      primaryDisplayName: PRIMARY_NAME,
      alternateHandlerUserId: 'user_ivana',
      alternateDisplayName: ALTERNATE_NAME,
      enabled: true,
      operatingHours: null,
      responseTargetHours: 72,
      escalationNote: null,
      updatedAt: '2026-10-01T09:00:00.000Z',
    },
  ],
};

const REPORTER_MESSAGE: FeedbackMessageView = {
  id: 'feedback_msg_sample_1',
  sender: 'reporter',
  body: 'Rota changes are announced the evening before. Could we have at least a week of notice?',
  createdAt: CREATED_AT,
  internal: false,
};

const HANDLER_REPLY: FeedbackMessageView = {
  id: 'feedback_msg_sample_2',
  sender: 'handler',
  body: 'Thank you for raising this. We are checking how far ahead the rota can be fixed and will come back within the week.',
  createdAt: LAST_MESSAGE_AT,
  internal: false,
};

const INTERNAL_NOTE: FeedbackMessageView = {
  id: 'feedback_msg_sample_internal',
  sender: 'handler',
  body: 'Scheduling says the rota is fixed on Thursdays; check whether Monday is possible.',
  createdAt: '2026-10-27T12:00:00.000Z',
  internal: true,
};

export const SAMPLE_MY_FEEDBACK_CASE: MyFeedbackCaseResponse = {
  id: SAMPLE_FEEDBACK_CASE_ID,
  kind: 'problem',
  category: 'workload',
  state: 'in_review',
  pseudonym: 'Reporter-K7PQ',
  createdAt: CREATED_AT,
  dueAt: DUE_AT,
  handlerFunction: 'alternate',
  routeKind: 'standard',
  messages: [REPORTER_MESSAGE, HANDLER_REPLY],
};

export const SAMPLE_MY_FEEDBACK_CASES: MyFeedbackCasesResponse = {
  items: [
    {
      id: SAMPLE_FEEDBACK_CASE_ID,
      kind: 'problem',
      category: 'workload',
      state: 'in_review',
      pseudonym: 'Reporter-K7PQ',
      createdAt: CREATED_AT,
      lastMessageAt: LAST_MESSAGE_AT,
      dueAt: DUE_AT,
    },
    {
      id: SAMPLE_FEEDBACK_CASE_RESOLVED_ID,
      kind: 'suggestion',
      category: 'communication',
      state: 'resolved',
      pseudonym: 'Reporter-3MZA',
      createdAt: '2026-09-15T10:00:00.000Z',
      lastMessageAt: '2026-09-18T14:20:00.000Z',
      dueAt: null,
    },
  ],
};

export const SAMPLE_FEEDBACK_INBOX: HandlerFeedbackInboxResponse = {
  items: [
    {
      id: SAMPLE_FEEDBACK_CASE_ID,
      kind: 'problem',
      category: 'workload',
      state: 'in_review',
      pseudonym: 'Reporter-K7PQ',
      routeKind: 'standard',
      routeChoice: 'alternate',
      nextAction: 'respond',
      dueAt: DUE_AT,
      overdue: false,
      escalatedAt: null,
      createdAt: CREATED_AT,
      lastMessageAt: LAST_MESSAGE_AT,
    },
    {
      id: SAMPLE_FEEDBACK_CASE_OVERDUE_ID,
      kind: 'problem',
      category: 'equipment',
      state: 'submitted',
      pseudonym: 'Reporter-9QWD',
      routeKind: 'standard',
      routeChoice: 'alternate',
      nextAction: 'acknowledge_escalation',
      dueAt: '2026-10-25T09:00:00.000Z',
      overdue: true,
      escalatedAt: '2026-10-26T09:30:00.000Z',
      createdAt: '2026-10-22T09:00:00.000Z',
      lastMessageAt: '2026-10-22T09:00:00.000Z',
    },
  ],
};

export const SAMPLE_HANDLER_FEEDBACK_CASE: HandlerFeedbackCaseResponse = {
  id: SAMPLE_FEEDBACK_CASE_ID,
  orgId: SAMPLE_ORG.id,
  kind: 'problem',
  category: 'workload',
  state: 'in_review',
  pseudonym: 'Reporter-K7PQ',
  anonymousToEmployer: true,
  routeKind: 'standard',
  routeChoice: 'alternate',
  handlerUserId: 'user_ivana',
  nextAction: 'respond',
  dueAt: DUE_AT,
  escalatedAt: null,
  resolvedAt: null,
  closedAt: null,
  outcomeReason: null,
  createdAt: CREATED_AT,
  messages: [REPORTER_MESSAGE, INTERNAL_NOTE, HANDLER_REPLY],
};
