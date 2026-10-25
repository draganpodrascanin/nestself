import { describe, it, expect } from 'vitest';
import type { EmergencyAccessResponse } from '@nestself/contracts';
import { emergencyStatus, remaining } from './emergency-status';

const NOW = Date.parse('2026-10-25T12:00:00.000Z');
const iso = (offsetMinutes: number) => new Date(NOW + offsetMinutes * 60_000).toISOString();

function row(overrides: Partial<EmergencyAccessResponse>): EmergencyAccessResponse {
  return {
    id: 'ea_1',
    userId: 'user_a',
    approvedByUserId: null,
    approvedAt: null,
    purpose: 'A written purpose',
    scopeKind: 'CASE',
    scopeId: 'case_1',
    durationMinutes: 60,
    grantedAt: iso(-10),
    expiresAt: iso(50),
    revokedAt: null,
    ...overrides,
  };
}

describe('emergencyStatus', () => {
  it('is pending while nobody approved and nothing revoked it', () => {
    expect(emergencyStatus(row({}), NOW)).toBe('pending');
    // A pending request's provisional expiry does not make it expired.
    expect(emergencyStatus(row({ expiresAt: iso(-1) }), NOW)).toBe('pending');
  });

  it('is active when approved, not revoked and not yet expired', () => {
    expect(emergencyStatus(row({ approvedByUserId: 'user_b', approvedAt: iso(-5) }), NOW)).toBe('active');
  });

  it('is expired when approved and the window has passed, before and after the sweeper', () => {
    const approved = { approvedByUserId: 'user_b', approvedAt: iso(-70), expiresAt: iso(0) };
    expect(emergencyStatus(row(approved), NOW)).toBe('expired');
    expect(emergencyStatus(row({ ...approved, revokedAt: iso(1) }), NOW)).toBe('expired');
  });

  it('is revoked when a person ended the window early', () => {
    expect(
      emergencyStatus(row({ approvedByUserId: 'user_b', approvedAt: iso(-20), revokedAt: iso(-5) }), NOW),
    ).toBe('revoked');
    // Still revoked once the original window has also passed.
    expect(
      emergencyStatus(row({ approvedByUserId: 'user_b', expiresAt: iso(-1), revokedAt: iso(-30) }), NOW),
    ).toBe('revoked');
  });
});

describe('remaining', () => {
  it('rounds up to whole minutes and splits hours', () => {
    expect(remaining(iso(90), NOW)).toEqual({ hours: 1, minutes: 30 });
    expect(remaining(new Date(NOW + 30_000).toISOString(), NOW)).toEqual({ hours: 0, minutes: 1 });
  });

  it('is null once the expiry has passed', () => {
    expect(remaining(iso(0), NOW)).toBeNull();
    expect(remaining(iso(-5), NOW)).toBeNull();
  });
});
