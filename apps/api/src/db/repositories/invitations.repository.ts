/**
 * InvitationsRepository — invitation rows (T-1.5). Methods are added by the
 * invitations feature; keep Drizzle query builders here, not in services.
 */
import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, gt, lt, or } from 'drizzle-orm';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db.service.js';
import {
  invitations,
  ssoConnections,
  ssoDomains,
  organizations,
} from '../schema/index.js';

export type InvitationRow = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;

export interface PendingInvitationListOptions {
  limit: number;
  /** Id of the last invitation of the previous page. */
  cursor?: string;
  now: Date;
}

@Injectable()
export class InvitationsRepository {
  constructor(private readonly dbs: DbService) {}

  protected exec(tx?: DbExecutor): DbExecutor {
    return tx ?? this.dbs.db;
  }

  /** Insert a new invitation row. */
  async create(input: NewInvitation, tx?: DbExecutor): Promise<InvitationRow> {
    const [row] = await this.exec(tx).insert(invitations).values(input).returning();
    return row!;
  }

  /** Find an invitation by id. */
  async findById(id: string, tx?: DbExecutor): Promise<InvitationRow | null> {
    const row = await this.exec(tx).query.invitations.findFirst({
      where: eq(invitations.id, id),
    });
    return row ?? null;
  }

  /** Organization display name for invitation emails; null when unknown. */
  async findOrganizationName(orgId: string, tx?: DbExecutor): Promise<string | null> {
    const [row] = await this.exec(tx)
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, orgId));
    return row?.name ?? null;
  }

  /** Find an invitation by id, also checking it belongs to the given org. */
  async findByIdAndOrg(
    id: string,
    orgId: string,
    tx?: DbExecutor,
  ): Promise<InvitationRow | null> {
    const row = await this.exec(tx).query.invitations.findFirst({
      where: and(eq(invitations.id, id), eq(invitations.orgId, orgId)),
    });
    return row ?? null;
  }

  /** Find a pending (not revoked, not accepted, not expired) invitation for the email in the org. */
  async findPendingByEmailAndOrg(
    email: string,
    orgId: string,
    now: Date,
    tx?: DbExecutor,
  ): Promise<InvitationRow | null> {
    const row = await this.exec(tx).query.invitations.findFirst({
      where: and(
        eq(invitations.email, email),
        eq(invitations.orgId, orgId),
        isNull(invitations.revokedAt),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, now),
      ),
    });
    return row ?? null;
  }

  /**
   * Pending invitations of the organization (not accepted, not revoked, not
   * expired at `now`), newest first by `(createdAt, id)`. The cursor is the id
   * of the last row of the previous page; an unknown cursor yields an empty
   * page. Fetches `limit + 1` rows so the caller can detect a next page.
   */
  async listPending(
    orgId: string,
    opts: PendingInvitationListOptions,
    tx?: DbExecutor,
  ): Promise<InvitationRow[]> {
    const conditions = [
      eq(invitations.orgId, orgId),
      isNull(invitations.revokedAt),
      isNull(invitations.acceptedAt),
      gt(invitations.expiresAt, opts.now),
    ];

    if (opts.cursor) {
      const [anchor] = await this.exec(tx)
        .select({ id: invitations.id, createdAt: invitations.createdAt })
        .from(invitations)
        .where(and(eq(invitations.id, opts.cursor), eq(invitations.orgId, orgId)));
      if (!anchor) return [];
      conditions.push(
        or(
          lt(invitations.createdAt, anchor.createdAt),
          and(eq(invitations.createdAt, anchor.createdAt), lt(invitations.id, anchor.id)),
        )!,
      );
    }

    return this.exec(tx)
      .select()
      .from(invitations)
      .where(and(...conditions))
      .orderBy(desc(invitations.createdAt), desc(invitations.id))
      .limit(opts.limit + 1);
  }

  /** Find an invitation by token hash. */
  async findByTokenHash(tokenHash: string, tx?: DbExecutor): Promise<InvitationRow | null> {
    const row = await this.exec(tx).query.invitations.findFirst({
      where: eq(invitations.tokenHash, tokenHash),
    });
    return row ?? null;
  }

  /**
   * Find a pending, unexpired, unrevoked invitation by token hash.
   * Used for preview and acceptance endpoints.
   */
  async findPendingByTokenHash(
    tokenHash: string,
    now: Date,
    tx?: DbExecutor,
  ): Promise<InvitationRow | null> {
    const row = await this.exec(tx).query.invitations.findFirst({
      where: and(
        eq(invitations.tokenHash, tokenHash),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, now),
      ),
    });
    return row ?? null;
  }

  /** Set the revokedAt timestamp on an invitation. */
  async revoke(id: string, revokedAt: Date, tx?: DbExecutor): Promise<InvitationRow | null> {
    const [row] = await this.exec(tx)
      .update(invitations)
      .set({ revokedAt })
      .where(eq(invitations.id, id))
      .returning();
    return row ?? null;
  }

  /** Set acceptedAt and acceptedUserId on an invitation. */
  async accept(
    id: string,
    acceptedAt: Date,
    acceptedUserId: string,
    tx?: DbExecutor,
  ): Promise<InvitationRow | null> {
    const [row] = await this.exec(tx)
      .update(invitations)
      .set({ acceptedAt, acceptedUserId })
      .where(eq(invitations.id, id))
      .returning();
    return row ?? null;
  }

  /**
   * Check if an ACTIVE SSO connection with a verified domain matching the
   * email domain exists for the org. Returns true when SSO should be used.
   */
  async hasSsoForEmailDomain(
    orgId: string,
    emailDomain: string,
    tx?: DbExecutor,
  ): Promise<boolean> {
    const row = await this.exec(tx).query.ssoConnections.findFirst({
      where: and(eq(ssoConnections.orgId, orgId), eq(ssoConnections.status, 'ACTIVE')),
      with: {
        domains: {
          where: and(
            eq(ssoDomains.domain, emailDomain.toLowerCase()),
            // verifiedAt must be non-null
          ),
        },
      },
    });
    if (!row) return false;
    return row.domains.some((d) => d.verifiedAt != null);
  }
}
