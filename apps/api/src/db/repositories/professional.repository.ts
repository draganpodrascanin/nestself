/**
 * ProfessionalRepository: confidential-domain rows (T-2.4). Reads are
 * unscoped (`dbs.db`, system context) because the professional module
 * authorizes each loaded row with `AuthorizationService.require` before
 * returning anything; RLS stays the defense in depth for scoped callers.
 * The create methods serve the seed and tests.
 */
import { Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db.service.js';
import { conversationMessages, conversations, intakeRecords } from '../schema/index.js';

export type ConversationRow = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type ConversationMessageRow = typeof conversationMessages.$inferSelect;
export type NewConversationMessage = typeof conversationMessages.$inferInsert;
export type IntakeRecordRow = typeof intakeRecords.$inferSelect;
export type NewIntakeRecord = typeof intakeRecords.$inferInsert;

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

  async createConversation(values: NewConversation, tx?: DbExecutor): Promise<ConversationRow> {
    const [row] = await this.exec(tx).insert(conversations).values(values).returning();
    return row!;
  }

  async addMessage(values: NewConversationMessage, tx?: DbExecutor): Promise<ConversationMessageRow> {
    const [row] = await this.exec(tx).insert(conversationMessages).values(values).returning();
    return row!;
  }

  async createIntake(values: NewIntakeRecord, tx?: DbExecutor): Promise<IntakeRecordRow> {
    const [row] = await this.exec(tx).insert(intakeRecords).values(values).returning();
    return row!;
  }
}
