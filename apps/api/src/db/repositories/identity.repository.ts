/**
 * IdentityRepository — users and identity-provider links.
 *
 * Repositories are the only place that touches Drizzle query builders, so
 * application services stay mockable with plain async methods.
 */
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db.service.js';
import { externalIdentities, users } from '../schema/index.js';

export type UserRow = typeof users.$inferSelect;
export type ExternalIdentityRow = typeof externalIdentities.$inferSelect;
export type NewExternalIdentity = typeof externalIdentities.$inferInsert;

/** User with the memberships and expert row the principal loader needs. */
export type UserForPrincipal = UserRow & {
  memberships: Array<{
    id: string;
    orgId: string;
    orgUnitId: string | null;
    status: 'INVITED' | 'ACTIVE' | 'ENDED';
    startDate: Date;
    endDate: Date | null;
    org: { name: string };
  }>;
  expert: { id: string } | null;
};

@Injectable()
export class IdentityRepository {
  constructor(private readonly dbs: DbService) {}

  private exec(tx?: DbExecutor): DbExecutor {
    return tx ?? this.dbs.db;
  }

  /** User with memberships and expert, or null. */
  async findUserForPrincipal(userId: string, tx?: DbExecutor): Promise<UserForPrincipal | null> {
    const row = await this.exec(tx).query.users.findFirst({
      where: eq(users.id, userId),
      with: {
        memberships: {
          columns: {
            id: true,
            orgId: true,
            orgUnitId: true,
            status: true,
            startDate: true,
            endDate: true,
          },
          with: { org: { columns: { name: true } } },
        },
        expert: { columns: { id: true } },
      },
    });
    return row ?? null;
  }

  async findUserById(userId: string, tx?: DbExecutor): Promise<UserRow | null> {
    const row = await this.exec(tx).query.users.findFirst({ where: eq(users.id, userId) });
    return row ?? null;
  }

  async findUserByEmail(email: string, tx?: DbExecutor): Promise<UserRow | null> {
    const row = await this.exec(tx).query.users.findFirst({
      where: eq(users.email, email.toLowerCase()),
    });
    return row ?? null;
  }

  /** Identity-provider link by (provider, subject), e.g. ('cognito', sub). */
  async findExternalIdentity(
    provider: string,
    subject: string,
    tx?: DbExecutor,
  ): Promise<ExternalIdentityRow | null> {
    const row = await this.exec(tx).query.externalIdentities.findFirst({
      where: and(eq(externalIdentities.provider, provider), eq(externalIdentities.subject, subject)),
    });
    return row ?? null;
  }

  async findExternalIdentitiesForUser(
    userId: string,
    tx?: DbExecutor,
  ): Promise<ExternalIdentityRow[]> {
    return this.exec(tx).query.externalIdentities.findMany({
      where: eq(externalIdentities.userId, userId),
    });
  }

  /** `ssoConnectionId` binds a federated identity to its connection; it defaults to null. */
  async createExternalIdentity(
    input: NewExternalIdentity,
    tx?: DbExecutor,
  ): Promise<ExternalIdentityRow> {
    const [row] = await this.exec(tx).insert(externalIdentities).values(input).returning();
    return row!;
  }

  async createUser(
    input: typeof users.$inferInsert,
    tx?: DbExecutor,
  ): Promise<UserRow> {
    const [row] = await this.exec(tx).insert(users).values(input).returning();
    return row!;
  }

  /** Find an external identity row by user id and provider. */
  async findByUserAndProvider(
    userId: string,
    provider: string,
    tx?: DbExecutor,
  ): Promise<ExternalIdentityRow | null> {
    const row = await this.exec(tx).query.externalIdentities.findFirst({
      where: and(eq(externalIdentities.userId, userId), eq(externalIdentities.provider, provider)),
    });
    return row ?? null;
  }

  /**
   * Upsert an external identity: insert or update on (provider, subject).
   * Returns the resulting row.
   */
  async upsertExternalIdentity(
    input: NewExternalIdentity,
    tx?: DbExecutor,
  ): Promise<ExternalIdentityRow> {
    const [row] = await this.exec(tx)
      .insert(externalIdentities)
      .values(input)
      .onConflictDoUpdate({
        target: [externalIdentities.provider, externalIdentities.subject],
        set: {
          email: input.email,
          emailVerified: input.emailVerified,
          cognitoUsername: input.cognitoUsername,
          lastSeenAt: new Date(),
        },
      })
      .returning();
    return row!;
  }

  /** Update the user's own profile fields. */
  async updateProfile(
    userId: string,
    patch: { locale?: string; displayName?: string },
    tx?: DbExecutor,
  ): Promise<UserRow | null> {
    const [row] = await this.exec(tx).update(users).set(patch).where(eq(users.id, userId)).returning();
    return row ?? null;
  }

  /** Record a successful sign-in. */
  async touchLastSignIn(userId: string, at: Date, tx?: DbExecutor): Promise<void> {
    await this.exec(tx).update(users).set({ lastSignInAt: at }).where(eq(users.id, userId));
  }

  /** Suspend or reinstate (`suspendedAt: null`) a user [D-18]. */
  async setSuspended(userId: string, suspendedAt: Date | null, tx?: DbExecutor): Promise<UserRow | null> {
    const [row] = await this.exec(tx)
      .update(users)
      .set({ suspendedAt })
      .where(eq(users.id, userId))
      .returning();
    return row ?? null;
  }
}
