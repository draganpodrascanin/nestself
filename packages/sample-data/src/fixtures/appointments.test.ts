import { describe, it, expect } from 'vitest';
import {
  AppointmentSchema,
  CallFeedbackRequestSchema,
  CallFormatSchema,
  CallOutcomeRequestSchema,
  CallParticipantRoleSchema,
  CallQualityMetricsSchema,
  CallSessionStatusSchema,
  FOLLOW_UP_DURATION_MAX_MINUTES,
  FOLLOW_UP_DURATION_MIN_MINUTES,
} from '@nestself/contracts';
import {
  SAMPLE_APPOINTMENTS,
  SAMPLE_CALL_SESSIONS,
  SAMPLE_EXPERT_CREDENTIALS,
  SAMPLE_ORG,
  SAMPLE_PEOPLE,
} from '../index.ts';

const people = new Map<string, (typeof SAMPLE_PEOPLE)[number]>(SAMPLE_PEOPLE.map((p) => [p.id, p]));

function byStatus(status: string) {
  const found = SAMPLE_APPOINTMENTS.filter((a) => a.status === status);
  expect(found).toHaveLength(1);
  return found[0]!;
}

function belgradeWallClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Belgrade',
  });
}

const minutesBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 60_000;

describe('SAMPLE_APPOINTMENTS', () => {
  it('every row parses with AppointmentSchema and is marked as sample', () => {
    for (const appointment of SAMPLE_APPOINTMENTS) {
      expect(AppointmentSchema.safeParse(appointment).success).toBe(true);
      expect(appointment.sample).toBe(true);
    }
  });

  it('has five appointments with unique ids, one per lifecycle example', () => {
    expect(SAMPLE_APPOINTMENTS).toHaveLength(5);
    expect(new Set(SAMPLE_APPOINTMENTS.map((a) => a.id)).size).toBe(5);
    expect(SAMPLE_APPOINTMENTS.map((a) => a.status).sort()).toEqual(
      ['awaiting_approval', 'canceled', 'completed', 'confirmed', 'proposed'].sort(),
    );
  });

  it('points at the sample organisation, a sample expert and a sample employee of that organisation', () => {
    for (const a of SAMPLE_APPOINTMENTS) {
      expect(a.orgId).toBe(SAMPLE_ORG.id);
      expect(people.get(a.expertUserId)?.platformRole).toBe('expert');
      const employee = people.get(a.employeeUserId);
      expect(employee?.orgId).toBe(a.orgId);
      expect(employee?.orgRole).toBe('employee');
    }
  });

  it('uses a service category the sample experts hold', () => {
    const categories = new Set<string>(SAMPLE_EXPERT_CREDENTIALS.map((c) => c.serviceCategory));
    for (const a of SAMPLE_APPOINTMENTS) expect(categories.has(a.serviceCategory)).toBe(true);
  });

  it('is scheduled in Europe/Belgrade without a funding reference', () => {
    for (const a of SAMPLE_APPOINTMENTS) {
      expect(a.timeZone).toBe('Europe/Belgrade');
      expect(a.fundingRef).toBeNull();
    }
  });

  it('links both follow-ups, and only them, to the completed appointment', () => {
    const completed = byStatus('completed');
    const proposed = byStatus('proposed');
    const awaiting = byStatus('awaiting_approval');
    expect(proposed.followUpOf).toBe(completed.id);
    expect(awaiting.followUpOf).toBe(completed.id);
    for (const a of SAMPLE_APPOINTMENTS) {
      if (a !== proposed && a !== awaiting) expect(a.followUpOf).toBeNull();
    }
  });

  it('places the follow-ups after the completed appointment, within the follow-up duration limits', () => {
    const completed = byStatus('completed');
    for (const followUp of [byStatus('proposed'), byStatus('awaiting_approval')]) {
      expect(Date.parse(followUp.startsAt)).toBeGreaterThan(Date.parse(completed.endsAt));
      const duration = minutesBetween(followUp.startsAt, followUp.endsAt);
      expect(duration).toBeGreaterThanOrEqual(FOLLOW_UP_DURATION_MIN_MINUTES);
      expect(duration).toBeLessThanOrEqual(FOLLOW_UP_DURATION_MAX_MINUTES);
    }
  });

  it('schedules the confirmed appointment after every other one (the upcoming example)', () => {
    const confirmed = byStatus('confirmed');
    for (const a of SAMPLE_APPOINTMENTS) {
      if (a !== confirmed) expect(Date.parse(confirmed.startsAt)).toBeGreaterThan(Date.parse(a.startsAt));
    }
  });

  it('reads the intended Belgrade wall-clock time on both sides of the daylight-saving change', () => {
    expect(belgradeWallClock(byStatus('completed').startsAt)).toBe('16:00');
    expect(belgradeWallClock(byStatus('confirmed').startsAt)).toBe('17:00');
  });
});

describe('SAMPLE_CALL_SESSIONS (consultation)', () => {
  const consultations = SAMPLE_CALL_SESSIONS.filter((s) => s.format === 'consultation');

  it('has exactly one consultation session, linked to the completed appointment', () => {
    expect(consultations).toHaveLength(1);
    const session = consultations[0]!;
    const completed = byStatus('completed');
    expect(session.appointmentId).toBe(completed.id);
    expect(session.webinarId).toBeNull();
    expect(session.orgId).toBe(completed.orgId);
    expect(session.startsAt).toBe(completed.startsAt);
    expect(session.endsAt).toBe(completed.endsAt);
  });

  it('every session uses the contract enums and is marked as sample', () => {
    for (const session of SAMPLE_CALL_SESSIONS) {
      expect(CallFormatSchema.safeParse(session.format).success).toBe(true);
      expect(CallSessionStatusSchema.safeParse(session.status).success).toBe(true);
      expect(session.sample).toBe(true);
      for (const participant of session.participants) {
        expect(CallParticipantRoleSchema.safeParse(participant.role).success).toBe(true);
        expect(people.has(participant.userId)).toBe(true);
      }
    }
  });

  it('has unique session and participant ids', () => {
    const sessionIds = SAMPLE_CALL_SESSIONS.map((s) => s.id);
    const participantIds = SAMPLE_CALL_SESSIONS.flatMap((s) => s.participants.map((p) => p.id));
    expect(new Set(sessionIds).size).toBe(sessionIds.length);
    expect(new Set(participantIds).size).toBe(participantIds.length);
  });

  it('ended with the expert and the employee of the appointment as participants', () => {
    const session = consultations[0]!;
    const completed = byStatus('completed');
    expect(session.status).toBe('ended');
    expect(session.providerMeetingId).not.toBeNull();
    expect(session.startedAt).not.toBeNull();
    expect(session.endedAt).not.toBeNull();
    expect(Date.parse(session.endedAt!)).toBeGreaterThan(Date.parse(session.startedAt!));
    expect(session.participants.map((p) => [p.role, p.userId]).sort()).toEqual(
      [
        ['employee', completed.employeeUserId],
        ['expert', completed.expertUserId],
      ].sort(),
    );
  });

  it('carries a completed outcome recorded by the expert, with no free text', () => {
    const session = consultations[0]!;
    const outcome = session.outcome!;
    expect(CallOutcomeRequestSchema.safeParse({ status: outcome.status }).success).toBe(true);
    expect(outcome.status).toBe('completed');
    expect(outcome.recordedByUserId).toBe(byStatus('completed').expertUserId);
    expect(CallQualityMetricsSchema.safeParse(outcome.connectionMetrics).success).toBe(true);
    expect(Object.keys(outcome).sort()).toEqual(['connectionMetrics', 'id', 'recordedByUserId', 'status']);
  });

  it('carries the employee feedback: a score and a short comment that parse with the contract', () => {
    const session = consultations[0]!;
    expect(session.feedback).toHaveLength(1);
    const feedback = session.feedback[0]!;
    expect(feedback.userId).toBe(byStatus('completed').employeeUserId);
    expect(CallFeedbackRequestSchema.safeParse({ score: feedback.score, comment: feedback.comment }).success).toBe(
      true,
    );
    expect(feedback.comment).toMatch(/\(fixture\)$/);
  });
});
