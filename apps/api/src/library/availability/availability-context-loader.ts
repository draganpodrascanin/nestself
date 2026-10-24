/**
 * AvailabilityContextLoader — builds an AvailabilityContext from a principal's
 * personal context (org id + membership id) and the database [ACC-R-17].
 *
 * Loads capabilities and the org-unit ancestry chain once per request.
 */
import { Injectable } from '@nestjs/common';
import { and, eq, lte, or, isNull, gt, asc } from 'drizzle-orm';
import type { DbExecutor } from '../../db/db.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService } from '../../db/db.service.js';
import { memberships, orgUnitClosure } from '../../db/schema/organization.js';
import { orgContentCapabilities } from '../../db/schema/library.js';
import type {
  AvailabilityContext,
  ReaderLocale,
} from './availability-context.js';

export interface PrincipalContext {
  userId: string;
  orgId: string;
  membershipId: string;
}

@Injectable()
export class AvailabilityContextLoader {
  constructor(private readonly dbService: DbService) {}

  /**
   * Build the full availability context from a principal's personal context.
   *
   * @param principal - The authenticated user's context (userId, orgId, membershipId)
   * @param readerLocale - The reader's interface locale
   * @param now - Current timestamp (defaults to `new Date()`)
   * @param dbOverride - Optional DB executor for testing
   */
  async load(
    principal: PrincipalContext,
    readerLocale: ReaderLocale,
    now: Date = new Date(),
    dbOverride?: DbExecutor,
  ): Promise<AvailabilityContext> {
    const db = dbOverride ?? this.dbService.db;
    const [orgUnitIds, capabilities] = await Promise.all([
      this.loadOrgUnitIds(db, principal.membershipId),
      this.loadCapabilities(db, principal.orgId, now),
    ]);

    return {
      userId: principal.userId,
      orgId: principal.orgId,
      membershipId: principal.membershipId,
      orgUnitIds,
      capabilities,
      readerLocale,
      now,
    };
  }

  /**
   * Load the reader's org-unit ancestry chain: primary unit first, then
   * ancestors from `org_unit_closure` ordered by depth ascending (nearest
   * ancestor first).
   */
  private async loadOrgUnitIds(
    db: DbExecutor,
    membershipId: string,
  ): Promise<string[]> {
    // Get the membership's primary org unit
    const membershipRows = await db
      .select({ orgUnitId: memberships.orgUnitId })
      .from(memberships)
      .where(eq(memberships.id, membershipId))
      .limit(1);

    const primaryUnitId = membershipRows[0]?.orgUnitId;
    if (!primaryUnitId) return [];

    // Get ancestors from the closure table (includes self at depth 0)
    const closureRows = await db
      .select({ ancestorId: orgUnitClosure.ancestorId })
      .from(orgUnitClosure)
      .where(eq(orgUnitClosure.descendantId, primaryUnitId))
      .orderBy(asc(orgUnitClosure.depth));

    // The self-referencing entry (depth 0) is the primary unit itself.
    // The rest are ancestors in nearest-first order.
    return closureRows.map((r) => r.ancestorId);
  }

  /**
   * Load enabled capability keys for the organization at the given time.
   * `enabled_from <= now` and (`enabled_until` is null or `> now`).
   */
  private async loadCapabilities(
    db: DbExecutor,
    orgId: string,
    now: Date,
  ): Promise<string[]> {
    const rows = await db
      .select({ capability: orgContentCapabilities.capability })
      .from(orgContentCapabilities)
      .where(
        and(
          eq(orgContentCapabilities.orgId, orgId),
          lte(orgContentCapabilities.enabledFrom, now),
          or(
            isNull(orgContentCapabilities.enabledUntil),
            gt(orgContentCapabilities.enabledUntil, now),
          ),
        ),
      );

    return rows.map((r) => r.capability);
  }
}
