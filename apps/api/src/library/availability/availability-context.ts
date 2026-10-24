/**
 * AvailabilityContext — the reader's context for evaluating the availability
 * formula (C-10). Built once per request by AvailabilityContextLoader and
 * threaded through every library read path.
 *
 * @see 5.9.1, ACC-R-17, ACC-R-25
 */

/**
 * Authored locales that are stored in the database. `sr-Cyrl` is derived
 * at read time and never stored as a variant (C-28, DAT-R-05).
 */
export type AuthoredLocale = 'sr-Latn' | 'hu' | 'en';

/** All reader locales including Cyrillic Serbian. */
export type ReaderLocale = AuthoredLocale | 'sr-Cyrl';

export interface AvailabilityContext {
  /** The authenticated user's id. */
  userId: string;
  /** The personal-context organization id (from an ACTIVE membership). */
  orgId: string;
  /** The membership id for the current org context. */
  membershipId: string;
  /**
   * The reader's org-unit ancestry chain. `[0]` is the member's primary unit;
   * the rest are ancestors from `org_unit_closure`, ordered nearest-first.
   * May be empty if the membership has no org unit assigned.
   */
  orgUnitIds: string[];
  /**
   * Enabled content capability keys for `orgId` at `now`, loaded once per
   * request from `org_content_capabilities`.
   */
  capabilities: string[];
  /** The reader's interface locale, driving the content locale (C-28). */
  readerLocale: ReaderLocale;
  /** The current timestamp, injected for testability and preview simulation. */
  now: Date;
}

/**
 * Map a reader locale to the authored locale stored in `content_variants`.
 * `sr-Cyrl` maps to `sr-Latn` (C-28); every other locale maps to itself.
 */
export function authoredLocale(locale: ReaderLocale): AuthoredLocale {
  return locale === 'sr-Cyrl' ? 'sr-Latn' : locale;
}
