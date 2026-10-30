/**
 * Sample-mode data for the People and Org units screens, derived from the
 * shared fixtures. Nothing here is created or sent anywhere.
 */
import {
  SAMPLE_INVITATIONS,
  SAMPLE_ORG_UNITS,
  SAMPLE_PEOPLE,
  SAMPLE_PRINCIPALS,
} from '@nestself/sample-data';
import type { InvitationResponse, MemberItem, OrgUnitResponse } from '@nestself/contracts';

const DEFAULT_START = '2024-01-01T00:00:00.000Z';

export function sampleMembers(orgId: string): MemberItem[] {
  const memberships = Object.values(SAMPLE_PRINCIPALS).flatMap((p) =>
    p.principal.memberships.map((m) => ({ ...m, userId: p.principal.userId })),
  );
  return SAMPLE_PEOPLE.filter((p) => p.orgId === orgId).map((p) => {
    const membership = memberships.find((m) => m.userId === p.id && m.orgId === orgId);
    return {
      membershipId: membership?.membershipId ?? `mem_${p.id}`,
      userId: p.id,
      displayName: p.displayName,
      email: `${p.id}@example.com`,
      orgUnitId: membership?.orgUnitId ?? null,
      costCenterUnitId: null,
      lineManagerUserId: null,
      status: 'ACTIVE',
      startDate: membership?.startDate ?? DEFAULT_START,
      endDate: null,
    };
  });
}

export function sampleOrgUnits(orgId: string): OrgUnitResponse[] {
  return SAMPLE_ORG_UNITS.filter((u) => u.orgId === orgId).map((u) => ({
    id: u.id,
    orgId: u.orgId,
    parentId: u.parentId,
    kind: u.kind,
    name: u.name,
    costCenterCode: null,
    archivedAt: null,
  }));
}

export function sampleInvitations(orgId: string): InvitationResponse[] {
  return SAMPLE_INVITATIONS.filter((i) => i.orgId === orgId).map(({ sample: _sample, ...rest }) => rest);
}
