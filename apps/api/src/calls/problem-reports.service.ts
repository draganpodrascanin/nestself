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
 * - Support queue: `GET /ops/calls/problem-reports` (T-CW-1.5) lists the
 *   reports newest first, across sessions, with the session and
 *   appointment ids, the time, the reporter's role, the category and the
 *   summary rebuilt from the row: no names. Each page is audited as
 *   `call.diagnostics.viewed` with the session ids it showed.
 * - Diagnostics: `GET /ops/calls/:sessionId/diagnostics` returns the
 *   session's DTO from `CallsService.diagnostics` (which audits the view)
 *   with `problemReports` filled: category, time and the reporter's role,
 *   nothing else (the strict contract schema enforces it).
 */
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, like, lt, or, type SQL } from 'drizzle-orm';
import {
  CallProblemCategorySchema,
  CallProblemSummarySchema,
  DiagnosticsResponseSchema,
  type CallParticipantRole,
  type CallProblemCategory,
  type CallProblemReportRequest,
  type CallQualityMetrics,
  type DiagnosticsProblemReport,
  type DiagnosticsResponse,
  type Principal,
  type ProblemReportListItem,
  type ProblemReportListQuery,
  type ProblemReportListResponse,
} from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter } from '../audit/audit-writer.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db/db.service.js';
import { callClientEvents, callParticipants, callSessions } from '../db/schema/index.js';
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

/** A row of the support queue, as `loadReportPage` reads it. */
export interface ProblemReportPageRow {
  id: string;
  sessionId: string;
  appointmentId: string | null;
  eventName: string;
  createdAt: Date;
  role: CallParticipantRole;
  durationMs: number | null;
  metrics: unknown;
  browser: string | null;
  os: string | null;
}

/** A position in the `(createdAt, id)` order, newest first: the last row of the previous page. */
export interface ProblemReportKey {
  createdAt: Date;
  id: string;
}

export interface ProblemReportPageFilter {
  limit: number;
  orgId?: string;
  from?: Date;
  to?: Date;
  /** Rows strictly older than this key. */
  before?: ProblemReportKey;
}

/** The opaque `nextCursor`: the key of a page's last row, base64url JSON. */
export function encodeProblemReportCursor(key: ProblemReportKey): string {
  return Buffer.from(JSON.stringify([key.createdAt.toISOString(), key.id])).toString('base64url');
}

/** The key inside a cursor, or null when it is not one this API issued. */
export function decodeProblemReportCursor(cursor: string): ProblemReportKey | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(value) || value.length !== 2) return null;
    const [createdAt, id] = value as unknown[];
    if (typeof createdAt !== 'string' || typeof id !== 'string' || id.length === 0) return null;
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime()) || date.toISOString() !== createdAt) return null;
    return { createdAt: date, id };
  } catch {
    return null;
  }
}

/** The CALL-16 summary as the report sent it: duration, reconnects, quality, browser and OS. */
function summaryOf(row: Pick<ProblemReportPageRow, 'durationMs' | 'metrics' | 'browser' | 'os'>) {
  const stored = (row.metrics ?? {}) as Record<string, unknown>;
  const metrics: Record<string, number> = {};
  for (const key of ['rtt', 'jitter', 'packetLoss', 'outgoingBitrate'] as const) {
    if (typeof stored[key] === 'number') metrics[key] = stored[key];
  }
  const summary = {
    ...(row.durationMs === null ? {} : { durationMs: row.durationMs }),
    ...(typeof stored.reconnectCount === 'number' ? { reconnectCount: stored.reconnectCount } : {}),
    ...(Object.keys(metrics).length > 0 ? { metrics } : {}),
    ...(row.browser ? { browser: row.browser } : {}),
    ...(row.os ? { os: row.os } : {}),
  };
  const parsed = CallProblemSummarySchema.safeParse(summary);
  return parsed.success ? parsed.data : {};
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

  /**
   * The support queue (T-CW-1.5): one page, newest first. The route has
   * authorized `diagnostic.read` at the platform level; the page is audited
   * as one `call.diagnostics.viewed` with the session ids it showed.
   */
  async list(principal: Principal, query: ProblemReportListQuery): Promise<ProblemReportListResponse> {
    const before = query.cursor ? decodeProblemReportCursor(query.cursor) : undefined;
    if (before === null) {
      throw new ApiHttpException({ status: 400, code: 'validation', message: 'The cursor is not valid', details: { field: 'cursor' } });
    }
    const rows = await this.loadReportPage({
      // One extra row tells whether there is a next page.
      limit: query.limit + 1,
      ...(query.orgId ? { orgId: query.orgId } : {}),
      ...(query.from ? { from: new Date(query.from) } : {}),
      ...(query.to ? { to: new Date(query.to) } : {}),
      ...(before ? { before } : {}),
    });
    const window = rows.slice(0, query.limit);
    const last = window[window.length - 1];
    const items: ProblemReportListItem[] = window.flatMap((row) => {
      const category = problemReportCategoryOf(row.eventName);
      if (!category) return [];
      return [
        {
          sessionId: row.sessionId,
          appointmentId: row.appointmentId,
          reportedAt: row.createdAt.toISOString(),
          role: row.role,
          category,
          summary: summaryOf(row),
        },
      ];
    });

    await this.audit.record({
      action: 'call.diagnostics.viewed',
      actorUserId: principal.userId,
      actorKind: 'USER',
      orgId: null,
      recordType: 'call_problem_reports',
      recordId: query.orgId ?? 'all',
      result: 'ALLOWED',
      details: {
        viewedByUserId: principal.userId,
        reportCount: items.length,
        sessionIds: [...new Set(items.map((item) => item.sessionId))],
      },
    });
    return {
      items,
      nextCursor: rows.length > query.limit && last ? encodeProblemReportCursor({ createdAt: last.createdAt, id: last.id }) : null,
    };
  }

  /**
   * The report rows of the queue, newest first, in system context: the page
   * spans organizations, and only a platform-level `diagnostic.read` reaches
   * it.
   */
  protected async loadReportPage(filter: ProblemReportPageFilter): Promise<ProblemReportPageRow[]> {
    const conditions: SQL[] = [like(callClientEvents.eventName, `${PROBLEM_REPORT_EVENT_PREFIX}%`)];
    if (filter.orgId) conditions.push(eq(callSessions.orgId, filter.orgId));
    if (filter.from) conditions.push(gte(callClientEvents.createdAt, filter.from));
    if (filter.to) conditions.push(lt(callClientEvents.createdAt, filter.to));
    if (filter.before) {
      conditions.push(
        or(
          lt(callClientEvents.createdAt, filter.before.createdAt),
          and(eq(callClientEvents.createdAt, filter.before.createdAt), lt(callClientEvents.id, filter.before.id)),
        )!,
      );
    }
    const rows = await this.dbs.db
      .select({
        id: callClientEvents.id,
        sessionId: callClientEvents.sessionId,
        appointmentId: callSessions.appointmentId,
        eventName: callClientEvents.eventName,
        createdAt: callClientEvents.createdAt,
        role: callParticipants.role,
        durationMs: callClientEvents.durationMs,
        metrics: callClientEvents.metrics,
        browser: callClientEvents.browser,
        os: callClientEvents.os,
      })
      .from(callClientEvents)
      .innerJoin(callSessions, eq(callSessions.id, callClientEvents.sessionId))
      .innerJoin(callParticipants, eq(callParticipants.id, callClientEvents.participantId))
      .where(and(...conditions))
      .orderBy(desc(callClientEvents.createdAt), desc(callClientEvents.id))
      .limit(filter.limit);
    return rows.map((row) => ({ ...row, role: fromDbParticipantRole(row.role) }));
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
