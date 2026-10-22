/**
 * Reference data for RetentionPolicy rows.
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

export const RETENTION_POLICIES: readonly RetentionPolicyRow[] = [
  // Identity data: 10 years after the last obligation ends.
  {
    dataCategory: 'identity',
    jurisdiction: 'DEFAULT',
    serviceType: null,
    minDays: 10 * YEAR,
    maxDays: null,
    legalBasis: 'pending counsel (L-02, L-03)',
  },
  // Memberships: 10 years after end.
  {
    dataCategory: 'membership',
    jurisdiction: 'DEFAULT',
    serviceType: null,
    minDays: 10 * YEAR,
    maxDays: null,
    legalBasis: 'pending counsel (L-02, L-03)',
  },
  // Support request metadata: 10 years after closure.
  {
    dataCategory: 'support_request_metadata',
    jurisdiction: 'DEFAULT',
    serviceType: null,
    minDays: 10 * YEAR,
    maxDays: null,
    legalBasis: 'pending counsel (L-02, L-03)',
  },
  // Conversation content: 5 years after closure (DEFAULT).
  {
    dataCategory: 'conversation_content',
    jurisdiction: 'DEFAULT',
    serviceType: null,
    minDays: 5 * YEAR,
    maxDays: null,
    legalBasis: 'pending counsel (L-02, L-03)',
  },
  // Conversation content: 15 years in Serbia if healthcare.
  {
    dataCategory: 'conversation_content',
    jurisdiction: 'RS',
    serviceType: 'healthcare',
    minDays: 15 * YEAR,
    maxDays: null,
    legalBasis: 'pending counsel (L-02, L-03)',
  },
  // Conversation content: 30 years in Hungary if healthcare.
  {
    dataCategory: 'conversation_content',
    jurisdiction: 'HU',
    serviceType: 'healthcare',
    minDays: 30 * YEAR,
    maxDays: null,
    legalBasis: 'pending counsel (L-02, L-03)',
  },
  // Financial ledger: 20 years.
  {
    dataCategory: 'financial_ledger',
    jurisdiction: 'DEFAULT',
    serviceType: null,
    minDays: 20 * YEAR,
    maxDays: null,
    legalBasis: 'pending counsel (L-02, L-03)',
  },
  // Insurer authorizations: 20 years with masked codes.
  {
    dataCategory: 'insurer_authorization',
    jurisdiction: 'DEFAULT',
    serviceType: null,
    minDays: 20 * YEAR,
    maxDays: null,
    legalBasis: 'pending counsel (L-02, L-03)',
  },
  // Audit: security 3 years.
  {
    dataCategory: 'audit_security',
    jurisdiction: 'DEFAULT',
    serviceType: null,
    minDays: 3 * YEAR,
    maxDays: 3 * YEAR,
    legalBasis: 'pending counsel (L-02, L-03)',
  },
  // Audit: authorization 10 years.
  {
    dataCategory: 'audit_authorization',
    jurisdiction: 'DEFAULT',
    serviceType: null,
    minDays: 10 * YEAR,
    maxDays: 10 * YEAR,
    legalBasis: 'pending counsel (L-02, L-03)',
  },
  // Audit: financial 10 years.
  {
    dataCategory: 'audit_financial',
    jurisdiction: 'DEFAULT',
    serviceType: null,
    minDays: 10 * YEAR,
    maxDays: 10 * YEAR,
    legalBasis: 'pending counsel (L-02, L-03)',
  },
  // Audit: content access 1 year.
  {
    dataCategory: 'audit_content_access',
    jurisdiction: 'DEFAULT',
    serviceType: null,
    minDays: 1 * YEAR,
    maxDays: 1 * YEAR,
    legalBasis: 'pending counsel (L-02, L-03)',
  },
  // Audit: admin 10 years.
  {
    dataCategory: 'audit_admin',
    jurisdiction: 'DEFAULT',
    serviceType: null,
    minDays: 10 * YEAR,
    maxDays: 10 * YEAR,
    legalBasis: 'pending counsel (L-02, L-03)',
  },
  // Marketing leads: 24 months.
  {
    dataCategory: 'marketing_lead',
    jurisdiction: 'DEFAULT',
    serviceType: null,
    minDays: 730,
    maxDays: 730,
    legalBasis: 'pending counsel (L-02, L-03)',
  },
  // Published content: permanent; drafts 2 years.
  {
    dataCategory: 'published_content',
    jurisdiction: 'DEFAULT',
    serviceType: null,
    minDays: 0,
    maxDays: null,
    legalBasis: 'pending counsel (L-02, L-03)',
  },
  {
    dataCategory: 'draft_content',
    jurisdiction: 'DEFAULT',
    serviceType: null,
    minDays: 2 * YEAR,
    maxDays: 2 * YEAR,
    legalBasis: 'pending counsel (L-02, L-03)',
  },
  // Expert credentials: 10 years after last delivery.
  {
    dataCategory: 'expert_credential',
    jurisdiction: 'DEFAULT',
    serviceType: null,
    minDays: 10 * YEAR,
    maxDays: null,
    legalBasis: 'pending counsel (L-02, L-03)',
  },
  // Hungarian employment-related records created from 2025-01-01: 3 years after employment ends.
  {
    dataCategory: 'employment_record',
    jurisdiction: 'HU',
    serviceType: null,
    minDays: 3 * YEAR,
    maxDays: 3 * YEAR,
    legalBasis: 'pending counsel (L-02, L-03)',
  },
] as const;
