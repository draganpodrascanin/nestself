/**
 * The caller's state on an appointment (T-CW-1.5): join state, the pending
 * running-late signal, and the approval outcome shown to the employee only.
 */
import { describe, expect, it } from 'vitest';
import type { AppointmentResponse } from '@nestself/contracts';
import { withViewerState, type ViewerFacts } from './appointment-viewer.js';

const response = (overrides: Partial<AppointmentResponse> = {}): AppointmentResponse => ({
  id: 'appt_1',
  orgId: 'org_1',
  expertUserId: 'user_expert',
  employeeUserId: 'user_employee',
  startsAt: '2026-11-10T09:00:00.000Z',
  endsAt: '2026-11-10T09:50:00.000Z',
  status: 'declined',
  serviceCategory: 'psychological',
  timeZone: 'Europe/Belgrade',
  fundingRef: null,
  followUpOf: 'appt_0',
  ...overrides,
});

const facts = (overrides: Partial<ViewerFacts> = {}): ViewerFacts => ({
  joinedAppointmentIds: new Set(),
  endedAppointmentIds: new Set(),
  pendingSignals: new Map(),
  approvalOutcomes: new Map(),
  ...overrides,
});

describe('withViewerState', () => {
  const signal = { type: 'running_late' as const, etaMinutes: 10, sentAt: '2026-11-10T08:55:00.000Z' };
  const rejected = { outcome: 'rejected' as const, reason: 'The budget for this quarter is used.' };

  it('gives the employee the join state, the pending signal, the approval outcome and the reason', () => {
    const [out] = withViewerState('user_employee', [response()], facts({
      pendingSignals: new Map([['appt_1', signal]]),
      approvalOutcomes: new Map([['appt_1', rejected]]),
    }));
    expect(out).toEqual({
      ...response(),
      viewer: { hasJoined: false, sessionEnded: false, pendingSignal: signal },
      approvalOutcome: 'rejected',
      declineReason: 'The budget for this quarter is used.',
    });
  });

  it('gives the expert the join state and the signal, never the outcome or the reason', () => {
    const [out] = withViewerState('user_expert', [response()], facts({
      joinedAppointmentIds: new Set(['appt_1']),
      pendingSignals: new Map([['appt_1', signal]]),
      approvalOutcomes: new Map([['appt_1', rejected]]),
    }));
    expect(out).toEqual({ ...response(), viewer: { hasJoined: true, sessionEnded: false, pendingSignal: signal } });
    expect(out).not.toHaveProperty('approvalOutcome');
    expect(out).not.toHaveProperty('declineReason');
  });

  it('gives anyone else (operations) the bare join state only', () => {
    const [out] = withViewerState('user_ops', [response()], facts({
      pendingSignals: new Map([['appt_1', signal]]),
      approvalOutcomes: new Map([['appt_1', rejected]]),
    }));
    expect(out).toEqual({ ...response(), viewer: { hasJoined: false, sessionEnded: false } });
  });

  it('shows an expiry without a reason', () => {
    const [out] = withViewerState('user_employee', [response()], facts({
      approvalOutcomes: new Map([['appt_1', { outcome: 'expired' as const, reason: null }]]),
    }));
    expect(out).toEqual({ ...response(), viewer: { hasJoined: false, sessionEnded: false }, approvalOutcome: 'expired' });
  });
});

describe('withViewerState sessionEnded (T-CW-1.5)', () => {
  it('reports a session that is over for good', () => {
    const [ended] = withViewerState('user_employee', [response({ status: 'confirmed' })], {
      joinedAppointmentIds: new Set(['appt_1']),
      endedAppointmentIds: new Set(['appt_1']),
      pendingSignals: new Map(),
      approvalOutcomes: new Map(),
    });
    expect(ended!.viewer).toEqual({ hasJoined: true, sessionEnded: true });
  });
});
