/**
 * Maps a failed call or appointment request to translated copy in the
 * `calls` namespace (guidelines 12.4, CW-R-60, CW-R-61), following the
 * per-code pattern of the workspace app's `auth/map-auth-error.ts`.
 *
 * Every `CALL_ERROR_CODES` entry maps to `calls:errors.<camelCase>`;
 * `capacity_above_limit` carries the single-meeting limit. The API's own
 * `message` is English and written for developers, so it is never shown:
 * an unknown code falls back to `errors.unknown`.
 */
import { ApiError } from '@nestself/api-client';
import { CALL_ERROR_CODES, WEBINAR_SINGLE_MEETING_CAPACITY } from '@nestself/contracts';
import type { CallErrorCode } from '@nestself/contracts';
import type { TFunction } from 'i18next';

type CallsT = TFunction<'calls'>;

/** One translated message per call error code (CW-R-60). */
export const CALL_ERROR_MESSAGES: { readonly [Code in CallErrorCode]: (t: CallsT) => string } = {
  join_window_closed: (t) => t('errors.joinWindowClosed'),
  appointment_not_joinable: (t) => t('errors.appointmentNotJoinable'),
  appointment_not_proposed: (t) => t('errors.appointmentNotProposed'),
  approval_not_pending: (t) => t('errors.approvalNotPending'),
  approver_missing: (t) => t('errors.approverMissing'),
  follow_up_not_allowed: (t) => t('errors.followUpNotAllowed'),
  video_provider_unavailable: (t) => t('errors.videoProviderUnavailable'),
  webinar_full: (t) => t('errors.webinarFull'),
  webinar_not_open: (t) => t('errors.webinarNotOpen'),
  registration_closed: (t) => t('errors.registrationClosed'),
  already_registered: (t) => t('errors.alreadyRegistered'),
  not_eligible: (t) => t('errors.notEligible'),
  floor_not_available: (t) => t('errors.floorNotAvailable'),
  recording_not_allowed: (t) => t('errors.recordingNotAllowed'),
  capacity_above_limit: (t) => t('webinar.capacityAboveLimit', { limit: WEBINAR_SINGLE_MEETING_CAPACITY }),
  invalid_ticket: (t) => t('errors.invalidTicket'),
};

/** Generic API codes every call screen can meet. */
const GENERIC_MESSAGES: Readonly<Record<string, (t: CallsT) => string>> = {
  network: (t) => t('errors.network'),
  not_found: (t) => t('errors.notFound'),
  forbidden: (t) => t('errors.forbidden'),
  rate_limited: (t) => t('errors.rateLimited'),
  validation: (t) => t('errors.validation'),
};

function isCallErrorCode(code: string): code is CallErrorCode {
  return (CALL_ERROR_CODES as readonly string[]).includes(code);
}

/** The error's API code, or null for anything that is not an `ApiError`. */
export function callErrorCode(err: unknown): string | null {
  return err instanceof ApiError ? err.code : null;
}

export function mapCallError(err: unknown, t: CallsT): string {
  if (err instanceof ApiError) {
    if (isCallErrorCode(err.code)) return CALL_ERROR_MESSAGES[err.code](t);
    const generic = GENERIC_MESSAGES[err.code];
    if (generic) return generic(t);
    if (err.status === 404) return t('errors.notFound');
    if (err.status === 429) return t('errors.rateLimited');
  }
  return t('errors.unknown');
}
