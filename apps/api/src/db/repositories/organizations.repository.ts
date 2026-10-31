/**
 * OrganizationsRepository: employer client rows for the operations
 * workspace. `organizations` is not a tenant table (it has no row-level
 * security policy; it is the tenant itself), so reads use the unscoped
 * handle. Only staff routes guarded by `client.configure` call this.
 */
import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, ilike, or, type SQL } from 'drizzle-orm';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db.service.js';
import { likePrefix } from '../like-pattern.js';
import { organizations } from '../schema/index.js';

export type OrganizationRow = typeof organizations.$inferSelect;

export interface OrganizationListOptions {
  limit: number;
  /** Id of the last organization of the previous page. */
  cursor?: string;
  /** Case-insensitive prefix of the name or the slug. */
  search?: string;
}

@Injectable()
export class OrganizationsRepository {
  constructor(private readonly dbs: DbService) {}

  protected exec(tx?: DbExecutor): DbExecutor {
    return tx ?? this.dbs.db;
  }

  async findById(id: string, tx?: DbExecutor): Promise<OrganizationRow | null> {
    const [row] = await this.exec(tx).select().from(organizations).where(eq(organizations.id, id));
    return row ?? null;
  }

  /**
   * Organizations ordered by `(name, id)`. The cursor is the id of the last
   * row of the previous page; an unknown cursor yields an empty page.
   * Fetches `limit + 1` rows so the caller can detect a next page.
   */
  async list(opts: OrganizationListOptions, tx?: DbExecutor): Promise<OrganizationRow[]> {
    const conditions: SQL[] = [];

    if (opts.search) {
      const pattern = likePrefix(opts.search);
      conditions.push(or(ilike(organizations.name, pattern), ilike(organizations.slug, pattern))!);
    }

    if (opts.cursor) {
      const anchor = await this.findById(opts.cursor, tx);
      if (!anchor) return [];
      conditions.push(
        or(
          gt(organizations.name, anchor.name),
          and(eq(organizations.name, anchor.name), gt(organizations.id, anchor.id)),
        )!,
      );
    }

    return this.exec(tx)
      .select()
      .from(organizations)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(organizations.name), asc(organizations.id))
      .limit(opts.limit + 1);
  }
}
