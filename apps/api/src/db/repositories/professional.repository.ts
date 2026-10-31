/**
 * ProfessionalRepository: confidential-domain rows (T-2.4). Reads are
 * unscoped (`dbs.db`, system context) because the professional module
 * authorizes each loaded row with `AuthorizationService.require` before
 * returning anything; RLS stays the defense in depth for scoped callers.
 * The create methods serve the seed and tests; a conversation or an intake
 * record is created after its case (`createCase`).
 */
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db.service.js';
import { cases, conversationMessages, conversations, intakeRecords } from '../schema/index.js';

export type ConversationRow = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type ConversationMessageRow = typeof conversationMessages.$inferSelect;
export type NewConversationMessage = typeof conversationMessages.$inferInsert;
export type IntakeRecordRow = typeof intakeRecords.$inferSelect;
export type NewIntakeRecord = typeof intakeRecords.$inferInsert;
/** A conversation row with its message count; never a message body. */
export type ConversationSummaryRow = ConversationRow & { messageCount: number };

export interface ConversationPageOptions {
  limit: number;
  /** Id of the last row of the previous page. */
  cursor?: string;
}

@Injectable()
export class ProfessionalRepository {
  constructor(private readonly dbs: DbService) {}

  protected exec(tx?: DbExecutor): DbExecutor {
    return tx ?? this.dbs.db;
  }

  async findConversation(id: string, tx?: DbExecutor): Promise<ConversationRow | null> {
    const [row] = await this.exec(tx).select().from(conversations).where(eq(conversations.id, id));
    return row ?? null;
  }

  /**
   * Conversations of the given cases with their message counts, newest first
   * by `(createdAt, id)`. Fetches `limit + 1` rows so the caller can detect a
   * next page; an unknown cursor yields an empty page.
   */
  async listConversationsByCaseIds(
    caseIds: string[],
    page: ConversationPageOptions,
    tx?: DbExecutor,
  ): Promise<ConversationSummaryRow[]> {
    if (caseIds.length === 0) return [];
    return this.listSummaries(inArray(conversations.caseId, caseIds), page, tx);
  }

  /** Conversations in which the user is the employee participant; paging as above. */
  async listConversationsByEmployee(
    userId: string,
    page: ConversationPageOptions,
    tx?: DbExecutor,
  ): Promise<ConversationSummaryRow[]> {
    return this.listSummaries(eq(conversations.employeeUserId, userId), page, tx);
  }

  private async listSummaries(
    filter: SQL,
    page: ConversationPageOptions,
    tx?: DbExecutor,
  ): Promise<ConversationSummaryRow[]> {
    const conditions: SQL[] = [filter];
    if (page.cursor) {
      const [anchor] = await this.exec(tx)
        .select({ id: conversations.id, createdAt: conversations.createdAt })
        .from(conversations)
        .where(and(eq(conversations.id, page.cursor), filter));
      if (!anchor) return [];
      conditions.push(
        or(
          lt(conversations.createdAt, anchor.createdAt),
          and(eq(conversations.createdAt, anchor.createdAt), lt(conversations.id, anchor.id)),
        )!,
      );
    }
    return this.exec(tx)
      .select({
        id: conversations.id,
        orgId: conversations.orgId,
        caseId: conversations.caseId,
        employeeUserId: conversations.employeeUserId,
        expertUserId: conversations.expertUserId,
        createdAt: conversations.createdAt,
        messageCount: sql<number>`count(${conversationMessages.id})::int`,
      })
      .from(conversations)
      .leftJoin(conversationMessages, eq(conversationMessages.conversationId, conversations.id))
      .where(and(...conditions))
      .groupBy(conversations.id)
      .orderBy(desc(conversations.createdAt), desc(conversations.id))
      .limit(page.limit + 1);
  }

  /** Messages of one conversation, oldest first. */
  async listMessages(conversationId: string, tx?: DbExecutor): Promise<ConversationMessageRow[]> {
    return this.exec(tx)
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversationId))
      .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id));
  }

  async findIntake(id: string, tx?: DbExecutor): Promise<IntakeRecordRow | null> {
    const [row] = await this.exec(tx).select().from(intakeRecords).where(eq(intakeRecords.id, id));
    return row ?? null;
  }

  /**
   * Insert the case unless its id exists. An existing case is never moved to
   * another organization: a row that names it from another organization is
   * then refused by the composite foreign key.
   */
  async createCase(input: { id: string; orgId: string }, tx?: DbExecutor): Promise<void> {
    await this.exec(tx).insert(cases).values(input).onConflictDoNothing({ target: cases.id });
  }

  async createConversation(values: NewConversation, tx?: DbExecutor): Promise<ConversationRow> {
    await this.createCase({ id: values.caseId, orgId: values.orgId }, tx);
    const [row] = await this.exec(tx).insert(conversations).values(values).returning();
    return row!;
  }

  async addMessage(values: NewConversationMessage, tx?: DbExecutor): Promise<ConversationMessageRow> {
    const [row] = await this.exec(tx).insert(conversationMessages).values(values).returning();
    return row!;
  }

  async createIntake(values: NewIntakeRecord, tx?: DbExecutor): Promise<IntakeRecordRow> {
    await this.createCase({ id: values.caseId, orgId: values.orgId }, tx);
    const [row] = await this.exec(tx).insert(intakeRecords).values(values).returning();
    return row!;
  }
}
