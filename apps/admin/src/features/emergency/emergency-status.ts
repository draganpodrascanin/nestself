/**
 * The status of an emergency access record, derived from its timestamps the
 * same way the API decides (`isActive` in the emergency service): the
 * sweeper sets `revokedAt` on expired windows only later, so an approved
 * row past `expiresAt` is shown as expired before that happens, and one the
 * sweeper closed (revoked at or after expiry) stays expired.
 */
import type { BadgeTone } from '@nestself/ui';
import type { EmergencyAccessResponse } from '@nestself/contracts';

export const EMERGENCY_STATUSES = ['pending', 'active', 'expired', 'revoked'] as const;
export type EmergencyStatus = (typeof EMERGENCY_STATUSES)[number];

export function emergencyStatus(row: EmergencyAccessResponse, now: number): EmergencyStatus {
  const expiresAt = Date.parse(row.expiresAt);
  if (row.revokedAt !== null) {
    // Revoked before the window ran out by a person; at or after it by the sweeper.
    return row.approvedByUserId !== null && Date.parse(row.revokedAt) >= expiresAt ? 'expired' : 'revoked';
  }
  if (row.approvedByUserId === null) return 'pending';
  return expiresAt <= now ? 'expired' : 'active';
}

export const EMERGENCY_STATUS_TONE: Record<EmergencyStatus, BadgeTone> = {
  pending: 'warning',
  active: 'danger',
  expired: 'neutral',
  revoked: 'neutral',
};

/** Whole hours and minutes left until `expiresAt`, rounded up to the minute; `null` once it has passed. */
export function remaining(expiresAt: string, now: number): { hours: number; minutes: number } | null {
  const ms = Date.parse(expiresAt) - now;
  if (ms <= 0) return null;
  const total = Math.ceil(ms / 60_000);
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}
