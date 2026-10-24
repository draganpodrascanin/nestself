export { createApiClient } from './client';
export type { ApiClient, ApiClientOptions, ApiClientMode } from './client';
export { ApiError } from './errors';
export { createAuthApi } from './auth';
export type { AuthApi } from './auth';
export { createOrgAdminApi } from './org-admin';
export type { OrgAdminApi, OpsAdminApi, OrgAdminBase, GrantListParams } from './org-admin';
export { healthQueryOptions } from './queries/health';
export { meQueryOptions } from './queries/auth';
export { createCallsApi } from './calls';
export type { CallsApi, AppointmentListParams } from './calls';
export { joinWindowBounds, joinWindowState, nextJoinWindowChange } from './join-window';
export type { JoinWindowOptions, JoinWindowState } from './join-window';
export { USER_ROOM_EVENTS, createUserRoomClient, noopUserRoomClient, userRoomSubscribeMessage } from './user-room';
export type { UserRoomClient, UserRoomHandlers } from './user-room';
export {
  CALL_ROOM_EVENTS,
  callRoomName,
  callRoomSubscribeMessage,
  createCallRoomClient,
  noopCallRoomClient,
} from './call-room';
export type {
  CallRoomClient,
  CallRoomHandlers,
  CallRoomParticipantEvent,
  FollowUpProposedEvent,
  RoomSocket,
} from './call-room';
export { CLIENT_EVENT_POST_INTERVAL_MS, startClientEventPoster } from './client-events';
export type { ClientEventPoster, ClientEventPosterOptions } from './client-events';
export {
  appointmentKeys,
  appointmentListQuery,
  appointmentDetailQuery,
  appointmentLocationQuery,
  retryUnlessClientError,
  endCallMutation,
  recordOutcomeMutation,
  submitFeedbackMutation,
  sendSignalMutation,
  cancelAppointmentMutation,
  proposeFollowUpMutation,
  confirmFollowUpMutation,
  suggestFollowUpTimesMutation,
  scheduleFollowUpMutation,
  declineFollowUpMutation,
  reportProblemMutation,
  approvalKeys,
  approvalListQuery,
  approveApprovalMutation,
  rejectApprovalMutation,
  followUpPolicyKeys,
  followUpPolicyQuery,
  setFollowUpPolicyMutation,
} from './queries/calls';
