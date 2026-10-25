/**
 * Maps a library API error to a user-facing translated message.
 *
 * Follows the `mapAuthError` pattern (CLI-R-11). Unknown codes render
 * `error.unknown` rather than falling through.
 */
import { ApiError } from '@nestself/api-client';
import type { TFunction } from 'i18next';

/**
 * Maps a library error to a translated message for page-level error states
 * (loading failures, 404, network).
 */
export function mapLibraryError(
  err: unknown,
  t: TFunction<'library'>,
): string {
  if (err instanceof ApiError) {
    if (err.code === 'content_not_available') {
      return t('error.contentNotAvailable');
    }
    if (err.code === 'invalid_context') {
      return t('error.invalidContext');
    }
    if (err.code === 'org_context_expired') {
      return t('error.orgContextExpired');
    }
    if (err.code === 'network') {
      return t('error.network');
    }
    return t('error.unknown');
  }
  return t('error.unknown');
}

/**
 * Maps a save/unsave mutation error to a translated toast message.
 *
 * Known API codes (`content_not_available`, `org_context_expired`, `network`)
 * get their own specific copy. Unknown codes fall back to the action-specific
 * message (`error.saveFailed` or `error.unsaveFailed`), then `error.unknown`.
 */
export function mapSaveError(
  err: unknown,
  t: TFunction<'library'>,
  action: 'save' | 'unsave',
): string {
  if (err instanceof ApiError) {
    if (err.code === 'content_not_available') {
      return t('error.contentNotAvailable');
    }
    if (err.code === 'org_context_expired') {
      return t('error.orgContextExpired');
    }
    if (err.code === 'network') {
      return t('error.network');
    }
    // Unknown API code: use the action-specific fallback
    return action === 'save' ? t('error.saveFailed') : t('error.unsaveFailed');
  }
  // Non-API error (e.g. TypeError from fetch): action-specific fallback
  return action === 'save' ? t('error.saveFailed') : t('error.unsaveFailed');
}
