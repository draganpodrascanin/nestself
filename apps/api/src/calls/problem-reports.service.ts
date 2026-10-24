/**
 * ProblemReportsService: a participant's "Report a technical problem"
 * (CALL-16, D-CW-13, D-CW-28).
 *
 * - `POST /calls/:sessionId/problem-report`: the expert or the employee of
 *   the session (a `call_participants` row; anyone else 404) sends a fixed
 *   category and the connection summary from the client's event log. It is
 *   stored as a `call_client_events` row of its own kind, `problem_report:`
 *   plus the category, so support tells it apart from telemetry and the
 *   telemetry aggregates (averages, failure codes, reconnects, outcome
 *   metadata) never count it. No free text, device label or name exists in
 *   the request (D-CW-04); `call.problem.reported` is audited with the
 *   session and the category only. Retention follows `call_client_events`
 *   (90 days).
 * - Diagnostics: `GET /ops/calls/:sessionId/diagnostics` returns the
 *   session's DTO from `CallsService.diagnostics` (which audits the view)
 *   with `problemReports` filled: category, time and the reporter's role,
 *   nothing else (the strict contract schema enforces it).
 */
import { Injectable } from '@nestjs/common';
import { and, asc, eq, like } from 'drizzle-orm';
import {
  CallProblemCategorySchema,
  DiagnosticsResponseSchema,
  type CallParticipantRole,
  type CallProblemCategory,
  type CallProblemReportRequest,
  type CallQualityMetrics,
  type DiagnosticsProblemReport,
  type DiagnosticsResponse,
  type Principal,
} from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter } from '../audit/audit-writer.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db/db.service.js';
import { callClientEvents, callParticipants } from '../db/schema/index.js';
import { fromDbParticipantRole } from './call-mapper.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { CallsRepository } from './calls.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { CallsService } from './calls.service.js';

/** `call_client_events.event_name` of a problem report: this prefix and the category. */
export const PROBLEM_REPORT_EVENT_PREFIX = 'problem_report:';

export function problemReportEventName(category: CallProblemCategory): string {
  return `${PROBLEM_REPORT_EVENT_PREFIX}${category}`;
}

/** The category of a problem report row; null for telemetry and anything unknown. */
export function problemReportCategoryOf(eventName: string): CallProblemCategory | null {
  if (!eventName.startsWith(PROBLEM_REPORT_EVENT_PREFIX)) return null;
  const parsed = CallProblemCategorySchema.safeParse(eventName.slice(PROBLEM_REPORT_EVENT_PREFIX.length));
  return parsed.success ? parsed.data : null;
}

/** The `call_client_events` row of one report. */
export interface ProblemReportRow {
  sessionId: string;
  orgId: string | null;
  participantId: string;
  eventName: string;
  durationMs: number | null;
  /** The average quality and the reconnect count. */
  metrics: (CallQualityMetrics & { reconnectCount?: number }) | null;
  deviceError: null;
  browser: string | null;
  os: string | null;
}

/** A stored report as the diagnostics listing reads it. */
export interface StoredProblemReport {
  eventName: string;
  createdAt: Date;
  role: CallParticipantRole;
}

function notFound(): ApiHttpException {
  return new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
}

@Injectable()
export class ProblemReportsService {
  constructor(
    private readonly repo: CallsRepository,
    private readonly dbs: DbService,
    private readonly calls: CallsService,
    private readonly audit: AuditWriter,
  ) {}

  async report(sessionId: string, principal: Principal, body: CallProblemReportRequest): Promise<void> {
    const session = await this.repo.findSessionById(sessionId);
    if (!session) throw notFound();
    const participant = await this.scoped(session.orgId, (tx) =>
      this.repo.findParticipant(session.id, principal.userId, tx),
    );
    if (!participant) throw notFound();

    const { summary } = body;
    const metrics = { ...summary.metrics, ...(summary.reconnectCount === undefined ? {} : { reconnectCount: summary.reconnectCount }) };
    await this.scoped(session.orgId, (tx) =>
      this.storeReport(
        {
          sessionId: session.id,
          orgId: session.orgId,
          participantId: participant.id,
          eventName: problemReportEventName(body.category),
          durationMs: summary.durationMs ?? null,
          metrics: Object.keys(metrics).length > 0 ? metrics : null,
          deviceError: null,
          browser: summary.browser ?? null,
          os: summary.os ?? null,
        },
        tx,
      ),
    );

    await this.audit.record({
      action: 'call.problem.reported',
      actorUserId: principal.userId,
      actorKind: 'USER',
      orgId: session.orgId,
      recordType: 'call_session',
      recordId: session.id,
      result: 'ALLOWED',
      details: { sessionId: session.id, category: body.category },
    });
  }

  /** The session's diagnostics with its problem reports, oldest first (D-CW-28 allowlist). */
  async diagnostics(sessionId: string, principal: Principal): Promise<DiagnosticsResponse> {
    const base = await this.calls.diagnostics(sessionId, principal);
    const session = await this.repo.findSessionById(sessionId);
    const stored = session ? await this.scoped(session.orgId, (tx) => this.loadReports(session.id, tx)) : [];
    const problemReports: DiagnosticsProblemReport[] = stored.flatMap((report) => {
      const category = problemReportCategoryOf(report.eventName);
      return category ? [{ category, reportedAt: report.createdAt.toISOString(), role: report.role }] : [];
    });
    return DiagnosticsResponseSchema.parse({ ...base, problemReports });
  }

  /** Inserts the report row. */
  protected async storeReport(row: ProblemReportRow, tx: DbExecutor | undefined): Promise<void> {
    await (tx ?? this.dbs.db).insert(callClientEvents).values(row);
  }

  /** The session's report rows with the reporter's role, oldest first. */
  protected async loadReports(sessionId: string, tx: DbExecutor | undefined): Promise<StoredProblemReport[]> {
    const rows = await (tx ?? this.dbs.db)
      .select({ eventName: callClientEvents.eventName, createdAt: callClientEvents.createdAt, role: callParticipants.role })
      .from(callClientEvents)
      .innerJoin(callParticipants, eq(callParticipants.id, callClientEvents.participantId))
      .where(
        and(
          eq(callClientEvents.sessionId, sessionId),
          like(callClientEvents.eventName, `${PROBLEM_REPORT_EVENT_PREFIX}%`),
        ),
      )
      .orderBy(asc(callClientEvents.createdAt), asc(callClientEvents.id));
    return rows.map((row) => ({ eventName: row.eventName, createdAt: row.createdAt, role: fromDbParticipantRole(row.role) }));
  }

  /** The organization's RLS scope; system context for a session without one. */
  private scoped<T>(orgId: string | null, fn: (tx: DbExecutor | undefined) => Promise<T>): Promise<T> {
    return orgId ? this.dbs.withOrgScope(orgId, fn) : fn(undefined);
  }
}
