/**
 * ListeningRepository: every Drizzle query of the listening module (ADR 0002).
 *
 * Reads and writes of tenant tables run inside `DbService.withOrgScope`, so
 * the caller passes the transaction; questionnaire versions are platform data
 * and run on the pool or in a plain transaction. Repositories hold query
 * builders only; the services decide what may leave them.
 *
 * Restricted tables (`survey_participations`, `survey_responses`,
 * `survey_drafts`) are read by the participation, finalization and purge
 * paths only; no method here returns participation rows with user ids to an
 * employer-facing service.
 */
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, max, ne, sql } from 'drizzle-orm';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor, type Transaction } from '../db/db.service.js';
import {
  listeningConfigurations,
  listeningPolicyVersions,
  memberships,
  orgUnits,
  questionnaireVersions,
  surveyAggregateCells,
  surveyCycles,
  surveyDrafts,
  surveyOfferDismissals,
  surveyParticipations,
  surveyResponses,
  surveySnapshots,
  users,
} from '../db/schema/index.js';

export type ConfigurationRow = typeof listeningConfigurations.$inferSelect;
export type NewConfiguration = typeof listeningConfigurations.$inferInsert;
export type PolicyVersionRow = typeof listeningPolicyVersions.$inferSelect;
export type NewPolicyVersion = typeof listeningPolicyVersions.$inferInsert;
export type QuestionnaireRow = typeof questionnaireVersions.$inferSelect;
export type NewQuestionnaire = typeof questionnaireVersions.$inferInsert;
export type CycleRow = typeof surveyCycles.$inferSelect;
export type NewCycle = typeof surveyCycles.$inferInsert;
export type ParticipationRow = typeof surveyParticipations.$inferSelect;
export type NewParticipation = typeof surveyParticipations.$inferInsert;
export type DraftRow = typeof surveyDrafts.$inferSelect;
export type ResponseRow = typeof surveyResponses.$inferSelect;
export type NewResponse = typeof surveyResponses.$inferInsert;
export type SnapshotRow = typeof surveySnapshots.$inferSelect;
export type NewSnapshot = typeof surveySnapshots.$inferInsert;
export type CellRow = typeof surveyAggregateCells.$inferSelect;
export type NewCell = typeof surveyAggregateCells.$inferInsert;
export type CycleStatus = CycleRow['status'];

/** A member of the launch audience: the active membership and its org unit. */
export interface AudienceMember {
  membershipId: string;
  userId: string;
  orgUnitId: string | null;
}

/** An org unit as the audience snapshot needs it: id, parent and kind. */
export interface UnitNode {
  id: string;
  parentId: string | null;
  kind: 'COMPANY' | 'DEPARTMENT' | 'TEAM';
  name: string;
}

@Injectable()
export class ListeningRepository {
  constructor(private readonly dbs: DbService) {}

  private exec(tx?: DbExecutor): DbExecutor {
    return tx ?? this.dbs.db;
  }

  // ── Configuration and policy versions ────────────────────────────────────

  async findConfiguration(orgId: string, tx?: DbExecutor): Promise<ConfigurationRow | null> {
    const [row] = await this.exec(tx).select().from(listeningConfigurations).where(eq(listeningConfigurations.orgId, orgId));
    return row ?? null;
  }

  async insertConfiguration(values: NewConfiguration, tx: DbExecutor): Promise<ConfigurationRow> {
    const [row] = await tx.insert(listeningConfigurations).values(values).returning();
    return row!;
  }

  async updateConfiguration(
    orgId: string,
    patch: Partial<NewConfiguration>,
    tx: DbExecutor,
  ): Promise<ConfigurationRow | null> {
    const [row] = await tx
      .update(listeningConfigurations)
      .set(patch)
      .where(eq(listeningConfigurations.orgId, orgId))
      .returning();
    return row ?? null;
  }

  /** Configurations whose recurring launch is due (system context, the job). */
  async findConfigurationsWithLaunchDue(now: Date, tx?: DbExecutor): Promise<ConfigurationRow[]> {
    return this.exec(tx)
      .select()
      .from(listeningConfigurations)
      .where(lte(listeningConfigurations.nextLaunchAt, now));
  }

  async insertPolicyVersion(values: NewPolicyVersion, tx: DbExecutor): Promise<PolicyVersionRow> {
    const [row] = await tx.insert(listeningPolicyVersions).values(values).returning();
    return row!;
  }

  async findPolicyVersion(id: string, tx?: DbExecutor): Promise<PolicyVersionRow | null> {
    const [row] = await this.exec(tx).select().from(listeningPolicyVersions).where(eq(listeningPolicyVersions.id, id));
    return row ?? null;
  }

  /** The policy version in force: the latest row of the organization. */
  async findCurrentPolicyVersion(orgId: string, tx?: DbExecutor): Promise<PolicyVersionRow | null> {
    const [row] = await this.exec(tx)
      .select()
      .from(listeningPolicyVersions)
      .where(eq(listeningPolicyVersions.orgId, orgId))
      .orderBy(desc(listeningPolicyVersions.policyVersion))
      .limit(1);
    return row ?? null;
  }

  // ── Questionnaire versions (platform data) ───────────────────────────────

  async listQuestionnaires(tx?: DbExecutor): Promise<QuestionnaireRow[]> {
    return this.exec(tx).select().from(questionnaireVersions).orderBy(desc(questionnaireVersions.version));
  }

  async findQuestionnaire(id: string, tx?: DbExecutor): Promise<QuestionnaireRow | null> {
    const [row] = await this.exec(tx).select().from(questionnaireVersions).where(eq(questionnaireVersions.id, id));
    return row ?? null;
  }

  async findQuestionnaires(ids: string[], tx?: DbExecutor): Promise<QuestionnaireRow[]> {
    if (ids.length === 0) return [];
    return this.exec(tx).select().from(questionnaireVersions).where(inArray(questionnaireVersions.id, ids));
  }

  async maxQuestionnaireVersion(tx?: DbExecutor): Promise<number> {
    const [row] = await this.exec(tx).select({ value: max(questionnaireVersions.version) }).from(questionnaireVersions);
    return row?.value ?? 0;
  }

  async insertQuestionnaire(values: NewQuestionnaire, tx: DbExecutor): Promise<QuestionnaireRow> {
    const [row] = await tx.insert(questionnaireVersions).values(values).returning();
    return row!;
  }

  async updateQuestionnaire(
    id: string,
    patch: Partial<NewQuestionnaire>,
    tx: DbExecutor,
  ): Promise<QuestionnaireRow | null> {
    const [row] = await tx.update(questionnaireVersions).set(patch).where(eq(questionnaireVersions.id, id)).returning();
    return row ?? null;
  }

  async countCyclesUsingQuestionnaire(id: string, tx?: DbExecutor): Promise<number> {
    const [row] = await this.exec(tx)
      .select({ n: sql<number>`count(*)::int` })
      .from(surveyCycles)
      .where(eq(surveyCycles.questionnaireVersionId, id));
    return row?.n ?? 0;
  }

  // ── Cycles ───────────────────────────────────────────────────────────────

  async listCycles(orgId: string, tx?: DbExecutor): Promise<CycleRow[]> {
    return this.exec(tx).select().from(surveyCycles).where(eq(surveyCycles.orgId, orgId)).orderBy(desc(surveyCycles.opensAt));
  }

  async findCycle(id: string, tx?: DbExecutor): Promise<CycleRow | null> {
    const [row] = await this.exec(tx).select().from(surveyCycles).where(eq(surveyCycles.id, id));
    return row ?? null;
  }

  /** The cycle row locked for the transaction: `FOR UPDATE` (finalizer, launch, cancel) or `FOR SHARE` (submissions). */
  async lockCycle(id: string, mode: 'update' | 'share', tx: Transaction): Promise<CycleRow | null> {
    const query = tx.select().from(surveyCycles).where(eq(surveyCycles.id, id));
    const [row] = mode === 'update' ? await query.for('update') : await query.for('share');
    return row ?? null;
  }

  /** The one `open` cycle of an organization, if any. */
  async findOpenCycle(orgId: string, tx?: DbExecutor): Promise<CycleRow | null> {
    const [row] = await this.exec(tx)
      .select()
      .from(surveyCycles)
      .where(and(eq(surveyCycles.orgId, orgId), eq(surveyCycles.status, 'open')))
      .orderBy(desc(surveyCycles.opensAt))
      .limit(1);
    return row ?? null;
  }

  /** Scheduled or open cycles whose window overlaps `[opensAt, closesAt)`. */
  async findOverlappingCycles(orgId: string, opensAt: Date, closesAt: Date, tx?: DbExecutor): Promise<CycleRow[]> {
    return this.exec(tx)
      .select()
      .from(surveyCycles)
      .where(
        and(
          eq(surveyCycles.orgId, orgId),
          inArray(surveyCycles.status, ['scheduled', 'open', 'closing']),
          lt(surveyCycles.opensAt, closesAt),
          gte(surveyCycles.closesAt, opensAt),
        ),
      );
  }

  /** Inserts a cycle; `ON CONFLICT (org_id, opens_at) DO NOTHING` makes a duplicate launch job a no-op. */
  async insertCycle(values: NewCycle, tx: DbExecutor): Promise<CycleRow | null> {
    const [row] = await tx
      .insert(surveyCycles)
      .values(values)
      .onConflictDoNothing({ target: [surveyCycles.orgId, surveyCycles.opensAt] })
      .returning();
    return row ?? null;
  }

  async updateCycle(id: string, patch: Partial<NewCycle>, tx: DbExecutor): Promise<CycleRow | null> {
    const [row] = await tx.update(surveyCycles).set(patch).where(eq(surveyCycles.id, id)).returning();
    return row ?? null;
  }

  /** Scheduled cycles whose `opensAt` has passed (system context, the job). */
  async findCyclesDueToLaunch(now: Date, tx?: DbExecutor): Promise<CycleRow[]> {
    return this.exec(tx)
      .select()
      .from(surveyCycles)
      .where(and(eq(surveyCycles.status, 'scheduled'), lte(surveyCycles.opensAt, now)));
  }

  /** Cycles the finalizer must run: open past their close, closing, or failed (system context, the job). */
  async findCyclesDueToFinalize(now: Date, tx?: DbExecutor): Promise<CycleRow[]> {
    return this.exec(tx)
      .select()
      .from(surveyCycles)
      .where(
        sql`(${surveyCycles.status} = 'open' and ${surveyCycles.closesAt} <= ${now}) or ${surveyCycles.status} in ('closing', 'failed')`,
      );
  }

  async findOpenCycles(tx?: DbExecutor): Promise<CycleRow[]> {
    return this.exec(tx).select().from(surveyCycles).where(eq(surveyCycles.status, 'open'));
  }

  // ── Audience and participation (restricted) ──────────────────────────────

  /** ACTIVE, date-current memberships of the organization with their primary org unit. */
  async findAudience(orgId: string, now: Date, tx: DbExecutor): Promise<AudienceMember[]> {
    return tx
      .select({ membershipId: memberships.id, userId: memberships.userId, orgUnitId: memberships.orgUnitId })
      .from(memberships)
      .where(
        and(
          eq(memberships.orgId, orgId),
          eq(memberships.status, 'ACTIVE'),
          lte(memberships.startDate, now),
          sql`(${memberships.endDate} is null or ${memberships.endDate} > ${now})`,
        ),
      );
  }

  async countActiveMembers(orgId: string, now: Date, tx?: DbExecutor): Promise<number> {
    const [row] = await this.exec(tx)
      .select({ n: sql<number>`count(*)::int` })
      .from(memberships)
      .where(
        and(
          eq(memberships.orgId, orgId),
          eq(memberships.status, 'ACTIVE'),
          lte(memberships.startDate, now),
          sql`(${memberships.endDate} is null or ${memberships.endDate} > ${now})`,
        ),
      );
    return row?.n ?? 0;
  }

  async findUnits(orgId: string, tx?: DbExecutor): Promise<UnitNode[]> {
    return this.exec(tx)
      .select({ id: orgUnits.id, parentId: orgUnits.parentId, kind: orgUnits.kind, name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.orgId, orgId));
  }

  async insertParticipations(values: NewParticipation[], tx: DbExecutor): Promise<void> {
    if (values.length === 0) return;
    await tx.insert(surveyParticipations).values(values).onConflictDoNothing();
  }

  /** The caller's own participation in a cycle (the employee paths). */
  async findParticipation(cycleId: string, userId: string, tx?: DbExecutor): Promise<ParticipationRow | null> {
    const [row] = await this.exec(tx)
      .select()
      .from(surveyParticipations)
      .where(and(eq(surveyParticipations.cycleId, cycleId), eq(surveyParticipations.userId, userId)));
    return row ?? null;
  }

  /**
   * Marks the participation submitted, only from `invited` or `draft`: no row
   * back means someone else submitted first (`already_submitted`).
   */
  async markSubmitted(
    participationId: string,
    responseId: string,
    submittedAt: Date,
    tx: DbExecutor,
  ): Promise<ParticipationRow | null> {
    const [row] = await tx
      .update(surveyParticipations)
      .set({ state: 'submitted', responseId, submittedAt })
      .where(
        and(eq(surveyParticipations.id, participationId), inArray(surveyParticipations.state, ['invited', 'draft'])),
      )
      .returning();
    return row ?? null;
  }

  async updateParticipation(id: string, patch: Partial<NewParticipation>, tx: DbExecutor): Promise<void> {
    await tx.update(surveyParticipations).set(patch).where(eq(surveyParticipations.id, id));
  }

  /** Non-submitters of an open cycle with a still-active membership and the recipient's address and locale (the reminder job). */
  async findReminderCandidates(
    cycleId: string,
    reminderLimit: number,
    tx?: DbExecutor,
  ): Promise<Array<ParticipationRow & { email: string; locale: string }>> {
    const rows = await this.exec(tx)
      .select({ participation: surveyParticipations, email: users.email, locale: users.locale })
      .from(surveyParticipations)
      .innerJoin(users, eq(users.id, surveyParticipations.userId))
      .innerJoin(memberships, eq(memberships.id, surveyParticipations.membershipId))
      .where(
        and(
          eq(surveyParticipations.cycleId, cycleId),
          inArray(surveyParticipations.state, ['invited', 'draft']),
          lt(surveyParticipations.remindersSent, reminderLimit),
          eq(memberships.status, 'ACTIVE'),
          isNull(memberships.endDate),
        ),
      );
    return rows.map((r) => ({ ...r.participation, email: r.email, locale: r.locale }));
  }

  /** Recipients of the launch invitation: every participant with an address and locale. */
  async findInvitationRecipients(cycleId: string, tx?: DbExecutor): Promise<Array<{ email: string; locale: string }>> {
    return this.exec(tx)
      .select({ email: users.email, locale: users.locale })
      .from(surveyParticipations)
      .innerJoin(users, eq(users.id, surveyParticipations.userId))
      .where(eq(surveyParticipations.cycleId, cycleId));
  }

  async findDraft(participationId: string, tx?: DbExecutor): Promise<DraftRow | null> {
    const [row] = await this.exec(tx).select().from(surveyDrafts).where(eq(surveyDrafts.participationId, participationId));
    return row ?? null;
  }

  async upsertDraft(participationId: string, orgId: string, answers: Record<string, number>, tx: DbExecutor): Promise<void> {
    await tx
      .insert(surveyDrafts)
      .values({ participationId, orgId, answers })
      .onConflictDoUpdate({ target: surveyDrafts.participationId, set: { answers } });
  }

  async deleteDraft(participationId: string, tx: DbExecutor): Promise<void> {
    await tx.delete(surveyDrafts).where(eq(surveyDrafts.participationId, participationId));
  }

  async insertResponse(values: NewResponse, tx: DbExecutor): Promise<ResponseRow> {
    const [row] = await tx.insert(surveyResponses).values(values).returning();
    return row!;
  }

  /** Every response accepted before the cycle closed (the finalizer, under the cycle's exclusive lock). */
  async findAcceptedResponses(cycleId: string, closesAt: Date, tx: DbExecutor): Promise<ResponseRow[]> {
    return tx
      .select()
      .from(surveyResponses)
      .where(and(eq(surveyResponses.cycleId, cycleId), lt(surveyResponses.acceptedAt, closesAt)));
  }

  // ── Snapshots and cells ──────────────────────────────────────────────────

  async insertSnapshot(values: NewSnapshot, tx: DbExecutor): Promise<SnapshotRow> {
    const [row] = await tx.insert(surveySnapshots).values(values).returning();
    return row!;
  }

  async insertCells(values: NewCell[], tx: DbExecutor): Promise<void> {
    if (values.length === 0) return;
    await tx.insert(surveyAggregateCells).values(values);
  }

  async findSnapshot(id: string, tx?: DbExecutor): Promise<SnapshotRow | null> {
    const [row] = await this.exec(tx).select().from(surveySnapshots).where(eq(surveySnapshots.id, id));
    return row ?? null;
  }

  async findSnapshotByCycle(cycleId: string, tx?: DbExecutor): Promise<SnapshotRow | null> {
    const [row] = await this.exec(tx).select().from(surveySnapshots).where(eq(surveySnapshots.cycleId, cycleId));
    return row ?? null;
  }

  /** Published snapshots of an organization, newest first, with their cycle window. */
  async listSnapshots(orgId: string, tx?: DbExecutor): Promise<Array<SnapshotRow & { opensAt: Date; closesAt: Date }>> {
    const rows = await this.exec(tx)
      .select({ snapshot: surveySnapshots, opensAt: surveyCycles.opensAt, closesAt: surveyCycles.closesAt })
      .from(surveySnapshots)
      .innerJoin(surveyCycles, eq(surveyCycles.id, surveySnapshots.cycleId))
      .where(eq(surveySnapshots.orgId, orgId))
      .orderBy(desc(surveyCycles.closesAt));
    return rows.map((r) => ({ ...r.snapshot, opensAt: r.opensAt, closesAt: r.closesAt }));
  }

  async findCells(snapshotId: string, tx?: DbExecutor): Promise<CellRow[]> {
    return this.exec(tx)
      .select()
      .from(surveyAggregateCells)
      .where(eq(surveyAggregateCells.snapshotId, snapshotId))
      .orderBy(asc(surveyAggregateCells.cohortKey), asc(surveyAggregateCells.dimensionKey));
  }

  async findCellsOfSnapshots(snapshotIds: string[], tx?: DbExecutor): Promise<CellRow[]> {
    if (snapshotIds.length === 0) return [];
    return this.exec(tx).select().from(surveyAggregateCells).where(inArray(surveyAggregateCells.snapshotId, snapshotIds));
  }

  // ── Offer dismissals ─────────────────────────────────────────────────────

  async findDismissal(snapshotId: string, userId: string, tx?: DbExecutor): Promise<boolean> {
    const [row] = await this.exec(tx)
      .select({ id: surveyOfferDismissals.id })
      .from(surveyOfferDismissals)
      .where(and(eq(surveyOfferDismissals.snapshotId, snapshotId), eq(surveyOfferDismissals.userId, userId)));
    return !!row;
  }

  async insertDismissal(values: typeof surveyOfferDismissals.$inferInsert, tx: DbExecutor): Promise<void> {
    await tx.insert(surveyOfferDismissals).values(values).onConflictDoNothing();
  }

  // ── Purge (the maintenance job) ──────────────────────────────────────────

  /** Drafts of cycles that are no longer open. */
  async deleteStaleDrafts(tx?: DbExecutor): Promise<number> {
    const rows = await this.exec(tx)
      .delete(surveyDrafts)
      .where(
        inArray(
          surveyDrafts.participationId,
          this.exec(tx)
            .select({ id: surveyParticipations.id })
            .from(surveyParticipations)
            .innerJoin(surveyCycles, eq(surveyCycles.id, surveyParticipations.cycleId))
            .where(ne(surveyCycles.status, 'open')),
        ),
      )
      .returning({ id: surveyDrafts.participationId });
    return rows.length;
  }

  /** Participation links of published cycles older than the retention horizon. */
  async deleteExpiredParticipations(before: Date, tx?: DbExecutor): Promise<number> {
    const rows = await this.exec(tx)
      .delete(surveyParticipations)
      .where(
        inArray(
          surveyParticipations.cycleId,
          this.exec(tx)
            .select({ id: surveyCycles.id })
            .from(surveyCycles)
            .where(and(eq(surveyCycles.status, 'published'), lt(surveyCycles.finalizedAt, before))),
        ),
      )
      .returning({ id: surveyParticipations.id });
    return rows.length;
  }
}
