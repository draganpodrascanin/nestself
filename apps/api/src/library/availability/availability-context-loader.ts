/**
 * AvailabilityContextLoader — builds an AvailabilityContext from a principal's
 * personal context (org id + membership id) and the database [ACC-R-17].
 *
 * Two entry points:
 * - `forReader()` validates the membership inside `withOrgScope` and throws
 *   `ApiHttpException(403, 'org_context_expired')` on failure (C3).
 * - `forPreview()` builds a context for admin simulation with no user/membership
 *   validation (I6).
 *
 * Both load capabilities and the org-unit ancestry chain once per request.
 */
import { Injectable, HttpStatus } from '@nestjs/common';
import { and, eq, lte, or, isNull, gt, asc } from 'drizzle-orm';
import type { DbExecutor, Database } from '../../db/db.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, withOrgScope } from '../../db/db.service.js';
import {
  memberships,
  orgUnitClosure,
  orgUnits,
} from '../../db/schema/organization.js';
import { orgContentCapabilities } from '../../db/schema/library.js';
import { ApiHttpException } from '../../common/api-error.js';
import type {
  AvailabilityContext,
  ContentCapability,
  ReaderLocale,
} from './availability-context.js';

export interface PrincipalContext {
  userId: string;
  orgId: string;
  membershipId: string;
}

export interface PreviewInput {
  orgId: string;
  orgUnitId: string | null;
  readerLocale: ReaderLocale;
  now: Date;
}

@Injectable()
export class AvailabilityContextLoader {
  constructor(private readonly dbService: DbService) {}

  /**
   * Build the availability context for a real reader. Validates the membership
   * is ACTIVE and within its date range inside `withOrgScope`. Throws
   * `ApiHttpException(403, 'org_context_expired')` if validation fails.
   *
   * @param principal - The authenticated user's context
   * @param readerLocale - The reader's interface locale
   * @param now - Current timestamp (defaults to `new Date()`)
   * @param dbOverride - Optional Database (not transaction) for testing
   */
  async forReader(
    principal: PrincipalContext,
    readerLocale: ReaderLocale,
    now: Date = new Date(),
    dbOverride?: Database,
  ): Promise<AvailabilityContext> {
    const database = dbOverride ?? this.dbService.db;
    return withOrgScope(database, principal.orgId, async (tx) => {
      // Validate membership
      const membershipRows = await tx
        .select({
          orgUnitId: memberships.orgUnitId,
          status: memberships.status,
          startDate: memberships.startDate,
          endDate: memberships.endDate,
        })
        .from(memberships)
        .where(
          and(
            eq(memberships.id, principal.membershipId),
            eq(memberships.userId, principal.userId),
            eq(memberships.orgId, principal.orgId),
          ),
        )
        .limit(1);

      const membership = membershipRows[0];
      if (
        !membership ||
        membership.status !== 'ACTIVE' ||
        membership.startDate > now ||
        (membership.endDate != null && membership.endDate <= now)
      ) {
        throw new ApiHttpException({
          status: HttpStatus.FORBIDDEN,
          code: 'org_context_expired',
          message:
            'The membership is not active or has expired. Please switch to an active context.',
        });
      }

      const [orgUnitIds, capabilities] = await Promise.all([
        this.loadOrgUnitIds(tx, membership.orgUnitId),
        this.loadCapabilities(tx, principal.orgId, now),
      ]);

      return {
        kind: 'reader' as const,
        userId: principal.userId,
        orgId: principal.orgId,
        membershipId: principal.membershipId,
        orgUnitIds,
        capabilities,
        readerLocale,
        now,
      };
    });
  }

  /**
   * Build the availability context for an admin preview simulation (I6).
   * No user or membership validation — just loads org unit ancestry and
   * capabilities. Validates `orgUnitId` belongs to `orgId` when provided.
   */
  async forPreview(
    input: PreviewInput,
    dbOverride?: DbExecutor,
  ): Promise<AvailabilityContext> {
    const db = dbOverride ?? this.dbService.db;

    // Validate org unit belongs to org when provided
    if (input.orgUnitId) {
      const unitRows = await db
        .select({ orgId: orgUnits.orgId })
        .from(orgUnits)
        .where(eq(orgUnits.id, input.orgUnitId))
        .limit(1);

      if (!unitRows[0] || unitRows[0].orgId !== input.orgId) {
        throw new ApiHttpException({
          status: HttpStatus.BAD_REQUEST,
          code: 'org_unit_mismatch',
          message: 'The org unit does not belong to the specified organization.',
        });
      }
    }

    const [orgUnitIds, capabilities] = await Promise.all([
      this.loadOrgUnitIds(db, input.orgUnitId),
      this.loadCapabilities(db, input.orgId, input.now),
    ]);

    return {
      kind: 'preview' as const,
      userId: 'preview',
      orgId: input.orgId,
      membershipId: 'preview',
      orgUnitIds,
      capabilities,
      readerLocale: input.readerLocale,
      now: input.now,
    };
  }

  /**
   * Load the reader's org-unit ancestry chain: primary unit first, then
   * ancestors from `org_unit_closure` where `depth > 0`, ordered by depth
   * ascending (nearest ancestor first) (I5 minor).
   */
  private async loadOrgUnitIds(
    db: DbExecutor,
    primaryUnitId: string | null,
  ): Promise<string[]> {
    if (!primaryUnitId) return [];

    // Get ancestors from the closure table (depth > 0 only — we prepend the primary unit)
    const closureRows = await db
      .select({ ancestorId: orgUnitClosure.ancestorId })
      .from(orgUnitClosure)
      .where(
        and(
          eq(orgUnitClosure.descendantId, primaryUnitId),
          gt(orgUnitClosure.depth, 0),
        ),
      )
      .orderBy(asc(orgUnitClosure.depth));

    // [primary, ...ancestors where depth > 0]
    return [primaryUnitId, ...closureRows.map((r) => r.ancestorId)];
  }

  /**
   * Load enabled capability keys for the organization at the given time.
   * `enabled_from <= now` and (`enabled_until` is null or `> now`).
   */
  private async loadCapabilities(
    db: DbExecutor,
    orgId: string,
    now: Date,
  ): Promise<ContentCapability[]> {
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

    return rows.map((r) => r.capability) as ContentCapability[];
  }
}
