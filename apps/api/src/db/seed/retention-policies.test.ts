import { describe, expect, it } from 'vitest';
import { RETENTION_POLICIES } from './retention-policies.js';

const DAYS_PER_YEAR = 365;

/** Every table the calls and webinars epic adds (decision record section 7). */
const CALLS_TABLES = [
  'appointments',
  'appointment_approvals',
  'call_sessions',
  'call_participants',
  'call_events',
  'call_client_events',
  'call_outcomes',
  'call_feedback',
  'call_consents',
  'call_messages',
  'webinars',
  'webinar_hosts',
  'webinar_registrations',
  'webinar_messages',
  'webinar_polls',
  'webinar_poll_options',
  'webinar_poll_results',
  'webinar_recordings',
  'webinar_certificates',
] as const;

/**
 * D-CW-29 retention defaults for the calls and webinars epic (implementation
 * guidelines 16.3), in days. Each is a single period, so the minimum and the
 * maximum are equal.
 */
const CALLS_RETENTION_DAYS: Readonly<Record<string, number>> = {
  // FINANCIAL tier: appointment and session metadata, participants, outcomes, provider events.
  appointments: 7 * DAYS_PER_YEAR,
  call_sessions: 7 * DAYS_PER_YEAR,
  call_participants: 7 * DAYS_PER_YEAR,
  call_events: 7 * DAYS_PER_YEAR,
  call_outcomes: 7 * DAYS_PER_YEAR,
  // FINANCIAL tier: approval items stay with the appointment.
  appointment_approvals: 7 * DAYS_PER_YEAR,
  // ADMIN tier.
  call_client_events: 90,
  call_feedback: 730,
  call_messages: 1,
  // CONTENT_ACCESS tier.
  webinar_messages: DAYS_PER_YEAR,
  webinar_recording_segments: 30,
  // SECURITY tier: deleted when the session ends.
  call_session_location_text: 0,
  // Planning assumptions under D-CW-29 for the tables it does not name.
  webinars: 7 * DAYS_PER_YEAR,
  webinar_hosts: 7 * DAYS_PER_YEAR,
  webinar_certificates: 7 * DAYS_PER_YEAR,
  webinar_recordings: 7 * DAYS_PER_YEAR,
  call_consents: 7 * DAYS_PER_YEAR,
  webinar_registrations: 730,
  webinar_polls: DAYS_PER_YEAR,
  webinar_poll_options: DAYS_PER_YEAR,
  webinar_poll_results: DAYS_PER_YEAR,
};

describe('RETENTION_POLICIES', () => {
  it('lists the 19 tables of the calls and webinars epic', () => {
    expect(CALLS_TABLES).toHaveLength(19);
    expect(new Set(CALLS_TABLES).size).toBe(19);
  });

  it.each(CALLS_TABLES)('has a retention row for the %s table', (table) => {
    expect(RETENTION_POLICIES.some((rp) => rp.dataCategory === table)).toBe(true);
    expect(CALLS_RETENTION_DAYS[table]).toBeDefined();
  });

  it('has one row per data category, jurisdiction and service type (the unique index)', () => {
    const keys = RETENTION_POLICIES.map((rp) => `${rp.dataCategory}|${rp.jurisdiction}|${rp.serviceType ?? ''}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(Object.entries(CALLS_RETENTION_DAYS))('seeds the D-CW-29 default for %s', (dataCategory, days) => {
    const rows = RETENTION_POLICIES.filter((rp) => rp.dataCategory === dataCategory);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      dataCategory,
      jurisdiction: 'DEFAULT',
      serviceType: null,
      minDays: days,
      maxDays: days,
      legalBasis: 'pending counsel (L-02, L-03)',
    });
  });

  it('keeps every period a non-negative whole number of days with max not below min', () => {
    for (const rp of RETENTION_POLICIES) {
      expect(Number.isInteger(rp.minDays)).toBe(true);
      expect(rp.minDays).toBeGreaterThanOrEqual(0);
      if (rp.maxDays !== null) expect(rp.maxDays).toBeGreaterThanOrEqual(rp.minDays);
    }
  });
});
