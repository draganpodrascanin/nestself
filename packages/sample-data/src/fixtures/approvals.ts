/**
 * Sample follow-up approval (NS-CALLS-01, D-CW-37, T-CW-1.5): the sample HR
 * administrator `user_ivana` also approves follow-ups. She holds the
 * `approver` template (`grant_user_ivana_approver` in SAMPLE_GRANTS) and an
 * approval authority over the whole sample organization, and one pending
 * approval item waits for her: the sample `awaiting_approval` follow-up.
 * The `/approvals` screen renders `SAMPLE_APPROVAL_ITEMS` in sample mode; the
 * API seed writes the authority and the `appointment_approvals` row.
 *
 * The sample organization's follow-up policy stays `automatic`: the
 * `awaiting_approval` fixture stands for a follow-up confirmed while the
 * policy was `manager_approval`.
 */
import { APPROVAL_FOLLOW_UP_DESCRIPTION, type AppointmentApprovalItem } from '@nestself/contracts';
import { SAMPLE_APPOINTMENTS } from './appointments.ts';
import { SAMPLE_PEOPLE } from './people.ts';

/** An `approval_authorities` row of the sample organization. */
export interface SampleApprovalAuthority {
  readonly id: string;
  readonly userId: string;
  readonly orgId: string;
  readonly orgUnitId: string;
  readonly includeDescendants: boolean;
  readonly categories: readonly string[];
  readonly alternateUserId: string | null;
  readonly validFrom: string;
  readonly sample: true;
}

/** An approval item as `GET /orgs/:orgId/appointment-approvals` lists it; `sample: true` is the fixture marker. */
export type SampleApprovalItem = AppointmentApprovalItem & { readonly sample: true };

export const SAMPLE_APPROVER_USER_ID = 'user_ivana';

export const SAMPLE_APPROVAL_AUTHORITIES: readonly SampleApprovalAuthority[] = [
  {
    id: 'approval_authority_sample_ivana',
    userId: SAMPLE_APPROVER_USER_ID,
    orgId: 'org_sample',
    // The organization's root with its descendants: every sample employee's unit.
    orgUnitId: 'ou_root',
    includeDescendants: true,
    categories: [],
    alternateUserId: null,
    validFrom: '2026-01-01T00:00:00.000Z',
    sample: true,
  },
];

const awaiting = SAMPLE_APPOINTMENTS.find((appointment) => appointment.status === 'awaiting_approval');
if (!awaiting) throw new Error('SAMPLE_APPOINTMENTS has no awaiting_approval follow-up');
const employee = SAMPLE_PEOPLE.find((person) => person.id === awaiting.employeeUserId);
if (!employee) throw new Error(`No sample person ${awaiting.employeeUserId}`);

export const SAMPLE_APPROVAL_ITEMS: readonly SampleApprovalItem[] = [
  {
    id: 'approval_sample_follow_up_awaiting',
    appointmentId: awaiting.id,
    status: 'pending',
    employeeDisplayName: employee.displayName,
    description: APPROVAL_FOLLOW_UP_DESCRIPTION,
    startsAt: awaiting.startsAt,
    durationMinutes: Math.round((Date.parse(awaiting.endsAt) - Date.parse(awaiting.startsAt)) / 60_000),
    sample: true,
  },
];
