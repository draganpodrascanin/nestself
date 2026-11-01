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
  // Planning assumptions under D-CW-29 for the tables it does not name.
  // Occurrences, hosts, certificates and recording rows: 7 years (FINANCIAL tier).
  row('webinars', 7 * YEAR, 7 * YEAR),
  row('webinar_hosts', 7 * YEAR, 7 * YEAR),
  row('webinar_certificates', 7 * YEAR, 7 * YEAR),
  row('webinar_recordings', 7 * YEAR, 7 * YEAR),
  // Consent records: with the session, 7 years (FINANCIAL tier).
  row('call_consents', 7 * YEAR, 7 * YEAR),
  // Registrations: 24 months (ADMIN tier).
  row('webinar_registrations', 730, 730),
  // Polls, options and aggregate results: 1 year (CONTENT_ACCESS tier).
  row('webinar_polls', 1 * YEAR, 1 * YEAR),
  row('webinar_poll_options', 1 * YEAR, 1 * YEAR),
  row('webinar_poll_results', 1 * YEAR, 1 * YEAR),
  // Employee listening (ADR 0002; spec PRI-05): one class per kind of record,
  // never one blanket policy. Defaults pending the DPIA and counsel.
  // Private drafts: purged 30 days after the cycle closes (SECURITY tier).
  row('survey_drafts', 30, 30),
  // The participation link (eligibility, reminders, receipt): 1 year after publication.
  row('survey_participation_links', 1 * YEAR, 1 * YEAR),
  // Raw answers with no identity column: 3 years, for corrections and re-releases.
  row('survey_responses', 3 * YEAR, 3 * YEAR),
  // Published aggregate snapshots: 10 years (the employer's reporting history).
  row('survey_snapshots', 10 * YEAR, 10 * YEAR),
  // Feedback cases and their messages: 5 years after closure.
  row('feedback_cases', 5 * YEAR, 5 * YEAR),
  // Workplace review documents (reports, packs, notes): 10 years.
  row('review_documents', 10 * YEAR, 10 * YEAR),
  // Scope acceptances and other financial references: 10 years (FINANCIAL tier).
  row('review_financial_references', 10 * YEAR, 10 * YEAR),
];
