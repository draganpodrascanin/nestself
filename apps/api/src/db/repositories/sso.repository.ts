/**
 * SsoRepository: enterprise SSO connections and their email domains (D-12,
 * 3.4). Both tables carry row-level security: a tenant-scoped transaction
 * (`withOrgScope`) sees and writes only its own organization's rows, and
 * every write the SSO service makes runs in the connection's scope.
 *
 * Deliberately unscoped (system context, no tenant setting) reads:
 * - `findConnectionByProviderName` and `findDomainByName`: uniqueness of the
 *   provider name and of the domain is global, across organizations
 *   (SSO-R-07, Review Focus 3 and 5), so they must see every tenant;
 * - `listConnections` without a tenant transaction: the staff list spans
 *   organizations (`sso.manage` is a platform action);
 * - `findActiveConnectionForDomain`: home-realm discovery runs before any
 *   organization is known.
 */
import { Injectable } from '@nestjs/common';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db.service.js';
import { ssoConnections, ssoDomains } from '../schema/index.js';

export type SsoConnectionRow = typeof ssoConnections.$inferSelect;
export type NewSsoConnection = typeof ssoConnections.$inferInsert;
export type SsoDomainRow = typeof ssoDomains.$inferSelect;
export type SsoConnectionWithDomains = SsoConnectionRow & { domains: SsoDomainRow[] };

/** Columns a caller may change after creation. */
export type SsoConnectionPatch = Partial<
  Pick<
    SsoConnectionRow,
    | 'protocol'
    | 'cognitoProviderName'
    | 'status'
    | 'metadataUrl'
    | 'metadataXml'
    | 'oidcIssuer'
    | 'oidcClientId'
    | 'attributeMapping'
    | 'idpInitiatedAllowed'
    | 'jitProvisioning'
    | 'defaultOrgUnitId'
    | 'certificateExpiresAt'
    | 'lastTestedAt'
  >
>;

/** PostgreSQL `unique_violation`, directly or wrapped by the driver/ORM. */
export function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 3 && current; depth += 1) {
    if (typeof current === 'object' && (current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

@Injectable()
export class SsoRepository {
  constructor(private readonly dbs: DbService) {}

  protected exec(tx?: DbExecutor): DbExecutor {
    return tx ?? this.dbs.db;
  }

  // ── Connections ──────────────────────────────────────────────────────

  /** Connections (optionally of one organization) with their domains, oldest first. */
  async listConnections(
    filter: { orgId?: string },
    tx?: DbExecutor,
  ): Promise<SsoConnectionWithDomains[]> {
    return this.exec(tx).query.ssoConnections.findMany({
      where: filter.orgId ? eq(ssoConnections.orgId, filter.orgId) : undefined,
      with: { domains: { orderBy: [asc(ssoDomains.domain)] } },
      orderBy: [asc(ssoConnections.createdAt), asc(ssoConnections.id)],
    });
  }

  async findConnection(id: string, tx?: DbExecutor): Promise<SsoConnectionWithDomains | null> {
    const row = await this.exec(tx).query.ssoConnections.findFirst({
      where: eq(ssoConnections.id, id),
      with: { domains: { orderBy: [asc(ssoDomains.domain)] } },
    });
    return row ?? null;
  }

  async findConnectionByProviderName(name: string, tx?: DbExecutor): Promise<SsoConnectionRow | null> {
    const [row] = await this.exec(tx)
      .select()
      .from(ssoConnections)
      .where(eq(ssoConnections.cognitoProviderName, name));
    return row ?? null;
  }

  /** Insert a connection; a taken `cognitoProviderName` raises a unique violation. */
  async createConnection(input: NewSsoConnection, tx?: DbExecutor): Promise<SsoConnectionRow> {
    const [row] = await this.exec(tx).insert(ssoConnections).values(input).returning();
    return row!;
  }

  /**
   * Apply a patch; null when the connection does not exist or, with
   * `fromStatus`, is no longer in that status (a conditional transition).
   */
  async updateConnection(
    id: string,
    patch: SsoConnectionPatch,
    tx?: DbExecutor,
    opts: { fromStatus?: SsoConnectionRow['status'] } = {},
  ): Promise<SsoConnectionRow | null> {
    const where = opts.fromStatus
      ? and(eq(ssoConnections.id, id), eq(ssoConnections.status, opts.fromStatus))
      : eq(ssoConnections.id, id);
    if (Object.keys(patch).length === 0) {
      const [row] = await this.exec(tx).select().from(ssoConnections).where(where);
      return row ?? null;
    }
    const [row] = await this.exec(tx).update(ssoConnections).set(patch).where(where).returning();
    return row ?? null;
  }

  // ── Domains ──────────────────────────────────────────────────────────

  /** The domain row whatever its connection or verification state (`domain` is unique). */
  async findDomainByName(domain: string, tx?: DbExecutor): Promise<SsoDomainRow | null> {
    const [row] = await this.exec(tx)
      .select()
      .from(ssoDomains)
      .where(eq(ssoDomains.domain, domain.trim().toLowerCase()));
    return row ?? null;
  }

  /** Insert a pending domain; a taken `domain` raises a unique violation. */
  async addDomain(
    input: { connectionId: string; domain: string; verificationToken: string },
    tx?: DbExecutor,
  ): Promise<SsoDomainRow> {
    const [row] = await this.exec(tx)
      .insert(ssoDomains)
      .values({ ...input, domain: input.domain.trim().toLowerCase() })
      .returning();
    return row!;
  }

  /** The domain only when it belongs to the given connection. */
  async findDomain(connectionId: string, domainId: string, tx?: DbExecutor): Promise<SsoDomainRow | null> {
    const [row] = await this.exec(tx)
      .select()
      .from(ssoDomains)
      .where(and(eq(ssoDomains.id, domainId), eq(ssoDomains.connectionId, connectionId)));
    return row ?? null;
  }

  async markDomainVerified(id: string, at: Date, tx?: DbExecutor): Promise<SsoDomainRow | null> {
    const [row] = await this.exec(tx)
      .update(ssoDomains)
      .set({ verifiedAt: at })
      .where(eq(ssoDomains.id, id))
      .returning();
    return row ?? null;
  }

  // ── Discovery and jobs ───────────────────────────────────────────────

  /**
   * The ACTIVE connection whose verified domain is `domain` (3.4.3 steps
   * 3-4); null for an unknown, unverified or non-active match.
   */
  async findActiveConnectionForDomain(domain: string, tx?: DbExecutor): Promise<SsoConnectionRow | null> {
    const [row] = await this.exec(tx)
      .select({ connection: ssoConnections })
      .from(ssoDomains)
      .innerJoin(ssoConnections, eq(ssoConnections.id, ssoDomains.connectionId))
      .where(
        and(
          eq(ssoDomains.domain, domain.trim().toLowerCase()),
          isNotNull(ssoDomains.verifiedAt),
          eq(ssoConnections.status, 'ACTIVE'),
        ),
      );
    return row?.connection ?? null;
  }

  /** ACTIVE connections with a known signing-certificate expiry (certificate-expiry job). */
  async listActiveConnectionsWithCertificates(tx?: DbExecutor): Promise<SsoConnectionRow[]> {
    return this.exec(tx)
      .select()
      .from(ssoConnections)
      .where(and(eq(ssoConnections.status, 'ACTIVE'), isNotNull(ssoConnections.certificateExpiresAt)))
      .orderBy(asc(ssoConnections.certificateExpiresAt), asc(ssoConnections.id));
  }

}
