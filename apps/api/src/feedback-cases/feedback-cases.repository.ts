/**
 * FeedbackCasesRepository: every Drizzle query of the feedback module.
 *
 * Tenant tables run inside `DbService.withOrgScope`, so the caller passes the
 * transaction; the escalation sweep reads overdue cases on the pool (system
 * context) and then handles each one in its organization's scope.
 *
 * `feedback_case_reporters` is read by exactly three methods, all named for
 * their restricted purpose: `findReporterUserId` (ownership check and the
 * reporter's notification) and `listCasesOfReporter` (the reporter's own
 * list). No method joins it to the case rows a handler path receives.
 */
import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, lt, max, sql } from 'drizzle-orm';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db/db.service.js';
import { assignments, feedbackCaseReporters, feedbackCases, feedbackMessages, feedbackRoutes } from '../db/schema/index.js';

export type RouteRow = typeof feedbackRoutes.$inferSelect;
export type NewRoute = typeof feedbackRoutes.$inferInsert;
export type CaseRow = typeof feedbackCases.$inferSelect;
export type NewCase = typeof feedbackCases.$inferInsert;
export type MessageRow = typeof feedbackMessages.$inferSelect;
export type NewMessage = typeof feedbackMessages.$inferInsert;

/** The CASE assignment reason through which a handler's `assigned_cases` grant reaches a case. */
export const FEEDBACK_ASSIGNMENT_REASON = 'feedback_case_handler';

/** Open states as the escalation sweep sees them. */
const OPEN_STATES = ['submitted', 'in_review', 'action_in_progress'] as const;

@Injectable()
export class FeedbackCasesRepository {
  constructor(private readonly dbs: DbService) {}

  private exec(tx?: DbExecutor): DbExecutor {
    return tx ?? this.dbs.db;
  }

  // ── Routes ──────────────────────────────────────────────────────────────

  async listRoutes(orgId: string, tx?: DbExecutor): Promise<RouteRow[]> {
    return this.exec(tx).select().from(feedbackRoutes).where(eq(feedbackRoutes.orgId, orgId)).orderBy(feedbackRoutes.kind);
  }

  async findRoute(id: string, tx?: DbExecutor): Promise<RouteRow | null> {
    const [row] = await this.exec(tx).select().from(feedbackRoutes).where(eq(feedbackRoutes.id, id));
    return row ?? null;
  }

  /** One route per kind and organization: an existing row is updated in place. */
  async upsertRoute(values: NewRoute, tx: DbExecutor): Promise<RouteRow> {
    const { id: _id, orgId: _orgId, kind: _kind, createdAt: _createdAt, ...set } = values;
    const [row] = await tx
      .insert(feedbackRoutes)
      .values(values)
      .onConflictDoUpdate({ target: [feedbackRoutes.orgId, feedbackRoutes.kind], set: { ...set, updatedAt: new Date() } })
      .returning();
    return row!;
  }

  // ── Cases ───────────────────────────────────────────────────────────────

  async insertCase(values: NewCase, tx: DbExecutor): Promise<CaseRow> {
    const [row] = await tx.insert(feedbackCases).values(values).returning();
    return row!;
  }

  async findCase(id: string, tx?: DbExecutor): Promise<CaseRow | null> {
    const [row] = await this.exec(tx).select().from(feedbackCases).where(eq(feedbackCases.id, id));
    return row ?? null;
  }

  /** The case locked `FOR UPDATE` until `tx` ends: concurrent replies and state changes run one after the other. */
  async lockCase(id: string, tx: DbExecutor): Promise<CaseRow | null> {
    const [row] = await tx.select().from(feedbackCases).where(eq(feedbackCases.id, id)).for('update');
    return row ?? null;
  }

  async updateCase(id: string, patch: Partial<NewCase>, tx: DbExecutor): Promise<CaseRow> {
    const [row] = await tx.update(feedbackCases).set(patch).where(eq(feedbackCases.id, id)).returning();
    return row!;
  }

  async listCasesByIds(ids: string[], tx?: DbExecutor): Promise<CaseRow[]> {
    if (ids.length === 0) return [];
    return this.exec(tx).select().from(feedbackCases).where(inArray(feedbackCases.id, ids)).orderBy(desc(feedbackCases.createdAt));
  }

  /** Open cases past their due target that were not escalated yet (system context). */
  async findOverdueOpenCases(now: Date, tx?: DbExecutor): Promise<CaseRow[]> {
    return this.exec(tx)
      .select()
      .from(feedbackCases)
      .where(and(inArray(feedbackCases.state, [...OPEN_STATES]), lt(feedbackCases.dueAt, now), isNull(feedbackCases.escalatedAt)))
      .orderBy(feedbackCases.dueAt);
  }

  // ── Reporter link (restricted) ──────────────────────────────────────────

  async insertReporter(values: { caseId: string; orgId: string; reporterUserId: string }, tx: DbExecutor): Promise<void> {
    await tx.insert(feedbackCaseReporters).values(values);
  }

  async findReporterUserId(caseId: string, tx?: DbExecutor): Promise<string | null> {
    const [row] = await this.exec(tx)
      .select({ reporterUserId: feedbackCaseReporters.reporterUserId })
      .from(feedbackCaseReporters)
      .where(eq(feedbackCaseReporters.caseId, caseId));
    return row?.reporterUserId ?? null;
  }

  async listCasesOfReporter(reporterUserId: string, orgId: string, tx?: DbExecutor): Promise<CaseRow[]> {
    const rows = await this.exec(tx)
      .select({ c: feedbackCases })
      .from(feedbackCaseReporters)
      .innerJoin(feedbackCases, eq(feedbackCases.id, feedbackCaseReporters.caseId))
      .where(and(eq(feedbackCaseReporters.reporterUserId, reporterUserId), eq(feedbackCaseReporters.orgId, orgId)))
      .orderBy(desc(feedbackCases.createdAt));
    return rows.map((r) => r.c);
  }

  // ── Messages ────────────────────────────────────────────────────────────

  async insertMessage(values: NewMessage, tx: DbExecutor): Promise<MessageRow> {
    const [row] = await tx.insert(feedbackMessages).values(values).returning();
    return row!;
  }

  async listMessages(caseId: string, opts: { includeInternal: boolean }, tx?: DbExecutor): Promise<MessageRow[]> {
    const where = opts.includeInternal
      ? eq(feedbackMessages.caseId, caseId)
      : and(eq(feedbackMessages.caseId, caseId), eq(feedbackMessages.internal, false));
    return this.exec(tx).select().from(feedbackMessages).where(where).orderBy(feedbackMessages.createdAt);
  }

  /** The instant of the last reporter-visible message per case. */
  async lastVisibleMessageAt(caseIds: string[], tx?: DbExecutor): Promise<Map<string, Date>> {
    if (caseIds.length === 0) return new Map();
    const rows = await this.exec(tx)
      .select({ caseId: feedbackMessages.caseId, at: max(feedbackMessages.createdAt) })
      .from(feedbackMessages)
      .where(and(inArray(feedbackMessages.caseId, caseIds), eq(feedbackMessages.internal, false)))
      .groupBy(feedbackMessages.caseId);
    return new Map(rows.filter((r) => r.at !== null).map((r) => [r.caseId, r.at as Date]));
  }

  // ── Assignments ─────────────────────────────────────────────────────────

  async insertAssignment(values: { userId: string; targetId: string; assignedByUserId: string; startAt: Date }, tx: DbExecutor): Promise<void> {
    await tx.insert(assignments).values({ ...values, kind: 'CASE', reason: FEEDBACK_ASSIGNMENT_REASON });
  }

  /** Ends the handler's open CASE assignments on the case at `at`. */
  async endAssignments(targetId: string, userId: string, at: Date, tx: DbExecutor): Promise<void> {
    await tx
      .update(assignments)
      .set({ endAt: at })
      .where(and(eq(assignments.targetId, targetId), eq(assignments.userId, userId), eq(assignments.kind, 'CASE'), isNull(assignments.endAt)));
  }

  /** Whether the user holds an open CASE assignment on the case (the handler path). */
  async hasOpenAssignment(targetId: string, userId: string, now: Date, tx?: DbExecutor): Promise<boolean> {
    const [row] = await this.exec(tx)
      .select({ n: sql<number>`count(*)::int` })
      .from(assignments)
      .where(
        and(
          eq(assignments.targetId, targetId),
          eq(assignments.userId, userId),
          eq(assignments.kind, 'CASE'),
          sql`${assignments.startAt} <= ${now}`,
          sql`(${assignments.endAt} is null or ${assignments.endAt} > ${now})`,
        ),
      );
    return (row?.n ?? 0) > 0;
  }
}
