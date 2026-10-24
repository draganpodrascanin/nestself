/**
 * ProblemReportsService unit tests (CALL-16): the participant check, the
 * stored row (a `call_client_events` row of its own kind, no names, no free
 * text), the audit event, and the diagnostics listing within the D-CW-28
 * allowlist. The row store is replaced; the e2e suite runs it on PostgreSQL.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DIAGNOSTICS_PROBLEM_REPORT_FIELDS,
  DIAGNOSTICS_RESPONSE_FIELDS,
  type DiagnosticsResponse,
  type Principal,
} from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import type { AuditEventInput, AuditWriter } from '../audit/audit-writer.js';
import type { DbExecutor, DbService } from '../db/db.service.js';
import type { CallParticipantRecord, CallSessionRecord, CallsRepository } from './calls.repository.js';
import type { CallsService } from './calls.service.js';
import {
  PROBLEM_REPORT_EVENT_PREFIX,
  ProblemReportsService,
  problemReportCategoryOf,
  problemReportEventName,
  type ProblemReportRow,
  type StoredProblemReport,
} from './problem-reports.service.js';

const NOW = new Date('2026-11-10T15:40:00.000Z');
const ORG = 'org_sample';

const session = {
  id: 'session_1',
  appointmentId: 'appt_1',
  webinarId: null,
  orgId: ORG,
  format: 'consultation',
  providerMeetingId: 'meeting_1',
  status: 'ended',
  startsAt: NOW,
  endsAt: NOW,
  startedAt: NOW,
  endedAt: NOW,
  endReason: 'expert',
  locationText: null,
  createdAt: NOW,
  updatedAt: NOW,
} satisfies CallSessionRecord;

function participant(userId: string, role: 'expert' | 'employee'): CallParticipantRecord {
  return {
    id: `participant_${role}`,
    sessionId: session.id,
    orgId: ORG,
    userId,
    role,
    providerAttendeeId: null,
    firstJoinedAt: null,
    lastLeftAt: null,
    reconnectCount: 0,
    createdAt: NOW,
  };
}

const principal = (userId: string) => ({ userId }) as Principal;

/** The service with its two queries replaced by an in-memory list. */
class TestProblemReportsService extends ProblemReportsService {
  readonly rows: ProblemReportRow[] = [];

  protected override async storeReport(row: ProblemReportRow, _tx: DbExecutor | undefined): Promise<void> {
    this.rows.push(row);
  }

  protected override async loadReports(sessionId: string, _tx: DbExecutor | undefined): Promise<StoredProblemReport[]> {
    return this.rows
      .filter((row) => row.sessionId === sessionId)
      .map((row) => ({
        eventName: row.eventName,
        createdAt: NOW,
        role: row.participantId === 'participant_expert' ? 'expert' : 'employee',
      }));
  }
}

describe('problem report event names', () => {
  it('keeps reports apart from telemetry by their own event name', () => {
    expect(PROBLEM_REPORT_EVENT_PREFIX).toBe('problem_report:');
    expect(problemReportEventName('audio')).toBe('problem_report:audio');
    expect(problemReportCategoryOf('problem_report:connection')).toBe('connection');
    expect(problemReportCategoryOf('connectionStats')).toBeNull();
    expect(problemReportCategoryOf('problem_report:echo')).toBeNull();
  });
});

describe('ProblemReportsService', () => {
  let audit: { record: ReturnType<typeof vi.fn> };
  let calls: { diagnostics: ReturnType<typeof vi.fn> };
  let service: TestProblemReportsService;
  const participants = [participant('user_jovan', 'employee'), participant('user_milica', 'expert')];

  beforeEach(() => {
    audit = { record: vi.fn(async () => undefined) };
    const repo = {
      findSessionById: vi.fn(async (id: string) => (id === session.id ? { ...session } : null)),
      findParticipant: vi.fn(
        async (sessionId: string, userId: string) =>
          participants.find((p) => p.sessionId === sessionId && p.userId === userId) ?? null,
      ),
    };
    const base: Omit<DiagnosticsResponse, 'problemReports'> = {
      sessionId: session.id,
      appointmentId: 'appt_1',
      webinarId: null,
      startedAt: NOW.toISOString(),
      endedAt: NOW.toISOString(),
      status: 'ended',
      provider: 'none',
      providerMeetingId: 'meeting_1',
      participants: [],
    };
    calls = { diagnostics: vi.fn(async () => ({ ...base, problemReports: [] })) };
    const dbs = { withOrgScope: (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(undefined) };
    service = new TestProblemReportsService(
      repo as unknown as CallsRepository,
      dbs as unknown as DbService,
      calls as unknown as CallsService,
      audit as unknown as AuditWriter,
    );
  });

  async function expectNotFound(promise: Promise<unknown>) {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiHttpException);
    expect((error as ApiHttpException).getStatus()).toBe(404);
  }

  it('stores a participant report with its connection summary and audits the category only', async () => {
    await service.report(session.id, principal('user_jovan'), {
      category: 'audio',
      summary: {
        durationMs: 1_200_000,
        reconnectCount: 2,
        metrics: { rtt: 180, packetLoss: 0.05 },
        browser: 'Chrome 130',
        os: 'macOS 15',
      },
    });

    expect(service.rows).toEqual([
      {
        sessionId: session.id,
        orgId: ORG,
        participantId: 'participant_employee',
        eventName: 'problem_report:audio',
        durationMs: 1_200_000,
        metrics: { rtt: 180, packetLoss: 0.05, reconnectCount: 2 },
        deviceError: null,
        browser: 'Chrome 130',
        os: 'macOS 15',
      },
    ]);
    const [event] = audit.record.mock.calls.map((call) => call[0] as AuditEventInput);
    expect(event).toMatchObject({
      action: 'call.problem.reported',
      actorUserId: 'user_jovan',
      orgId: ORG,
      recordType: 'call_session',
      recordId: session.id,
      details: { sessionId: session.id, category: 'audio' },
    });
  });

  it('answers 404 to anyone who is not a participant of the session, and for an unknown session', async () => {
    await expectNotFound(service.report(session.id, principal('user_ivana'), { category: 'video', summary: {} }));
    await expectNotFound(service.report('session_missing', principal('user_jovan'), { category: 'video', summary: {} }));
    expect(service.rows).toEqual([]);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('adds the reports to the diagnostics, as category, time and role only', async () => {
    await service.report(session.id, principal('user_jovan'), { category: 'audio', summary: {} });
    await service.report(session.id, principal('user_milica'), { category: 'connection', summary: { reconnectCount: 4 } });

    const response = await service.diagnostics(session.id, principal('user_nikola'));

    expect(calls.diagnostics).toHaveBeenCalledWith(session.id, principal('user_nikola'));
    expect(Object.keys(response).sort()).toEqual([...DIAGNOSTICS_RESPONSE_FIELDS].sort());
    expect(response.problemReports).toEqual([
      { category: 'audio', reportedAt: NOW.toISOString(), role: 'employee' },
      { category: 'connection', reportedAt: NOW.toISOString(), role: 'expert' },
    ]);
    for (const report of response.problemReports) {
      expect(Object.keys(report).sort()).toEqual([...DIAGNOSTICS_PROBLEM_REPORT_FIELDS].sort());
    }
  });
});
