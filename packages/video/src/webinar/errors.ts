/**
 * Coded failures of webinar actions and their translated copy (error
 * visibility rule): every `CALL_ERROR_CODES` entry and the generic API codes
 * map to `calls:errors.*`; anything else falls back to `errors.unknown`. The
 * API's own `message` is English and written for developers, so it is never
 * shown.
 */
import { CALL_ERROR_CODES, WEBINAR_SINGLE_MEETING_CAPACITY } from '@nestself/contracts';
import type { CallErrorCode } from '@nestself/contracts';
import type { WebinarAction, WebinarActionErrorLike } from './types';

/** A failed webinar action. `cause` keeps the transport's own error (the api-client's `ApiError`). */
export class WebinarActionError extends Error implements WebinarActionErrorLike {
  readonly code: string;
  readonly action: WebinarAction | 'floor.audio';

  constructor(action: WebinarAction | 'floor.audio', code: string, options?: { cause?: unknown }) {
    super(`Webinar action ${action} failed: ${code}`, options);
    this.name = 'WebinarActionError';
    this.action = action;
    this.code = code;
  }
}

/** Normalises whatever the transport rejected with: the `code` of an `ApiError`, else `network` or `unknown`. */
export function toWebinarActionError(action: WebinarAction | 'floor.audio', error: unknown): WebinarActionError {
  if (error instanceof WebinarActionError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && code.length > 0) return new WebinarActionError(action, code, { cause: error });
  if (error instanceof TypeError) return new WebinarActionError(action, 'network', { cause: error });
  return new WebinarActionError(action, 'unknown', { cause: error });
}

type CallsT = (key: string, options?: Record<string, unknown>) => string;

const CALL_ERROR_KEYS: { readonly [Code in CallErrorCode]: string } = {
  join_window_closed: 'errors.joinWindowClosed',
  appointment_not_joinable: 'errors.appointmentNotJoinable',
  appointment_not_proposed: 'errors.appointmentNotProposed',
  approval_not_pending: 'errors.approvalNotPending',
  approver_missing: 'errors.approverMissing',
  follow_up_not_allowed: 'errors.followUpNotAllowed',
  video_provider_unavailable: 'errors.videoProviderUnavailable',
  webinar_full: 'errors.webinarFull',
  webinar_not_open: 'errors.webinarNotOpen',
  registration_closed: 'errors.registrationClosed',
  already_registered: 'errors.alreadyRegistered',
  not_eligible: 'errors.notEligible',
  floor_not_available: 'errors.floorNotAvailable',
  recording_not_allowed: 'errors.recordingNotAllowed',
  capacity_above_limit: 'webinar.capacityAboveLimit',
  invalid_ticket: 'errors.invalidTicket',
};

const GENERIC_KEYS: Readonly<Record<string, string>> = {
  network: 'errors.network',
  not_found: 'errors.notFound',
  forbidden: 'errors.forbidden',
  rate_limited: 'errors.rateLimited',
  validation: 'errors.validation',
  microphone_unavailable: 'webinar.errors.microphoneUnavailable',
};

function isCallErrorCode(code: string): code is CallErrorCode {
  return (CALL_ERROR_CODES as readonly string[]).includes(code);
}

/**
 * Translated copy for a webinar action failure, using `t` of the `calls`
 * namespace. Returns null when there is no error, `errors.unknown` for a code
 * without copy.
 */
export function webinarErrorMessage(error: WebinarActionErrorLike | string | null | undefined, t: CallsT): string | null {
  if (!error) return null;
  const code = typeof error === 'string' ? error : error.code;
  if (isCallErrorCode(code)) return t(CALL_ERROR_KEYS[code], { limit: WEBINAR_SINGLE_MEETING_CAPACITY });
  const generic = GENERIC_KEYS[code];
  return t(generic ?? 'errors.unknown');
}
