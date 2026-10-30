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
  decodeProblemReportCursor,
  encodeProblemReportCursor,
  problemReportCategoryOf,
  problemReportEventName,
  type ProblemReportPageFilter,
  type ProblemReportPageRow,
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

/** The service with its queries replaced by an in-memory list. */
class TestProblemReportsService extends ProblemReportsService {
  readonly rows: ProblemReportRow[] = [];
  pageRows: ProblemReportPageRow[] = [];
  lastFilter: ProblemReportPageFilter | null = null;

  protected override async loadReportPage(filter: ProblemReportPageFilter): Promise<ProblemReportPageRow[]> {
    this.lastFilter = filter;
    return this.pageRows.slice(0, filter.limit);
  }

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

describe('ProblemReportsService.list (support queue, T-CW-1.5)', () => {
  let audit: { record: ReturnType<typeof vi.fn> };
  let service: TestProblemReportsService;

  const pageRow = (n: number, overrides: Partial<ProblemReportPageRow> = {}): ProblemReportPageRow => ({
    id: `cce_${n}`,
    sessionId: `session_${n}`,
    appointmentId: `appt_${n}`,
    eventName: 'problem_report:audio',
    createdAt: new Date(NOW.getTime() - n * 60_000),
    role: 'employee',
    durationMs: 600_000,
    metrics: { rtt: 200, packetLoss: 0.03, reconnectCount: 2 },
    browser: 'Chrome 130',
    os: 'macOS 15',
    ...overrides,
  });

  beforeEach(() => {
    audit = { record: vi.fn(async () => undefined) };
    service = new TestProblemReportsService(
      {} as CallsRepository,
      {} as DbService,
      {} as CallsService,
      audit as unknown as AuditWriter,
    );
  });

  it('lists ids, time, role, category and the rebuilt summary, newest first, with a next cursor', async () => {
    service.pageRows = [pageRow(1), pageRow(2, { eventName: 'problem_report:connection', role: 'expert', metrics: null }), pageRow(3)];

    const page = await service.list(principal('user_nikola'), { limit: 2 });

    expect(page.items).toEqual([
      {
        sessionId: 'session_1',
        appointmentId: 'appt_1',
        reportedAt: new Date(NOW.getTime() - 60_000).toISOString(),
        role: 'employee',
        category: 'audio',
        summary: { durationMs: 600_000, reconnectCount: 2, metrics: { rtt: 200, packetLoss: 0.03 }, browser: 'Chrome 130', os: 'macOS 15' },
      },
      {
        sessionId: 'session_2',
        appointmentId: 'appt_2',
        reportedAt: new Date(NOW.getTime() - 120_000).toISOString(),
        role: 'expert',
        category: 'connection',
        summary: { durationMs: 600_000, browser: 'Chrome 130', os: 'macOS 15' },
      },
    ]);
    expect(decodeProblemReportCursor(page.nextCursor!)).toEqual({ createdAt: pageRow(2).createdAt, id: 'cce_2' });
    // One more row than the page asks for tells whether there is a next page.
    expect(service.lastFilter).toMatchObject({ limit: 3 });

    const [event] = audit.record.mock.calls.map((call) => call[0] as AuditEventInput);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(event).toMatchObject({
      action: 'call.diagnostics.viewed',
      actorUserId: 'user_nikola',
      orgId: null,
      details: { viewedByUserId: 'user_nikola', reportCount: 2, sessionIds: ['session_1', 'session_2'] },
    });
  });

  it('passes the filters and the cursor through, and refuses a cursor it did not issue', async () => {
    const cursor = encodeProblemReportCursor({ createdAt: NOW, id: 'cce_9' });
    await service.list(principal('user_nikola'), {
      limit: 10,
      orgId: 'org_sample',
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-30T00:00:00.000Z',
      cursor,
    });
    expect(service.lastFilter).toEqual({
      limit: 11,
      orgId: 'org_sample',
      from: new Date('2026-11-01T00:00:00.000Z'),
      to: new Date('2026-11-30T00:00:00.000Z'),
      before: { createdAt: NOW, id: 'cce_9' },
    });

    const error = await service.list(principal('user_nikola'), { limit: 10, cursor: 'not-a-cursor' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiHttpException);
    expect((error as ApiHttpException).getStatus()).toBe(400);
  });
});
