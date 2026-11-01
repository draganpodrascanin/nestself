/**
 * WorkplaceReviewsRepository: every Drizzle query of the workplace reviews
 * module (ADR 0002). Tenant tables run inside `DbService.withOrgScope`, so
 * the caller passes the transaction; `review_services` is platform data. The
 * repository also answers the listening module's "is there active work for
 * this scope" question (`ActiveReviewLookup`) and binds the resource
 * resolvers of the engagement and scope routes.
 */
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lt, max, or, sql } from 'drizzle-orm';
import { ACTIVE_REVIEW_ENGAGEMENT_STATUSES, ACTIVE_REVIEW_REQUEST_STATUSES } from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db/db.service.js';
import {
  appointments,
  assignments,
  expertCredentials,
  experts,
  improvementActions,
  reviewEngagementNotes,
  reviewEngagements,
  reviewReportVersions,
  reviewRequests,
  reviewScopes,
  reviewServices,
  reviewSharingGrants,
  users,
} from '../db/schema/index.js';
import type { ActiveReviewLookup } from '../listening/review-offer.service.js';

export type ServiceRow = typeof reviewServices.$inferSelect;
export type RequestRow = typeof reviewRequests.$inferSelect;
export type NewRequest = typeof reviewRequests.$inferInsert;
export type ScopeRow = typeof reviewScopes.$inferSelect;
export type NewScope = typeof reviewScopes.$inferInsert;
export type EngagementRow = typeof reviewEngagements.$inferSelect;
export type NewEngagement = typeof reviewEngagements.$inferInsert;
export type SharingGrantRow = typeof reviewSharingGrants.$inferSelect;
export type NewSharingGrant = typeof reviewSharingGrants.$inferInsert;
export type ReportVersionRow = typeof reviewReportVersions.$inferSelect;
export type NewReportVersion = typeof reviewReportVersions.$inferInsert;
export type NoteRow = typeof reviewEngagementNotes.$inferSelect;
export type ActionRow = typeof improvementActions.$inferSelect;
export type NewAction = typeof improvementActions.$inferInsert;

/** The CASE assignment reason through which a reviewer's `assigned_cases` grant reaches an engagement (D-EL-11). */
export const REVIEWER_ASSIGNMENT_REASON = 'workplace_reviewer';

/** Appointment statuses that hold the reviewer's time (D-EL-03). */
const HOLDING_APPOINTMENT_STATUSES = ['PROPOSED', 'AWAITING_APPROVAL', 'CONFIRMED'] as const;

@Injectable()
export class WorkplaceReviewsRepository implements ActiveReviewLookup {
  constructor(private readonly dbs: DbService) {}

  private exec(tx?: DbExecutor): DbExecutor {
    return tx ?? this.dbs.db;
  }

  // ── Services (platform) ─────────────────────────────────────────────────

  async listServices(tx?: DbExecutor): Promise<ServiceRow[]> {
    return this.exec(tx).select().from(reviewServices).where(eq(reviewServices.isActive, true)).orderBy(asc(reviewServices.introductory), asc(reviewServices.key));
  }

  async findService(id: string, tx?: DbExecutor): Promise<ServiceRow | null> {
    const [row] = await this.exec(tx).select().from(reviewServices).where(eq(reviewServices.id, id));
    return row ?? null;
  }

  // ── Requests ────────────────────────────────────────────────────────────

  async insertRequest(values: NewRequest, tx: DbExecutor): Promise<RequestRow> {
    const [row] = await tx.insert(reviewRequests).values(values).returning();
    return row!;
  }

  async findRequest(id: string, tx?: DbExecutor): Promise<RequestRow | null> {
    const [row] = await this.exec(tx).select().from(reviewRequests).where(eq(reviewRequests.id, id));
    return row ?? null;
  }

  async lockRequest(id: string, tx: DbExecutor): Promise<RequestRow | null> {
    const [row] = await tx.select().from(reviewRequests).where(eq(reviewRequests.id, id)).for('update');
    return row ?? null;
  }

  async updateRequest(id: string, patch: Partial<NewRequest>, tx: DbExecutor): Promise<RequestRow> {
    const [row] = await tx.update(reviewRequests).set(patch).where(eq(reviewRequests.id, id)).returning();
    return row!;
  }

  async listRequests(orgId: string, tx?: DbExecutor): Promise<RequestRow[]> {
    return this.exec(tx).select().from(reviewRequests).where(eq(reviewRequests.orgId, orgId)).orderBy(desc(reviewRequests.createdAt));
  }

  /** The active request of a reporting scope, if any (one at a time, spec REV-02). */
  async findActiveRequest(orgId: string, scopeCohortKey: string, tx?: DbExecutor): Promise<RequestRow | null> {
    const [row] = await this.exec(tx)
      .select()
      .from(reviewRequests)
      .where(
        and(eq(reviewRequests.orgId, orgId), eq(reviewRequests.scopeCohortKey, scopeCohortKey), inArray(reviewRequests.status, [...ACTIVE_REVIEW_REQUEST_STATUSES])),
      )
      .limit(1);
    return row ?? null;
  }

  /** The coordinator's queue (system context): open requests across organizations, oldest first. */
  async listQueue(tx?: DbExecutor): Promise<RequestRow[]> {
    return this.exec(tx)
      .select()
      .from(reviewRequests)
      .where(inArray(reviewRequests.status, [...ACTIVE_REVIEW_REQUEST_STATUSES, 'converted']))
      .orderBy(asc(reviewRequests.createdAt))
      .limit(200);
  }

  // ── Scopes ──────────────────────────────────────────────────────────────

  async listScopes(requestId: string, tx?: DbExecutor): Promise<ScopeRow[]> {
    return this.exec(tx).select().from(reviewScopes).where(eq(reviewScopes.requestId, requestId)).orderBy(asc(reviewScopes.version));
  }

  async listScopesOfRequests(requestIds: string[], tx?: DbExecutor): Promise<ScopeRow[]> {
    if (requestIds.length === 0) return [];
    return this.exec(tx).select().from(reviewScopes).where(inArray(reviewScopes.requestId, requestIds)).orderBy(asc(reviewScopes.version));
  }

  async findScope(id: string, tx?: DbExecutor): Promise<ScopeRow | null> {
    const [row] = await this.exec(tx).select().from(reviewScopes).where(eq(reviewScopes.id, id));
    return row ?? null;
  }

  async lockScope(id: string, tx: DbExecutor): Promise<ScopeRow | null> {
    const [row] = await tx.select().from(reviewScopes).where(eq(reviewScopes.id, id)).for('update');
    return row ?? null;
  }

  async nextScopeVersion(requestId: string, tx: DbExecutor): Promise<number> {
    const [row] = await tx.select({ v: max(reviewScopes.version) }).from(reviewScopes).where(eq(reviewScopes.requestId, requestId));
    return (row?.v ?? 0) + 1;
  }

  async insertScope(values: NewScope, tx: DbExecutor): Promise<ScopeRow> {
    const [row] = await tx.insert(reviewScopes).values(values).returning();
    return row!;
  }

  async updateScope(id: string, patch: Partial<NewScope>, tx: DbExecutor): Promise<ScopeRow> {
    const [row] = await tx.update(reviewScopes).set(patch).where(eq(reviewScopes.id, id)).returning();
    return row!;
  }

  /** Earlier sent scopes of the request give way to a new one. */
  async supersedeSentScopes(requestId: string, exceptId: string, tx: DbExecutor): Promise<void> {
    await tx
      .update(reviewScopes)
      .set({ status: 'superseded' })
      .where(and(eq(reviewScopes.requestId, requestId), eq(reviewScopes.status, 'sent'), sql`${reviewScopes.id} <> ${exceptId}`));
  }

  // ── Engagements ─────────────────────────────────────────────────────────

  async insertEngagement(values: NewEngagement, tx: DbExecutor): Promise<EngagementRow> {
    const [row] = await tx.insert(reviewEngagements).values(values).returning();
    return row!;
  }

  async findEngagement(id: string, tx?: DbExecutor): Promise<EngagementRow | null> {
    const [row] = await this.exec(tx).select().from(reviewEngagements).where(eq(reviewEngagements.id, id));
    return row ?? null;
  }

  async findEngagementByRequest(requestId: string, tx?: DbExecutor): Promise<EngagementRow | null> {
    const [row] = await this.exec(tx).select().from(reviewEngagements).where(eq(reviewEngagements.requestId, requestId));
    return row ?? null;
  }

  async lockEngagement(id: string, tx: DbExecutor): Promise<EngagementRow | null> {
    const [row] = await tx.select().from(reviewEngagements).where(eq(reviewEngagements.id, id)).for('update');
    return row ?? null;
  }

  async updateEngagement(id: string, patch: Partial<NewEngagement>, tx: DbExecutor): Promise<EngagementRow> {
    const [row] = await tx.update(reviewEngagements).set(patch).where(eq(reviewEngagements.id, id)).returning();
    return row!;
  }

  async listEngagements(orgId: string, tx?: DbExecutor): Promise<EngagementRow[]> {
    return this.exec(tx).select().from(reviewEngagements).where(eq(reviewEngagements.orgId, orgId)).orderBy(desc(reviewEngagements.createdAt));
  }

  async listEngagementsByIds(ids: string[], tx?: DbExecutor): Promise<EngagementRow[]> {
    if (ids.length === 0) return [];
    return this.exec(tx).select().from(reviewEngagements).where(inArray(reviewEngagements.id, ids)).orderBy(desc(reviewEngagements.createdAt));
  }

  /** The active request or engagement of a scope, for the review offer (spec 4.5). */
  async findActive(orgId: string, cohortKey: string): Promise<{ requestId: string | null; engagementId: string | null }> {
    const request = await this.findActiveRequest(orgId, cohortKey);
    if (request) return { requestId: request.id, engagementId: null };
    const [engagement] = await this.dbs.db
      .select({ id: reviewEngagements.id })
      .from(reviewEngagements)
      .innerJoin(reviewRequests, eq(reviewRequests.id, reviewEngagements.requestId))
      .where(
        and(
          eq(reviewEngagements.orgId, orgId),
          eq(reviewRequests.scopeCohortKey, cohortKey),
          inArray(reviewEngagements.status, [...ACTIVE_REVIEW_ENGAGEMENT_STATUSES]),
        ),
      )
      .limit(1);
    return { requestId: null, engagementId: engagement?.id ?? null };
  }

  // ── Reviewers and booking (D-EL-03, D-EL-11) ────────────────────────────

  /** Experts holding an APPROVED `workplace_review` credential, by name. */
  async reviewerCandidates(q: string | undefined, limit: number, tx?: DbExecutor): Promise<Array<{ userId: string; displayName: string }>> {
    const rows = await this.exec(tx)
      .selectDistinct({ userId: users.id, displayName: users.displayName })
      .from(experts)
      .innerJoin(users, eq(users.id, experts.userId))
      .innerJoin(expertCredentials, eq(expertCredentials.expertId, experts.id))
      .where(
        and(
          eq(expertCredentials.serviceCategory, 'workplace_review'),
          eq(expertCredentials.status, 'APPROVED'),
          isNull(users.suspendedAt),
          q ? sql`${users.displayName} ilike ${`%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`}` : sql`true`,
        ),
      )
      .orderBy(asc(users.displayName), asc(users.id))
      .limit(limit);
    return rows;
  }

  /** Whether the user holds an APPROVED `workplace_review` credential (D-EL-11). */
  async hasReviewerCredential(userId: string, tx?: DbExecutor): Promise<boolean> {
    const [row] = await this.exec(tx)
      .select({ n: sql<number>`count(*)::int` })
      .from(expertCredentials)
      .innerJoin(experts, eq(experts.id, expertCredentials.expertId))
      .where(and(eq(experts.userId, userId), eq(expertCredentials.serviceCategory, 'workplace_review'), eq(expertCredentials.status, 'APPROVED')));
    return (row?.n ?? 0) > 0;
  }

  /** Takes the reviewer's booking lock for the rest of `tx`: two confirmations cannot both pass the overlap check. */
  async lockReviewerCalendar(reviewerUserId: string, tx: DbExecutor): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`review_booking:${reviewerUserId}`}))`);
  }

  /** Whether any appointment that holds the reviewer's time overlaps the window (system context: across organizations). */
  async reviewerBusy(reviewerUserId: string, startsAt: Date, endsAt: Date, tx: DbExecutor): Promise<boolean> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(appointments)
      .where(
        and(
          eq(appointments.expertUserId, reviewerUserId),
          inArray(appointments.status, [...HOLDING_APPOINTMENT_STATUSES]),
          lt(appointments.startsAt, endsAt),
          sql`${appointments.endsAt} > ${startsAt}`,
        ),
      );
    return (row?.n ?? 0) > 0;
  }

  async insertReviewerAssignment(values: { userId: string; targetId: string; assignedByUserId: string; startAt: Date }, tx: DbExecutor): Promise<void> {
    await tx.insert(assignments).values({ ...values, kind: 'CASE', reason: REVIEWER_ASSIGNMENT_REASON });
  }

  async endReviewerAssignments(targetId: string, at: Date, tx: DbExecutor): Promise<void> {
    await tx
      .update(assignments)
      .set({ endAt: at })
      .where(and(eq(assignments.targetId, targetId), eq(assignments.kind, 'CASE'), eq(assignments.reason, REVIEWER_ASSIGNMENT_REASON), isNull(assignments.endAt)));
  }

  // ── Sharing grants (REV-04) ─────────────────────────────────────────────

  async insertSharingGrant(values: NewSharingGrant, tx: DbExecutor): Promise<SharingGrantRow> {
    const [row] = await tx.insert(reviewSharingGrants).values(values).returning();
    return row!;
  }

  async listSharingGrants(engagementId: string, tx?: DbExecutor): Promise<SharingGrantRow[]> {
    return this.exec(tx).select().from(reviewSharingGrants).where(eq(reviewSharingGrants.engagementId, engagementId)).orderBy(asc(reviewSharingGrants.createdAt));
  }

  async findSharingGrant(id: string, tx?: DbExecutor): Promise<SharingGrantRow | null> {
    const [row] = await this.exec(tx).select().from(reviewSharingGrants).where(eq(reviewSharingGrants.id, id));
    return row ?? null;
  }

  async revokeSharingGrant(id: string, byUserId: string, at: Date, tx: DbExecutor): Promise<SharingGrantRow> {
    const [row] = await tx.update(reviewSharingGrants).set({ revokedAt: at, revokedByUserId: byUserId }).where(eq(reviewSharingGrants.id, id)).returning();
    return row!;
  }

  // ── Report versions (REV-07) ────────────────────────────────────────────

  async listReportVersions(engagementId: string, tx?: DbExecutor): Promise<ReportVersionRow[]> {
    return this.exec(tx).select().from(reviewReportVersions).where(eq(reviewReportVersions.engagementId, engagementId)).orderBy(asc(reviewReportVersions.version));
  }

  async findReportVersion(id: string, tx?: DbExecutor): Promise<ReportVersionRow | null> {
    const [row] = await this.exec(tx).select().from(reviewReportVersions).where(eq(reviewReportVersions.id, id));
    return row ?? null;
  }

  async insertReportVersion(values: NewReportVersion, tx: DbExecutor): Promise<ReportVersionRow> {
    const [row] = await tx.insert(reviewReportVersions).values(values).returning();
    return row!;
  }

  async updateReportVersion(id: string, patch: Partial<NewReportVersion>, tx: DbExecutor): Promise<ReportVersionRow> {
    const [row] = await tx.update(reviewReportVersions).set(patch).where(eq(reviewReportVersions.id, id)).returning();
    return row!;
  }

  // ── Notes and actions (REV-07, REV-08) ──────────────────────────────────

  async insertNote(values: { orgId: string; engagementId: string; authorUserId: string; body: string }, tx: DbExecutor): Promise<NoteRow> {
    const [row] = await tx.insert(reviewEngagementNotes).values(values).returning();
    return row!;
  }

  async listNotes(engagementId: string, authorUserId: string, tx?: DbExecutor): Promise<NoteRow[]> {
    return this.exec(tx)
      .select()
      .from(reviewEngagementNotes)
      .where(and(eq(reviewEngagementNotes.engagementId, engagementId), eq(reviewEngagementNotes.authorUserId, authorUserId)))
      .orderBy(asc(reviewEngagementNotes.createdAt));
  }

  async insertAction(values: NewAction, tx: DbExecutor): Promise<ActionRow> {
    const [row] = await tx.insert(improvementActions).values(values).returning();
    return row!;
  }

  async listActions(engagementId: string, tx?: DbExecutor): Promise<ActionRow[]> {
    return this.exec(tx).select().from(improvementActions).where(eq(improvementActions.engagementId, engagementId)).orderBy(asc(improvementActions.createdAt));
  }

  async lockAction(id: string, tx: DbExecutor): Promise<ActionRow | null> {
    const [row] = await tx.select().from(improvementActions).where(eq(improvementActions.id, id)).for('update');
    return row ?? null;
  }

  async updateAction(id: string, patch: Partial<NewAction>, tx: DbExecutor): Promise<ActionRow> {
    const [row] = await tx.update(improvementActions).set(patch).where(eq(improvementActions.id, id)).returning();
    return row!;
  }

  // ── Names ───────────────────────────────────────────────────────────────

  /** Display names by user id (first names leave the module, see `firstNameOf`). */
  async displayNames(userIds: readonly (string | null | undefined)[], tx?: DbExecutor): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter((id): id is string => !!id))];
    if (ids.length === 0) return new Map();
    const rows = await this.exec(tx).select({ id: users.id, displayName: users.displayName }).from(users).where(or(...ids.map((id) => eq(users.id, id))));
    return new Map(rows.map((r) => [r.id, r.displayName]));
  }
}
