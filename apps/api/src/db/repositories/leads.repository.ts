/**
 * LeadsRepository — marketing leads captured by the public site.
 */
import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService } from '../db.service.js';
import { leads } from '../schema/index.js';

export type NewLead = typeof leads.$inferInsert;
export type LeadRow = typeof leads.$inferSelect;

@Injectable()
export class LeadsRepository {
  constructor(private readonly dbs: DbService) {}

  async insert(lead: NewLead): Promise<LeadRow> {
    const [row] = await this.dbs.db.insert(leads).values(lead).returning();
    return row!;
  }
}
