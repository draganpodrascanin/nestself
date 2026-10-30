import type { EmergencyAccessResponse } from '@nestself/contracts';

/** A sample emergency access record; `sample: true` is the fixture marker, not part of the API shape. */
export type SampleEmergencyAccess = EmergencyAccessResponse & { sample: true };

/**
 * Emergency access records shown on the admin Emergency access page in
 * sample mode: one pending request and one approved window that was revoked
 * early, so the statuses shown do not depend on the clock. The requester is
 * the sample operations staff member, the approver the sample platform
 * admin, the scope the sample case. Fictional; nobody read anything.
 */
export const SAMPLE_EMERGENCY_ACCESS: SampleEmergencyAccess[] = [
  {
    id: 'ea_sample_pending',
    userId: 'user_nikola',
    approvedByUserId: null,
    approvedAt: null,
    purpose: 'Sample request (fixture): check a reported safety concern on the sample case.',
    scopeKind: 'CASE',
    scopeId: 'case_sample',
    durationMinutes: 60,
    grantedAt: '2026-10-25T08:00:00.000Z',
    expiresAt: '2026-10-25T09:00:00.000Z',
    revokedAt: null,
    sample: true,
  },
  {
    id: 'ea_sample_revoked',
    userId: 'user_nikola',
    approvedByUserId: 'user_admin',
    approvedAt: '2026-10-20T10:05:00.000Z',
    purpose: 'Sample request (fixture): confirm the sample employee records after a support ticket.',
    scopeKind: 'USER_RECORDS',
    scopeId: 'user_jovan',
    durationMinutes: 120,
    grantedAt: '2026-10-20T10:05:00.000Z',
    expiresAt: '2026-10-20T12:05:00.000Z',
    revokedAt: '2026-10-20T10:40:00.000Z',
    sample: true,
  },
];
