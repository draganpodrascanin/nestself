/**
 * MaintenanceJobsService — the scheduled reconciliation work the auth strategy
 * asks for (D-07, D-17, D-21, AUTHZ-R-64, T-2.10). Every method is a plain,
 * idempotent unit of work that reports what it changed; `JobSchedulerService`
 * runs them on a schedule in the worker process and `scripts/run-job.ts` runs
 * one on demand. Nothing here runs on a request path.
 *
 * Jobs run in system context (no tenant setting): they must see every
 * organization. The SSO certificate-expiry job (3.4.10) also fetches the
 * metadata of each ACTIVE metadata-URL SAML connection, reads the identity
 * provider's view of the others and mails the operations mailbox. Every
 * change is written to the audit log with `actorKind: 'JOB'` and
 * invalidates the affected principal caches.
 */
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { surfaceOrigin } from '../auth/sso-start-url.js';
import { DbService } from '../db/db.service.js';
import { AuthorizationRepository, type GrantRow } from '../db/repositories/authorization.repository.js';
import { AuditRepository } from '../db/repositories/audit.repository.js';
import { OrganizationsRepository } from '../db/repositories/organizations.repository.js';
import { SsoRepository, type SsoConnectionRow } from '../db/repositories/sso.repository.js';
import { Mailer } from '../mailer/mailer.js';
import { IdentityProviderService } from '../identity/identity-provider.service.js';
import { certificateExpiryFromMetadata } from '../identity/saml-metadata.js';
import { AuditWriter, type AuditEventInput } from '../audit/audit-writer.js';
import { PrincipalLoader } from '../principal/principal-loader.js';
import { KEY_VALUE_STORE, type KeyValueStore } from '../redis/key-value-store.js';
import {
  SSO_CERT_ALERT_TTL,
  STALE_FAMILY_DENYLIST_TTL,
  mobileFamilyKey,
  revokedFamilyKey,
  sessionKey,
  ssoCertAlertKey,
  userMobileFamiliesKey,
} from '../redis/redis-keys.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { SessionService } from '../session/session.service.js';
import { METADATA_FETCHER, metadataFailureLabel, type MetadataFetcher } from '../sso/metadata-fetcher.js';

/** Months of `audit_events` partitions kept ahead of today (D-21). */
export const AUDIT_PARTITION_MONTHS_AHEAD = 3;

export const MAINTENANCE_JOB_NAMES = [
  'audit.ensure-partitions',
  'grants.reconcile',
  'mobile.prune-stale-families',
  'emergency.sweep-expired',
  'sessions.reconcile-ttl',
  'sso.certificate-expiry',
] as const;
export type MaintenanceJobName = (typeof MAINTENANCE_JOB_NAMES)[number];

export function isMaintenanceJobName(value: string): value is MaintenanceJobName {
  return (MAINTENANCE_JOB_NAMES as readonly string[]).includes(value);
}

export interface GrantReconciliationReport {
  expired: string[];
  orphanedDelegations: string[];
  withoutMembership: string[];
  /** Grants whose close or audit write threw; rolled back, logged by id and retried on the next run. */
  failed: number;
}

export interface StaleFamilyReport {
  usersScanned: number;
  familiesChecked: number;
  revoked: Array<{ userId: string; originJti: string }>;
}

export interface EmergencySweepReport {
  expired: string[];
  /** Records whose revoke or audit write threw; rolled back, logged by id and retried on the next run. */
  failed: number;
}

export interface SessionTtlReport {
  job: 'sessions.reconcile-ttl';
  scanned: number;
  /** Hashes of the destroyed sessions (the id the session list exposes). */
  destroyed: string[];
  /** Records whose read or destroy threw; logged by hash and retried on the next run. */
  failed: number;
}

/** Days before a SAML signing certificate expires from which the job warns. */
export const SSO_CERTIFICATE_WARNING_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SsoCertificateReport {
  job: 'sso.certificate-expiry';
  /** ACTIVE connections looked at. */
  scanned: number;
  /**
   * Connections whose stored expiry changed: set from the fetched metadata
   * (metadata-URL connections) or filled in from the identity provider.
   */
  refreshed: number;
  /** Connections whose certificate expires within the warning window (or has expired); each audited. */
  expiring: number;
  /** Expiring connections mailed to `OPS_ALERT_EMAIL` in this run (at most one mail per connection in 7 days). */
  alerted: number;
  /**
   * Failures, each logged and retried on the next run: a refresh that threw
   * (fetch, provider lookup, write) or fetched metadata without a signing
   * certificate, whose connection is still checked against its stored
   * expiry; an audit transaction that rejected (that connection is neither
   * counted as expiring nor mailed); an alert mail that was not sent.
   */
  failed: number;
}

/** What a connection's refresh found: the expiry to check, or fetched metadata without a signing certificate. */
type CertificateRefresh = { kind: 'expiry'; expiresAt: Date | null; written: boolean } | { kind: 'no_certificate' };

export type MaintenanceReport =
  | { job: 'audit.ensure-partitions'; partitions: string[] }
  | ({ job: 'grants.reconcile' } & GrantReconciliationReport)
  | ({ job: 'mobile.prune-stale-families' } & StaleFamilyReport)
  | ({ job: 'emergency.sweep-expired' } & EmergencySweepReport)
  | SessionTtlReport
  | SsoCertificateReport;

@Injectable()
export class MaintenanceJobsService {
  private readonly logger = new Logger(MaintenanceJobsService.name);

  constructor(
    @Inject(forwardRef(() => AuthorizationRepository)) private readonly authzRepo: AuthorizationRepository,
    @Inject(forwardRef(() => AuditRepository)) private readonly auditRepo: AuditRepository,
    @Inject(forwardRef(() => AuditWriter)) private readonly audit: AuditWriter,
    @Inject(forwardRef(() => PrincipalLoader)) private readonly principals: PrincipalLoader,
    @Inject(KEY_VALUE_STORE) private readonly store: KeyValueStore,
    private readonly sessions: SessionService,
    @Inject(forwardRef(() => SsoRepository)) private readonly ssoRepo: SsoRepository,
    @Inject(forwardRef(() => IdentityProviderService)) private readonly idp: IdentityProviderService,
    @Inject(forwardRef(() => DbService)) private readonly dbs: DbService,
    @Inject(forwardRef(() => OrganizationsRepository)) private readonly organizations: OrganizationsRepository,
    @Inject(METADATA_FETCHER) private readonly metadata: MetadataFetcher,
    @Inject(forwardRef(() => Mailer)) private readonly mailer: Mailer,
    @Inject(forwardRef(() => ConfigService)) private readonly config: ConfigService,
  ) {}

  /** Run one job by name. */
  async run(name: MaintenanceJobName, now = new Date()): Promise<MaintenanceReport> {
    switch (name) {
      case 'audit.ensure-partitions':
        return { job: name, partitions: await this.ensureAuditPartitions() };
      case 'grants.reconcile':
        return { job: name, ...(await this.reconcileGrants(now)) };
      case 'mobile.prune-stale-families':
        return { job: name, ...(await this.pruneStaleMobileFamilies()) };
      case 'emergency.sweep-expired':
        return { job: name, ...(await this.sweepExpiredEmergencyAccess(now)) };
      case 'sessions.reconcile-ttl':
        return this.reconcileSessionTtl(now);
      case 'sso.certificate-expiry':
        return this.checkSsoCertificates(now);
    }
  }

  /**
   * Create the coming months' `audit_events` partitions so an insert never
   * fails for lack of a partition (D-21, 4.8 "Partitioning").
   */
  async ensureAuditPartitions(): Promise<string[]> {
    const partitions = await this.auditRepo.ensurePartitions(AUDIT_PARTITION_MONTHS_AHEAD);
    this.logger.log(`audit_events partitions present: ${partitions.length}`);
    return partitions;
  }

  /**
   * Nightly grant reconciliation (T-2.10, D-17):
   * - grants whose `validUntil` passed are closed (`revokedReason: expired`);
   * - delegated grants whose parent is revoked are revoked (`parent_revoked`);
   * - organization-scoped grants without an ACTIVE membership are revoked
   *   (`membership_ended`), closing any gap left by a missed cascade.
   * Each grant is closed in its own transaction with its audit row, so one
   * failing grant is rolled back, logged by id, counted in `failed` and
   * retried on the next run while the others are closed. Only the grants
   * this run closed are listed; the subjects' caches are invalidated after
   * the commits.
   */
  async reconcileGrants(now = new Date()): Promise<GrantReconciliationReport> {
    const expired = await this.closeGrants(
      await this.authzRepo.findExpiredUnrevokedGrants(now),
      now,
      'expired',
      'grant.expired',
    );
    const orphaned = await this.closeGrants(
      await this.authzRepo.findOrphanedDelegations(),
      now,
      'parent_revoked',
      'grant.delegation_revoked',
    );
    const withoutMembership = await this.closeGrants(
      await this.authzRepo.findGrantsWithoutActiveMembership(),
      now,
      'membership_ended',
      'grant.revoked',
    );

    const report: GrantReconciliationReport = {
      expired: expired.closed,
      orphanedDelegations: orphaned.closed,
      withoutMembership: withoutMembership.closed,
      failed: expired.failed + orphaned.failed + withoutMembership.failed,
    };
    this.logger.log(
      `grants reconciled: ${report.expired.length} expired, ${report.orphanedDelegations.length} orphaned, ${report.withoutMembership.length} without membership, ${report.failed} failed`,
    );
    return report;
  }

  /** Close each grant in its own transaction; returns the closed ids and the failure count. */
  private async closeGrants(
    rows: GrantRow[],
    now: Date,
    reason: 'expired' | 'parent_revoked' | 'membership_ended',
    action: 'grant.expired' | 'grant.delegation_revoked' | 'grant.revoked',
  ): Promise<{ closed: string[]; failed: number }> {
    const closed: GrantRow[] = [];
    let failed = 0;
    for (const g of rows) {
      try {
        const revoked = await this.dbs.withTransaction(async (tx) => {
          // Empty when another path revoked it meanwhile: that path audited it.
          const ids = await this.authzRepo.revokeGrants([g.id], { at: now, byUserId: null, reason }, tx);
          if (ids.length === 0) return false;
          await this.audit.record(
            {
              action,
              actorUserId: null,
              actorKind: 'JOB',
              orgId: g.scopeOrgId,
              recordType: 'grant',
              recordId: g.id,
              result: 'ALLOWED',
              details: { reason, subjectUserId: g.subjectUserId, templateKey: g.templateKey, job: 'grants.reconcile' },
              occurredAt: now,
            },
            { tx },
          );
          return true;
        });
        if (revoked) closed.push(g);
      } catch (err) {
        failed += 1;
        const name = err instanceof Error ? err.name : 'unknown error';
        this.logger.warn(`grant ${g.id} not closed (${name}); retried on the next run`);
      }
    }
    if (closed.length === 0) return { closed: [], failed };

    const bySubject = new Map<string, Set<string>>();
    for (const g of closed) {
      const orgs = bySubject.get(g.subjectUserId) ?? new Set<string>();
      if (g.scopeOrgId) orgs.add(g.scopeOrgId);
      bySubject.set(g.subjectUserId, orgs);
    }
    for (const [userId, orgs] of bySubject) {
      await this.principals.invalidateUser(userId, [...orgs]);
    }
    // Delegatees of the closed grants cache them as ancestors (a grant closed
    // without its tree, e.g. without membership, leaves active children).
    const closedIds = closed.map((g) => g.id);
    await this.principals.invalidateDelegatees(closedIds);
    return { closed: closedIds, failed };
  }

  /**
   * Emergency access sweeper (4.7 lifecycle rule 5, every 15 minutes):
   * approved, unrevoked records whose `expiresAt` has passed get
   * `revokedAt = now` with no revoking user, an `emergency_access.expired`
   * audit event and a cache invalidation. Secondary enforcement only:
   * `findActiveEmergencyAccess` already ignores expired rows on every request.
   * Each record is revoked in its own transaction with its audit row; one
   * that throws is rolled back, logged by id, counted in `failed` and retried
   * on the next run, and the sweep continues with the next record.
   */
  async sweepExpiredEmergencyAccess(now = new Date()): Promise<EmergencySweepReport> {
    const rows = await this.authzRepo.findExpiredApprovedEmergencyAccess(now);
    const expired: string[] = [];
    let failed = 0;
    for (const row of rows) {
      let revoked: boolean;
      try {
        revoked = await this.dbs.withTransaction(async (tx) => {
          // Null when a manual revoke won the race: that path already audited.
          if (!(await this.authzRepo.revokeEmergencyAccess(row.id, null, now, tx))) return false;
          await this.audit.record(
            {
              action: 'emergency_access.expired',
              actorUserId: null,
              actorKind: 'JOB',
              recordType: 'emergency_access',
              recordId: row.id,
              result: 'ALLOWED',
              details: { userId: row.userId, scopeKind: row.scopeKind, scopeId: row.scopeId, job: 'emergency.sweep-expired' },
              occurredAt: now,
            },
            { tx },
          );
          return true;
        });
      } catch (err) {
        failed += 1;
        const name = err instanceof Error ? err.name : 'unknown error';
        this.logger.warn(`emergency access ${row.id} not swept (${name}); retried on the next run`);
        continue;
      }
      if (!revoked) continue;
      await this.principals.invalidateUser(row.userId);
      expired.push(row.id);
    }
    this.logger.log(`emergency access swept: ${expired.length} expired, ${failed} failed`);
    return { expired, failed };
  }

  /**
   * Session TTL-drift reconciliation (SESS-R-16, T-2.10). A session key's TTL
   * is its remaining absolute lifetime, but a key that outlived
   * `absoluteExpiresAt` (a lost TTL, a restore, a write that reset it) would
   * otherwise live on until someone presents its cookie. Each such record is
   * destroyed through `SessionService.destroyOwnedByHash`, which revokes the
   * encrypted refresh token, removes the hash from the user's session set and
   * publishes the invalidation. A record that does not parse, or lacks a
   * user id or a valid expiry, is counted in `scanned` and left alone. A
   * record whose read or destroy throws is logged by hash, counted in
   * `failed`, and the run continues with the next key.
   */
  async reconcileSessionTtl(now = new Date()): Promise<SessionTtlReport> {
    const report: SessionTtlReport = { job: 'sessions.reconcile-ttl', scanned: 0, destroyed: [], failed: 0 };
    const prefix = sessionKey('');
    const keys = await this.store.scan(sessionKey('*'));
    for (const key of keys) {
      report.scanned += 1;
      const hash = key.slice(prefix.length);
      try {
        const raw = await this.store.get(key);
        if (!raw) continue;
        const record = parseSessionExpiry(raw);
        if (!record || record.absoluteExpiresAt >= now.getTime()) continue;
        if (await this.sessions.destroyOwnedByHash(record.userId, hash)) {
          report.destroyed.push(hash);
        }
      } catch (err) {
        report.failed += 1;
        const reason = err instanceof Error ? err.name : 'unknown error';
        this.logger.warn(`session ${hash} not reconciled (${reason}); retried on the next run`);
      }
    }
    this.logger.log(
      `sessions reconciled: ${report.scanned} scanned, ${report.destroyed.length} destroyed, ${report.failed} failed`,
    );
    return report;
  }

  /**
   * SSO signing-certificate expiry (3.4.10, nightly). For every ACTIVE
   * connection:
   * - a SAML connection with a `metadataUrl` has its metadata fetched every
   *   night through the `MetadataFetcher` (https only, public addresses only,
   *   5 s, 1 MiB) and `certificateExpiresAt` set to what the document carries:
   *   certificates rotate, so a stored date goes stale. Cognito cannot help
   *   here: for a metadata-URL provider it returns the URL, not the file;
   * - a SAML connection registered from metadata XML without a known expiry
   *   is looked up with `describeProvider`; an expiry the provider reports is
   *   stored;
   * - a certificate that expires within `SSO_CERTIFICATE_WARNING_DAYS`, or has
   *   already expired, is audited as `sso_connection.changed` with reason
   *   `certificate_expiring` (actor JOB, the connection's organization) and
   *   logged as a warning. The row is written in its own transaction, so an
   *   insert that fails rejects (the pool path would only log it); once the
   *   transaction committed, `ops_certificate_alert` is mailed to
   *   `OPS_ALERT_EMAIL` (English) at most once per connection in
   *   `SSO_CERT_ALERT_TTL`. Without `OPS_ALERT_EMAIL` the run audits and logs
   *   as before and warns once that alert mail is off. Staff then ask the
   *   employer for new metadata.
   * A refresh that fails (the fetch, the provider lookup or the write throws,
   * or the fetched metadata has no signing certificate) is counted in
   * `failed` and logged, and the connection is still checked against its
   * stored expiry: an outage at the IdP never hides a known expiring date.
   * An audit transaction or an alert that fails is counted in `failed` too.
   * Everything failed is retried on the next run, nothing within the run.
   * Logs and audit details carry the provider name, dates and ids only,
   * never the metadata URL or document.
   */
  async checkSsoCertificates(now = new Date()): Promise<SsoCertificateReport> {
    const report: SsoCertificateReport = {
      job: 'sso.certificate-expiry',
      scanned: 0,
      refreshed: 0,
      expiring: 0,
      alerted: 0,
      failed: 0,
    };
    const opsAlertEmail = this.config.get<string>('OPS_ALERT_EMAIL');
    let unmailed = 0;
    const connections = await this.ssoRepo.listActiveConnections();
    for (const conn of connections) {
      report.scanned += 1;
      // A refresh that fails leaves the stored date, which is checked all the same.
      let expiresAt = conn.certificateExpiresAt;
      try {
        const refresh = await this.refreshCertificateExpiry(conn);
        if (refresh.kind === 'no_certificate') {
          report.failed += 1;
          this.logger.warn(
            `SSO connection ${conn.cognitoProviderName}: no certificate in metadata; the stored expiry is checked, retried on the next run`,
          );
        } else {
          expiresAt = refresh.expiresAt;
          if (refresh.written) report.refreshed += 1;
        }
      } catch (err) {
        report.failed += 1;
        this.logger.warn(
          `SSO connection ${conn.cognitoProviderName}: certificate expiry not refreshed (${metadataFailureLabel(err)}); the stored expiry is checked, retried on the next run`,
        );
      }
      if (!expiresAt) continue;
      const msLeft = expiresAt.getTime() - now.getTime();
      if (msLeft > SSO_CERTIFICATE_WARNING_DAYS * DAY_MS) continue;
      const daysLeft = Math.floor(msLeft / DAY_MS);
      const event: AuditEventInput = {
        action: 'sso_connection.changed',
        actorUserId: null,
        actorKind: 'JOB',
        orgId: conn.orgId,
        recordType: 'sso_connection',
        recordId: conn.id,
        result: 'ALLOWED',
        details: {
          reason: 'certificate_expiring',
          expiresAt: expiresAt.toISOString(),
          connectionId: conn.id,
          daysLeft,
          job: 'sso.certificate-expiry',
        },
        occurredAt: now,
      };
      try {
        // In a transaction, as the other jobs write theirs: a failed insert throws.
        await this.dbs.withTransaction((tx) => this.audit.record(event, { tx }));
      } catch (err) {
        report.failed += 1;
        const reason = err instanceof Error ? err.name : 'unknown error';
        this.logger.warn(`SSO connection ${conn.cognitoProviderName}: expiry audit not written (${reason})`);
        continue;
      }
      report.expiring += 1;
      this.logger.warn(
        daysLeft < 0
          ? `SSO connection ${conn.cognitoProviderName}: signing certificate expired on ${expiresAt.toISOString()}`
          : `SSO connection ${conn.cognitoProviderName}: signing certificate expires on ${expiresAt.toISOString()} (${daysLeft} days left)`,
      );

      // The audit row is committed: now the mail (never before, never inside a transaction).
      if (!opsAlertEmail) {
        unmailed += 1;
        continue;
      }
      try {
        if (await this.mailCertificateAlert(conn, opsAlertEmail, expiresAt, daysLeft, now)) report.alerted += 1;
      } catch (err) {
        report.failed += 1;
        const reason = err instanceof Error ? err.name : 'unknown error';
        this.logger.warn(
          `SSO connection ${conn.cognitoProviderName}: expiry alert not sent (${reason}); retried on the next run`,
        );
      }
    }
    if (unmailed > 0) {
      this.logger.warn(
        `SSO certificate alert mail is off (OPS_ALERT_EMAIL is not set): ${unmailed} expiring connection(s) audited and logged only`,
      );
    }
    this.logger.log(
      `SSO certificates: ${report.scanned} scanned, ${report.refreshed} refreshed, ${report.expiring} expiring, ${report.alerted} alerted, ${report.failed} failed`,
    );
    return report;
  }

  /**
   * The certificate expiry to check for one connection, stored first when it
   * changed (`written`): the expiry the fetched metadata carries for a
   * metadata-URL SAML connection (`no_certificate` when it has no readable
   * signing certificate, so a stored date is never erased), the identity
   * provider's answer for a metadata-XML one whose expiry is unknown, the
   * stored value otherwise. Throws when the fetch, the lookup or the write
   * fails.
   */
  private async refreshCertificateExpiry(conn: SsoConnectionRow): Promise<CertificateRefresh> {
    const stored = conn.certificateExpiresAt;
    if (conn.protocol !== 'SAML') return { kind: 'expiry', expiresAt: stored, written: false };
    if (conn.metadataUrl) {
      const fetched = certificateExpiryFromMetadata(await this.metadata.fetchXml(conn.metadataUrl));
      if (!fetched) return { kind: 'no_certificate' };
      if (fetched.getTime() === stored?.getTime()) return { kind: 'expiry', expiresAt: stored, written: false };
      await this.ssoRepo.updateConnection(conn.id, { certificateExpiresAt: fetched });
      return { kind: 'expiry', expiresAt: fetched, written: true };
    }
    if (stored) return { kind: 'expiry', expiresAt: stored, written: false };
    const info = await this.idp.describeProvider(conn.cognitoProviderName);
    if (!info?.certificateExpiresAt) return { kind: 'expiry', expiresAt: null, written: false };
    await this.ssoRepo.updateConnection(conn.id, { certificateExpiresAt: info.certificateExpiresAt });
    return { kind: 'expiry', expiresAt: info.certificateExpiresAt, written: true };
  }

  /**
   * Mails `ops_certificate_alert` unless one went out for this connection
   * within `SSO_CERT_ALERT_TTL`; returns whether it did. The key is taken
   * (NX) before the send, so overlapping runs cannot both mail, and deleted
   * again when the send throws, so the next run retries.
   */
  private async mailCertificateAlert(
    conn: SsoConnectionRow,
    to: string,
    expiresAt: Date,
    daysLeft: number,
    now: Date,
  ): Promise<boolean> {
    const key = ssoCertAlertKey(conn.id);
    const taken = await this.store.set(key, now.toISOString(), { ttlSeconds: SSO_CERT_ALERT_TTL, onlyIfAbsent: true });
    if (!taken) return false;
    try {
      const organization = await this.organizations.findById(conn.orgId);
      await this.mailer.send({
        to,
        locale: 'en',
        template: 'ops_certificate_alert',
        data: {
          organizationName: organization?.name ?? conn.orgId,
          providerName: conn.cognitoProviderName,
          expiresAt: expiresAt.toISOString(),
          daysLeft: String(daysLeft),
          adminUrl: `${surfaceOrigin(this.config, 'admin')}/sso`,
        },
      });
    } catch (err) {
      // A release that fails too only delays the retry until the key expires.
      await this.store.del(key).catch(() => undefined);
      throw err;
    }
    return true;
  }

  /**
   * Mobile token families not seen for 30 days (AUTHZ-R-64, D-07). The
   * bearer verifier refreshes `mobile_family:{jti}` on every request with a
   * 30-day TTL, so a family whose key is gone is stale. The API never holds
   * the device's refresh token, so "revoking" means denylisting the family
   * (`revoked_family:{jti}`) for longer than any mobile refresh token lives,
   * dropping it from the user's family set and auditing the event.
   */
  async pruneStaleMobileFamilies(): Promise<StaleFamilyReport> {
    const report: StaleFamilyReport = { usersScanned: 0, familiesChecked: 0, revoked: [] };
    const setKeys = await this.store.scan(userMobileFamiliesKey('*'));
    for (const setKey of setKeys) {
      const userId = setKey.slice(userMobileFamiliesKey('').length);
      report.usersScanned += 1;
      const families = await this.store.sMembers(setKey);
      for (const originJti of families) {
        report.familiesChecked += 1;
        const lastSeen = await this.store.get(mobileFamilyKey(originJti));
        if (lastSeen) continue;
        await this.store.set(revokedFamilyKey(originJti), new Date().toISOString(), {
          ttlSeconds: STALE_FAMILY_DENYLIST_TTL,
        });
        await this.store.sRem(setKey, originJti);
        await this.audit.record({
          action: 'auth.mobile_family.revoked',
          actorUserId: null,
          actorKind: 'JOB',
          recordType: 'token_family',
          recordId: originJti,
          result: 'ALLOWED',
          details: { userId, reason: 'stale_30d', job: 'mobile.prune-stale-families' },
        });
        report.revoked.push({ userId, originJti });
      }
    }
    this.logger.log(
      `mobile families: ${report.familiesChecked} checked across ${report.usersScanned} users, ${report.revoked.length} revoked`,
    );
    return report;
  }
}

/** The two fields the TTL reconciliation needs, or null for a malformed record. */
function parseSessionExpiry(raw: string): { userId: string; absoluteExpiresAt: number } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { userId, absoluteExpiresAt } = parsed as { userId?: unknown; absoluteExpiresAt?: unknown };
  if (typeof userId !== 'string' || typeof absoluteExpiresAt !== 'string') return null;
  const expiresAt = Date.parse(absoluteExpiresAt);
  return Number.isNaN(expiresAt) ? null : { userId, absoluteExpiresAt: expiresAt };
}
