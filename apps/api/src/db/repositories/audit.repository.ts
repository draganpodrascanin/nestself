/**
 * AuditRepository — append-only audit events and retention policies.
 */
import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db.service.js';
import { auditEvents, retentionPolicies } from '../schema/index.js';

export type NewAuditEvent = typeof auditEvents.$inferInsert;
export type RetentionPolicyRow = typeof retentionPolicies.$inferSelect;

@Injectable()
export class AuditRepository {
  constructor(private readonly dbs: DbService) {}

  private exec(tx?: DbExecutor): DbExecutor {
    return tx ?? this.dbs.db;
  }

  async insertEvent(event: NewAuditEvent, tx?: DbExecutor): Promise<void> {
    await this.exec(tx).insert(auditEvents).values(event);
  }

  async findRetentionPolicies(tx?: DbExecutor): Promise<RetentionPolicyRow[]> {
    return this.exec(tx).select().from(retentionPolicies);
  }
}
