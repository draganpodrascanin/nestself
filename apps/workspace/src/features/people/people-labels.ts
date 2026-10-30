/**
 * Display helpers and vocabularies shared by the People screen and dialogs.
 */
import { PERMISSION_TEMPLATES } from '@nestself/contracts';
import type { MemberItem, MembershipEndedReason, OrgUnitResponse } from '@nestself/contracts';
import type { BadgeTone } from '@nestself/ui';

/**
 * Templates an organization may invite people with: active templates of the
 * organization and employee workspaces (the server's `findInvitableTemplate`).
 */
export const INVITABLE_TEMPLATES = PERMISSION_TEMPLATES.filter(
  (tpl) => (tpl.workspace === 'organization' || tpl.workspace === 'employee') && tpl.isActive,
);

export function isInvitableTemplate(key: string): boolean {
  return INVITABLE_TEMPLATES.some((tpl) => tpl.key === key);
}

export type MemberStatus = MemberItem['status'];

export const MEMBER_STATUSES: readonly MemberStatus[] = ['ACTIVE', 'INVITED', 'ENDED'];

export const STATUS_TONE: Record<MemberStatus, BadgeTone> = {
  ACTIVE: 'success',
  INVITED: 'info',
  ENDED: 'neutral',
};

/**
 * Reasons HR can record when ending a membership. `SUSPENDED_BY_PLATFORM` is
 * the platform's own reason (operations suspend users), so it is not offered.
 */
export const END_REASONS: readonly MembershipEndedReason[] = [
  'LEFT',
  'CONTRACT_ENDED',
  'DEACTIVATED_BY_HR',
  'MERGED',
];

/** Units HR can still assign people to. */
export function activeUnits(units: readonly OrgUnitResponse[]): OrgUnitResponse[] {
  return units.filter((u) => u.archivedAt === null);
}
