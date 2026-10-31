/**
 * Content capabilities — the services an organization can enable for employees.
 *
 * This is the single source of truth for the `content_capability` PostgreSQL
 * enum, the CTA `open_service` target validation in `@nestself/content/schema`,
 * and any API-side capability checks.
 */

export const CONTENT_CAPABILITIES = [
  'library',
  'general_questions',
  'event_interest',
] as const;

export type ContentCapability = (typeof CONTENT_CAPABILITIES)[number];
