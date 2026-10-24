/**
 * Reference data for retention_policies rows.
 * Seeded from Part C of Appendix I of the auth strategy document.
 *
 * Legal basis values are placeholders pending counsel (L-02, L-03).
 * All periods are in days.
 */

export interface RetentionPolicyRow {
  dataCategory: string;
  jurisdiction: string;
  serviceType: string | null;
  minDays: number;
  maxDays: number | null;
  legalBasis: string;
}

const YEAR = 365;
const PENDING = 'pending counsel (L-02, L-03)';

function row(
  dataCategory: string,
  minDays: number,
  maxDays: number | null,
  jurisdiction = 'DEFAULT',
  serviceType: string | null = null,
): RetentionPolicyRow {
  return { dataCategory, jurisdiction, serviceType, minDays, maxDays, legalBasis: PENDING };
}

export const RETENTION_POLICIES: readonly RetentionPolicyRow[] = [
  // Identity data: 10 years after the last obligation ends.
  row('identity', 10 * YEAR, null),
  // Memberships: 10 years after end.
  row('membership', 10 * YEAR, null),
  // Support request metadata: 10 years after closure.
  row('support_request_metadata', 10 * YEAR, null),
  // Conversation content: 5 years after closure (DEFAULT).
  row('conversation_content', 5 * YEAR, null),
  // Conversation content: 15 years in Serbia if healthcare.
  row('conversation_content', 15 * YEAR, null, 'RS', 'healthcare'),
  // Conversation content: 30 years in Hungary if healthcare.
  row('conversation_content', 30 * YEAR, null, 'HU', 'healthcare'),
  // Financial ledger: 20 years.
  row('financial_ledger', 20 * YEAR, null),
  // Insurer authorizations: 20 years with masked codes.
  row('insurer_authorization', 20 * YEAR, null),
  // Audit tiers [D-21].
  row('audit_security', 3 * YEAR, 3 * YEAR),
  row('audit_authorization', 10 * YEAR, 10 * YEAR),
  row('audit_financial', 10 * YEAR, 10 * YEAR),
  row('audit_content_access', 1 * YEAR, 1 * YEAR),
  row('audit_admin', 10 * YEAR, 10 * YEAR),
  // Marketing leads: 24 months.
  row('marketing_lead', 730, 730),
  // Published content: permanent; drafts 2 years.
  row('published_content', 0, null),
  row('draft_content', 2 * YEAR, 2 * YEAR),
  // Expert credentials: 10 years after last delivery.
  row('expert_credential', 10 * YEAR, null),
  // Hungarian employment-related records created from 2025-01-01: 3 years after employment ends.
  row('employment_record', 3 * YEAR, 3 * YEAR, 'HU'),
  // Calls and webinars [D-CW-29, guidelines 16.3]: defaults, not law; the DPIA
  // and L-02, L-03 can change them. Each is a single period (min = max).
  // Appointment and session metadata, participants, outcomes and provider
  // events: 7 years, delivery status feeds settlement (FINANCIAL tier).
  row('appointments', 7 * YEAR, 7 * YEAR),
  row('call_sessions', 7 * YEAR, 7 * YEAR),
  row('call_participants', 7 * YEAR, 7 * YEAR),
  row('call_events', 7 * YEAR, 7 * YEAR),
  row('call_outcomes', 7 * YEAR, 7 * YEAR),
  // Follow-up approval items: with the appointment, 7 years (FINANCIAL tier).
  row('appointment_approvals', 7 * YEAR, 7 * YEAR),
  // Client diagnostics: 90 days (ADMIN tier).
  row('call_client_events', 90, 90),
  // Consultation feedback: 24 months (ADMIN tier).
  row('call_feedback', 730, 730),
  // Workshop chat: 24 hours after the session (ADMIN tier).
  row('call_messages', 1, 1),
  // Webinar messages and questions: 12 months after the occurrence, then
  // author links removed (CONTENT_ACCESS tier).
  row('webinar_messages', 1 * YEAR, 1 * YEAR),
  // Raw webinar recording segments in S3: 30 days, the bucket lifecycle
  // (CONTENT_ACCESS tier). The concatenated replay follows the CMS content
  // lifecycle (published_content, draft_content above).
  row('webinar_recording_segments', 30, 30),
  // Ephemeral location text on call_sessions (F-CW-04): deleted when the
  // session ends (SECURITY tier).
  row('call_session_location_text', 0, 0),
];
