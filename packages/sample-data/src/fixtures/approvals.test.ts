import { describe, expect, it } from 'vitest';
import { AppointmentApprovalItemSchema } from '@nestself/contracts';
import {
  SAMPLE_APPOINTMENTS,
  SAMPLE_APPROVAL_AUTHORITIES,
  SAMPLE_APPROVAL_ITEMS,
  SAMPLE_APPROVER_USER_ID,
  SAMPLE_GRANTS,
  SAMPLE_ORG_UNITS,
  SAMPLE_PRINCIPALS,
} from '../index.ts';

describe('sample follow-up approval (T-CW-1.5)', () => {
  it('lists one pending item for the awaiting_approval follow-up, in the API shape, flagged as sample', () => {
    expect(SAMPLE_APPROVAL_ITEMS).toHaveLength(1);
    const [item] = SAMPLE_APPROVAL_ITEMS;
    const { sample, ...apiShape } = item!;
    expect(sample).toBe(true);
    expect(AppointmentApprovalItemSchema.parse(apiShape)).toEqual(apiShape);
    const awaiting = SAMPLE_APPOINTMENTS.find((a) => a.status === 'awaiting_approval')!;
    expect(item).toMatchObject({ appointmentId: awaiting.id, status: 'pending', startsAt: awaiting.startsAt, durationMinutes: 50 });
  });

  it('names the sample HR administrator as the approver, with the approver grant and an authority over the organization', () => {
    expect(SAMPLE_APPROVER_USER_ID).toBe('user_ivana');
    const grant = SAMPLE_GRANTS.find((g) => g.id === 'grant_user_ivana_approver');
    expect(grant).toMatchObject({ subjectUserId: 'user_ivana', templateKey: 'approver', scopeType: 'organization', scopeOrgId: 'org_sample' });
    expect(grant!.actions).toContain('approval.decide');
    expect(SAMPLE_PRINCIPALS.hr_admin.effectiveActions).toContain('approval.decide');

    const [authority] = SAMPLE_APPROVAL_AUTHORITIES;
    expect(authority).toMatchObject({ userId: 'user_ivana', orgId: 'org_sample', includeDescendants: true, sample: true });
    const root = SAMPLE_ORG_UNITS.find((unit) => unit.id === authority!.orgUnitId);
    expect(root?.parentId).toBeNull();
  });
});
