import type { InvitationResponse } from '@nestself/contracts';

/** A sample pending invitation; `sample: true` is the fixture marker, not part of the API shape. */
export type SampleInvitation = InvitationResponse & { sample: true };

/**
 * Pending invitations of the sample organization, shown on the HR People
 * page in sample mode. Fictional addresses on the reserved `example.com`
 * domain; nothing was sent to anyone.
 */
export const SAMPLE_INVITATIONS: SampleInvitation[] = [
  {
    id: 'inv_sample_marko',
    email: 'marko.ilic@example.com',
    orgId: 'org_sample',
    orgUnitId: 'team_product',
    templateKey: 'employee',
    expiresAt: '2026-11-08T09:00:00.000Z',
    revokedAt: null,
    acceptedAt: null,
    invitedByUserId: 'user_ivana',
    createdAt: '2026-10-25T09:00:00.000Z',
    sample: true,
  },
  {
    id: 'inv_sample_jelena',
    email: 'jelena.savic@example.com',
    orgId: 'org_sample',
    orgUnitId: 'team_sales',
    templateKey: 'team_manager',
    expiresAt: '2026-11-06T13:30:00.000Z',
    revokedAt: null,
    acceptedAt: null,
    invitedByUserId: 'user_ivana',
    createdAt: '2026-10-23T13:30:00.000Z',
    sample: true,
  },
  {
    id: 'inv_sample_petar',
    email: 'petar.kovac@example.com',
    orgId: 'org_sample',
    orgUnitId: null,
    templateKey: 'employee',
    expiresAt: '2026-11-04T08:15:00.000Z',
    revokedAt: null,
    acceptedAt: null,
    invitedByUserId: 'user_ivana',
    createdAt: '2026-10-21T08:15:00.000Z',
    sample: true,
  },
];
