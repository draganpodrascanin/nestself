/**
 * Maps a library API error to a user-facing translated message.
 *
 * Follows the `mapAuthError` pattern (CLI-R-11). Unknown codes render
 * `error.unknown` rather than falling through.
 */
import { ApiError } from '@nestself/api-client';
import type { TFunction } from 'i18next';

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
    if (err.code === 'network') {
      return t('error.network');
    }
    return t('error.unknown');
  }
  return t('error.unknown');
}
