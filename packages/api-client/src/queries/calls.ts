/**
 * TanStack Query options for the appointment and call routes (guidelines
 * 12.3). There is no option for `join`: its response holds meeting
 * credentials, and a query or mutation would keep them in a cache (CW-R-59).
 */
import { infiniteQueryOptions, mutationOptions, queryOptions } from '@tanstack/react-query';
import type {
  AppointmentApprovalDecisionRequest,
  CallFeedbackRequest,
  CallProblemReportRequest,
  CallOutcomeRequest,
  CallSignalRequest,
  FollowUpApprovalPolicy,
  FollowUpProposeRequest,
  FollowUpScheduleRequest,
  FollowUpSuggestTimesRequest,
} from '@nestself/contracts';
import { ApiError } from '../errors';
import type { AppointmentListParams, CallsApi } from '../calls';

export const appointmentKeys = {
  all: ['appointments'] as const,
  lists: () => [...appointmentKeys.all, 'list'] as const,
  list: (params: Omit<AppointmentListParams, 'cursor'>) => [...appointmentKeys.lists(), params] as const,
  detail: (appointmentId: string) => [...appointmentKeys.all, 'detail', appointmentId] as const,
  location: (appointmentId: string) => [...appointmentKeys.all, 'location', appointmentId] as const,
};

/** A 4xx answer will not change on a retry; a network failure or a 5xx may. */
export function retryUnlessClientError(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

/** `GET /appointments`, cursor-paged: `fetchNextPage()` loads the next `nextCursor`. */
export const appointmentListQuery = (api: CallsApi, params: Omit<AppointmentListParams, 'cursor'> = {}) =>
  infiniteQueryOptions({
    queryKey: appointmentKeys.list(params),
    queryFn: ({ pageParam }) => api.listAppointments({ ...params, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    retry: retryUnlessClientError,
  });

/** `GET /appointments/:id` */
export const appointmentDetailQuery = (api: CallsApi, appointmentId: string) =>
  queryOptions({
    queryKey: appointmentKeys.detail(appointmentId),
    queryFn: () => api.getAppointment(appointmentId),
    retry: retryUnlessClientError,
  });

/**
 * `GET /appointments/:id/location` (expert, CALL-34). Never kept after the
 * screen that reads it is gone (`gcTime: 0`), matching the server's
 * `Cache-Control: no-store`.
 */
export const appointmentLocationQuery = (api: CallsApi, appointmentId: string) =>
  queryOptions({
    queryKey: appointmentKeys.location(appointmentId),
    queryFn: () => api.getLocation(appointmentId),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

export const endCallMutation = (api: CallsApi, appointmentId: string) =>
  mutationOptions({
    mutationKey: [...appointmentKeys.detail(appointmentId), 'end'],
    mutationFn: () => api.end(appointmentId),
  });

export const recordOutcomeMutation = (api: CallsApi, appointmentId: string) =>
  mutationOptions({
    mutationKey: [...appointmentKeys.detail(appointmentId), 'outcome'],
    mutationFn: (body: CallOutcomeRequest) => api.recordOutcome(appointmentId, body),
  });

export const submitFeedbackMutation = (api: CallsApi, appointmentId: string) =>
  mutationOptions({
    mutationKey: [...appointmentKeys.detail(appointmentId), 'feedback'],
    mutationFn: (body: CallFeedbackRequest) => api.submitFeedback(appointmentId, body),
  });

export const sendSignalMutation = (api: CallsApi, appointmentId: string) =>
  mutationOptions({
    mutationKey: [...appointmentKeys.detail(appointmentId), 'signal'],
    mutationFn: (signal: CallSignalRequest) => api.sendSignal(appointmentId, signal),
  });

export const cancelAppointmentMutation = (api: CallsApi, appointmentId: string) =>
  mutationOptions({
    mutationKey: [...appointmentKeys.detail(appointmentId), 'cancel'],
    mutationFn: () => api.cancel(appointmentId),
  });

export const proposeFollowUpMutation = (api: CallsApi, appointmentId: string) =>
  mutationOptions({
    mutationKey: [...appointmentKeys.detail(appointmentId), 'follow-up'],
    mutationFn: (body: FollowUpProposeRequest) => api.proposeFollowUp(appointmentId, body),
  });

export const confirmFollowUpMutation = (api: CallsApi, appointmentId: string) =>
  mutationOptions({
    mutationKey: [...appointmentKeys.detail(appointmentId), 'confirm'],
    mutationFn: () => api.confirmFollowUp(appointmentId),
  });

export const suggestFollowUpTimesMutation = (api: CallsApi, appointmentId: string) =>
  mutationOptions({
    mutationKey: [...appointmentKeys.detail(appointmentId), 'suggest-times'],
    mutationFn: (body: FollowUpSuggestTimesRequest) => api.suggestTimes(appointmentId, body),
  });

export const scheduleFollowUpMutation = (api: CallsApi, appointmentId: string) =>
  mutationOptions({
    mutationKey: [...appointmentKeys.detail(appointmentId), 'schedule'],
    mutationFn: (body: FollowUpScheduleRequest) => api.scheduleFollowUp(appointmentId, body),
  });

export const declineFollowUpMutation = (api: CallsApi, appointmentId: string) =>
  mutationOptions({
    mutationKey: [...appointmentKeys.detail(appointmentId), 'decline'],
    mutationFn: () => api.declineFollowUp(appointmentId),
  });

/** `POST /calls/:sessionId/problem-report` (CALL-16). */
export const reportProblemMutation = (api: CallsApi, sessionId: string) =>
  mutationOptions({
    mutationKey: ['calls', sessionId, 'problem-report'],
    mutationFn: (body: CallProblemReportRequest) => api.reportProblem(sessionId, body),
  });

// ── Follow-up approvals and the organization policy (T-CW-1.10) ───────────

export const approvalKeys = {
  all: ['appointment-approvals'] as const,
  list: (orgId: string) => [...approvalKeys.all, orgId] as const,
};

export const followUpPolicyKeys = {
  detail: (orgId: string) => ['follow-up-policy', orgId] as const,
};

/** `GET /orgs/:orgId/appointment-approvals` */
export const approvalListQuery = (api: CallsApi, orgId: string) =>
  queryOptions({
    queryKey: approvalKeys.list(orgId),
    queryFn: () => api.listApprovals(orgId),
    retry: retryUnlessClientError,
  });

export const approveApprovalMutation = (api: CallsApi) =>
  mutationOptions({
    mutationKey: [...approvalKeys.all, 'approve'],
    mutationFn: (approvalId: string) => api.approveApproval(approvalId),
  });

export const rejectApprovalMutation = (api: CallsApi) =>
  mutationOptions({
    mutationKey: [...approvalKeys.all, 'reject'],
    mutationFn: ({ approvalId, ...body }: { approvalId: string } & AppointmentApprovalDecisionRequest) =>
      api.rejectApproval(approvalId, body),
  });

/** `GET /orgs/:orgId/settings/follow-up-approval` (HR). */
export const followUpPolicyQuery = (api: CallsApi, orgId: string) =>
  queryOptions({
    queryKey: followUpPolicyKeys.detail(orgId),
    queryFn: () => api.getFollowUpPolicy(orgId),
    retry: retryUnlessClientError,
  });

export const setFollowUpPolicyMutation = (api: CallsApi, orgId: string) =>
  mutationOptions({
    mutationKey: [...followUpPolicyKeys.detail(orgId), 'set'],
    mutationFn: (policy: FollowUpApprovalPolicy) => api.setFollowUpPolicy(orgId, policy),
  });
