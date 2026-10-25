/**
 * Typed wrappers for the appointment and consultation call routes
 * (T-CW-1.5, guidelines 7.1 and 12.3, decision record section 7).
 *
 * Every method parses the response through the matching contracts schema.
 * `join` is the only method that returns meeting credentials: it asks the
 * browser not to cache the response (`cache: 'no-store'`, matching the
 * server's `Cache-Control: no-store`) and this module never logs or keeps
 * what it returns. The caller hands the response to the call controller and
 * drops it (CW-R-59, CW-R-69); there is deliberately no query or mutation
 * option for it, because both would hold the credentials in a cache.
 *
 * The approval and policy methods serve T-CW-1.10's routes: the approver
 * sees four facts per item and nothing else (D-CW-37), which the strict item
 * schema enforces on the client too.
 *
 * The follow-up methods serve T-CW-1.9's routes; each answers the appointment
 * it changed or created, with the participants' first names and, for a
 * proposal the employee answered with other times, the suggested windows.
 */
import { z } from 'zod';
import {
  AppointmentApprovalItemSchema,
  AppointmentApprovalListResponseSchema,
  AppointmentListResponseSchema,
  AppointmentResponseSchema,
  CLIENT_EVENT_BATCH_MAX,
  CallJoinResponseSchema,
  CallLocationResponseSchema,
  DiagnosticsResponseSchema,
  FollowUpApprovalPolicyResponseSchema,
  ProblemReportListItemSchema,
  ProblemReportListResponseSchema,
} from '@nestself/contracts';
import type {
  AppointmentApprovalDecisionRequest,
  AppointmentCreateRequest,
  AppointmentResponse,
  ProblemReportListItem,
  ProblemReportListResponse,
  AppointmentStatus,
  CallFeedbackRequest,
  CallProblemReportRequest,
  CallJoinRequest,
  CallOutcomeRequest,
  CallSignalRequest,
  ClientEventRequest,
  FollowUpApprovalPolicy,
  FollowUpProposeRequest,
  FollowUpScheduleRequest,
  FollowUpSuggestTimesRequest,
} from '@nestself/contracts';
import type { ApiClient } from './client';

/** Query of `GET /appointments` (`AppointmentListQuerySchema`); every field is optional. */
export interface AppointmentListParams {
  limit?: number;
  cursor?: string;
  orgId?: string;
  status?: AppointmentStatus;
  /** Inclusive lower bound of `startsAt` (ISO date-time). */
  from?: string;
  /** Exclusive upper bound of `startsAt` (ISO date-time). */
  to?: string;
  /** Only the follow-ups of this consultation. */
  followUpOf?: string;
}

/** Query of `GET /ops/calls/problem-reports` (PLT-05, CALL-16); every field is optional. */
export interface ProblemReportListParams {
  orgId?: string;
  /** Inclusive lower bound of `reportedAt` (ISO date-time). */
  from?: string;
  /** Exclusive upper bound of `reportedAt` (ISO date-time). */
  to?: string;
  limit?: number;
  cursor?: string;
}

/**
 * An appointment as the detail and list routes return it to a participant,
 * with the reader's fields (`viewer`, and for the employee of a declined
 * follow-up `approvalOutcome` and `declineReason`, CALL-05, CALL-07,
 * CALL-39). The contracts' response schema carries them; these names stay
 * for the apps that import them from here.
 */
export { APPROVAL_OUTCOMES, AppointmentViewerSchema } from '@nestself/contracts';
export type { AppointmentViewer } from '@nestself/contracts';
export const AppointmentViewSchema = AppointmentResponseSchema;
export type AppointmentView = AppointmentResponse;

/** One technical problem report as operations list it (`GET /ops/calls/problem-reports`). */
export const ProblemReportItemSchema = ProblemReportListItemSchema;
export type ProblemReportItem = ProblemReportListItem;
export { ProblemReportListResponseSchema };
export type { ProblemReportListResponse };

const NoContentSchema = z.undefined();

function jsonPost(body: unknown): RequestInit {
  return {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  };
}

/** `?a=1&b=2` from the defined entries; empty string when none are defined. */
function queryString(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params) as [string, unknown][]) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

const appointmentPath = (id: string, suffix = '') => `/api/appointments/${encodeURIComponent(id)}${suffix}`;
const approvalPath = (id: string, suffix: string) => `/api/appointment-approvals/${encodeURIComponent(id)}${suffix}`;
const policyPath = (orgId: string) => `/api/orgs/${encodeURIComponent(orgId)}/settings/follow-up-approval`;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function createCallsApi(client: ApiClient) {
  /** POST /appointments/:id/suggest-times: the employee suggests one to three other windows. */
  const suggestTimes = (appointmentId: string, body: FollowUpSuggestTimesRequest) =>
    client.request(appointmentPath(appointmentId, '/suggest-times'), {
      ...jsonPost(body),
      schema: AppointmentResponseSchema,
    });

  return {
    /** GET /appointments: one cursor page of the caller's appointments (participants) or coordinated organizations (operations). */
    listAppointments: (params: AppointmentListParams = {}) =>
      client.request(`/api/appointments${queryString(params)}`, {
        method: 'GET',
        schema: AppointmentListResponseSchema,
      }),

    /** GET /appointments/:id, with what the reader needs (`viewer`, a declined follow-up's reason). */
    getAppointment: (appointmentId: string) =>
      client.request(appointmentPath(appointmentId), {
        method: 'GET',
        schema: AppointmentResponseSchema,
      }),

    /**
     * POST /orgs/:orgId/appointments (CALL-26): operations book a consultation
     * for an employee of an assigned organisation with an expert approved for
     * the category. Answers the new `confirmed` appointment (201).
     */
    createAppointment: (orgId: string, body: AppointmentCreateRequest) =>
      client.request(`/api/orgs/${encodeURIComponent(orgId)}/appointments`, {
        ...jsonPost(body),
        schema: AppointmentResponseSchema,
      }),

    /** GET /ops/calls/:sessionId/diagnostics (PLT-05): exactly the support fields of D-CW-28; the view is audited. */
    getDiagnostics: (sessionId: string) =>
      client.request(`/api/ops/calls/${encodeURIComponent(sessionId)}/diagnostics`, {
        method: 'GET',
        cache: 'no-store',
        schema: DiagnosticsResponseSchema,
      }),

    /** GET /ops/calls/problem-reports (CALL-16): the technical problem reports of the organisations the caller supports. */
    listProblemReports: (params: ProblemReportListParams = {}) =>
      client.request(`/api/ops/calls/problem-reports${queryString(params)}`, {
        method: 'GET',
        schema: ProblemReportListResponseSchema,
      }),

    /** POST /appointments/:id/cancel */
    cancel: (appointmentId: string) =>
      client.request(appointmentPath(appointmentId, '/cancel'), {
        method: 'POST',
        schema: AppointmentResponseSchema,
      }),

    /**
     * POST /appointments/:id/join: Chime SDK credentials for this participant.
     * `locationText` only for the employee of a psychological consultation
     * (CALL-34). Not cached by the browser, never logged, never stored.
     */
    join: (appointmentId: string, body: CallJoinRequest = {}) =>
      client.request(appointmentPath(appointmentId, '/join'), {
        ...jsonPost(body),
        cache: 'no-store',
        schema: CallJoinResponseSchema,
      }),

    /** POST /appointments/:id/end: the expert ends the session for both (204). */
    end: (appointmentId: string) =>
      client.request(appointmentPath(appointmentId, '/end'), {
        method: 'POST',
        schema: NoContentSchema,
        expectBody: false,
      }),

    /** POST /appointments/:id/outcome: the expert records the delivery status; returns the updated appointment. */
    recordOutcome: (appointmentId: string, body: CallOutcomeRequest) =>
      client.request(appointmentPath(appointmentId, '/outcome'), {
        ...jsonPost(body),
        schema: AppointmentResponseSchema,
      }),

    /** POST /appointments/:id/feedback: the employee's private rating (204). */
    submitFeedback: (appointmentId: string, body: CallFeedbackRequest) =>
      client.request(appointmentPath(appointmentId, '/feedback'), {
        ...jsonPost(body),
        schema: NoContentSchema,
        expectBody: false,
      }),

    /** POST /appointments/:id/signal: "running late", "I cannot hear you", "I cannot see you" (204). */
    sendSignal: (appointmentId: string, signal: CallSignalRequest) =>
      client.request(appointmentPath(appointmentId, '/signal'), {
        ...jsonPost(signal),
        schema: NoContentSchema,
        expectBody: false,
      }),

    /** GET /appointments/:id/location: the location the employee shared, for the assigned expert (CALL-34). */
    getLocation: (appointmentId: string) =>
      client.request(appointmentPath(appointmentId, '/location'), {
        method: 'GET',
        cache: 'no-store',
        schema: CallLocationResponseSchema,
      }),

    /**
     * POST /calls/:sessionId/client-events: connection metadata of D-CW-13,
     * sent in batches of at most `CLIENT_EVENT_BATCH_MAX`. An empty list
     * sends nothing.
     */
    postClientEvents: async (sessionId: string, events: readonly ClientEventRequest[]): Promise<void> => {
      for (let start = 0; start < events.length; start += CLIENT_EVENT_BATCH_MAX) {
        await client.request(`/api/calls/${encodeURIComponent(sessionId)}/client-events`, {
          ...jsonPost({ events: events.slice(start, start + CLIENT_EVENT_BATCH_MAX) }),
          schema: NoContentSchema,
          expectBody: false,
        });
      }
    },

    /**
     * POST /calls/:sessionId/problem-report (CALL-16): a fixed category and
     * the call's connection summary, never free text (204).
     */
    reportProblem: (sessionId: string, body: CallProblemReportRequest) =>
      client.request(`/api/calls/${encodeURIComponent(sessionId)}/problem-report`, {
        ...jsonPost(body),
        schema: NoContentSchema,
        expectBody: false,
      }),

    /** POST /appointments/:id/follow-up: the expert proposes a follow-up; returns the new `proposed` appointment. */
    proposeFollowUp: (appointmentId: string, body: FollowUpProposeRequest) =>
      client.request(appointmentPath(appointmentId, '/follow-up'), {
        ...jsonPost(body),
        schema: AppointmentResponseSchema,
      }),

    /** POST /appointments/:id/confirm: the employee confirms a proposal. */
    confirmFollowUp: (appointmentId: string) =>
      client.request(appointmentPath(appointmentId, '/confirm'), {
        ...jsonPost({}),
        schema: AppointmentResponseSchema,
      }),

    suggestTimes,
    /** The T-CW-1.5 name of {@link suggestTimes}, kept as an alias. */
    suggestFollowUpTimes: suggestTimes,

    /** POST /appointments/:id/schedule: the expert picks one suggested window. */
    scheduleFollowUp: (appointmentId: string, body: FollowUpScheduleRequest) =>
      client.request(appointmentPath(appointmentId, '/schedule'), {
        ...jsonPost(body),
        schema: AppointmentResponseSchema,
      }),

    /** POST /appointments/:id/decline: the employee declines a proposal. */
    declineFollowUp: (appointmentId: string) =>
      client.request(appointmentPath(appointmentId, '/decline'), {
        ...jsonPost({}),
        schema: AppointmentResponseSchema,
      }),

    // ── Follow-up approvals (T-CW-1.10, D-CW-37) ──────────────────────────

    /** GET /orgs/:orgId/appointment-approvals: the items the caller approves or is the alternate for. */
    listApprovals: (orgId: string) =>
      client.request(`/api/orgs/${encodeURIComponent(orgId)}/appointment-approvals`, {
        method: 'GET',
        schema: AppointmentApprovalListResponseSchema,
      }),

    /** POST /appointment-approvals/:id/approve */
    approveApproval: (approvalId: string) =>
      client.request(approvalPath(approvalId, '/approve'), {
        ...jsonPost({}),
        schema: AppointmentApprovalItemSchema,
      }),

    /** POST /appointment-approvals/:id/reject: the safe reason goes to the employee only. */
    rejectApproval: (approvalId: string, body: AppointmentApprovalDecisionRequest) =>
      client.request(approvalPath(approvalId, '/reject'), {
        ...jsonPost(body),
        schema: AppointmentApprovalItemSchema,
      }),

    /** GET /orgs/:orgId/settings/follow-up-approval (HR). */
    getFollowUpPolicy: (orgId: string) =>
      client.request(policyPath(orgId), { method: 'GET', schema: FollowUpApprovalPolicyResponseSchema }),

    /** PATCH /orgs/:orgId/settings/follow-up-approval (HR). */
    setFollowUpPolicy: (orgId: string, policy: FollowUpApprovalPolicy) =>
      client.request(policyPath(orgId), {
        method: 'PATCH',
        body: JSON.stringify({ policy }),
        headers: { 'Content-Type': 'application/json' },
        schema: FollowUpApprovalPolicyResponseSchema,
      }),

    /**
     * A probe for the pre-join network check: times an authenticated,
     * uncached read of the appointment through the API, so the result
     * reflects the path to NestSelf rather than to the page's origin.
     */
    networkProbe:
      (appointmentId: string) =>
      async (): Promise<number> => {
        const started = now();
        await client.request(appointmentPath(appointmentId), {
          method: 'GET',
          cache: 'no-store',
          schema: z.unknown(),
        });
        return now() - started;
      },
  };
}

export type CallsApi = ReturnType<typeof createCallsApi>;
