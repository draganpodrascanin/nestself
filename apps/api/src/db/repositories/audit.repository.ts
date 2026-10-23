/**
 * AuditRepository — append-only audit events and retention policies.
 */
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
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

  /**
   * Create the monthly `audit_events` partitions for the coming months
   * (function from migration 0001; idempotent). Returns the partition names
   * that now exist for that window.
   */
  async ensurePartitions(monthsAhead: number, tx?: DbExecutor): Promise<string[]> {
    const db = this.exec(tx);
    await db.execute(sql`select audit_events_ensure_partitions(${monthsAhead}::int)`);
    const result = await db.execute<{ relname: string }>(sql`
      select child.relname
      from pg_inherits
      join pg_class parent on parent.oid = pg_inherits.inhparent
      join pg_class child on child.oid = pg_inherits.inhrelid
      where parent.relname = 'audit_events'
      order by child.relname
    `);
    return result.rows.map((r) => r.relname);
  }
}
