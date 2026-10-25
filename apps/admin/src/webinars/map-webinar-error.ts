/**
 * Translated copy for a failed webinar request (error-visibility rule): the
 * call mapper for every `CALL_ERROR_CODES` entry and the generic codes, with
 * the webinar's own join window (a webinar room opens before the start and
 * closes after the end, unlike a consultation's).
 */
import { ApiError } from '@nestself/api-client';
import type { TFunction } from 'i18next';
import { mapCallError } from '../calls/map-call-error';

export function mapWebinarError(err: unknown, t: TFunction<'calls'>): string {
  if (err instanceof ApiError && err.code === 'join_window_closed') return t('webinar.errors.joinWindowClosed');
  return mapCallError(err, t);
}

/** True for the API's "not open yet" answer to an attendee join: the lobby, not a failure. */
export function isWebinarNotOpen(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'webinar_not_open';
}
