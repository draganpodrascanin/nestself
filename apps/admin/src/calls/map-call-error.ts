/**
 * Maps a failed call or appointment request to translated copy in the
 * `calls` namespace (guidelines 12.4, CW-R-60, CW-R-61), following the
 * per-code pattern of the workspace app's `auth/map-auth-error.ts`.
 *
 * Every `CALL_ERROR_CODES` entry maps to `calls:errors.<camelCase>`;
 * `capacity_above_limit` carries the server's `limit` detail, else the replicated capacity. The API's own
 * `message` is English and written for developers, so it is never shown:
 * an unknown code falls back to `errors.unknown`.
 */
import { ApiError } from '@nestself/api-client';
import { CALL_ERROR_CODES, WEBINAR_REPLICATED_CAPACITY } from '@nestself/contracts';
import type { CallErrorCode } from '@nestself/contracts';
import type { TFunction } from 'i18next';

type CallsT = TFunction<'calls'>;

/**
 * One translated message per call error code (CW-R-60). Keyed by string so a
 * code the contracts add later can be mapped before it lands; the test
 * checks that every `CALL_ERROR_CODES` entry has one.
 */
export const CALL_ERROR_MESSAGES: Readonly<Record<string, (t: CallsT, err: ApiError) => string>> = {
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
  capacity_above_limit: (t, err) => {
    const limit = err.details?.['limit'];
    return t('webinar.capacityAboveLimit', { limit: typeof limit === 'number' ? limit : WEBINAR_REPLICATED_CAPACITY });
  },
  invalid_ticket: (t) => t('errors.invalidTicket'),
  not_editable: (t) => t('errors.notEditable'),
};

/** Generic API codes every call screen can meet. */
const GENERIC_MESSAGES: Readonly<Record<string, (t: CallsT) => string>> = {
  network: (t) => t('errors.network'),
  not_found: (t) => t('errors.notFound'),
  forbidden: (t) => t('errors.forbidden'),
  rate_limited: (t) => t('errors.rateLimited'),
  validation: (t) => t('errors.validation'),
  // Webinars (T-CW-2.4): a step the occurrence, message or poll does not allow in its current state.
  conflict: (t) => t('errors.conflict'),
  // The session cookie ran out mid-call or mid-form: sign in again.
  unauthenticated: (t) => t('errors.sessionExpired'),
  session_expired: (t) => t('errors.sessionExpired'),
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
    const mapped = isCallErrorCode(err.code) || err.code in CALL_ERROR_MESSAGES ? CALL_ERROR_MESSAGES[err.code] : undefined;
    if (mapped) return mapped(t, err);
    const generic = GENERIC_MESSAGES[err.code];
    if (generic) return generic(t);
    if (err.status === 404) return t('errors.notFound');
    if (err.status === 429) return t('errors.rateLimited');
  }
  return t('errors.unknown');
}
