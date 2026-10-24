/**
 * MaintenanceJobsService — the scheduled reconciliation work the auth strategy
 * asks for (D-07, D-17, D-21, AUTHZ-R-64, T-2.10). Every method is a plain,
 * idempotent unit of work that reports what it changed; `JobSchedulerService`
 * runs them on a schedule in the worker process and `scripts/run-job.ts` runs
 * one on demand. Nothing here runs on a request path.
 *
 * Jobs run in system context (no tenant setting): they must see every
 * organization. Every change is written to the audit log with
 * `actorKind: 'JOB'` and invalidates the affected principal caches.
 */
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';

import { AuthorizationRepository, type GrantRow } from '../db/repositories/authorization.repository.js';
import { AuditRepository } from '../db/repositories/audit.repository.js';
import { AuditWriter } from '../audit/audit-writer.js';
import { PrincipalLoader } from '../principal/principal-loader.js';
import { KEY_VALUE_STORE, type KeyValueStore } from '../redis/key-value-store.js';
import {
  STALE_FAMILY_DENYLIST_TTL,
  mobileFamilyKey,
  revokedFamilyKey,
  sessionKey,
  userMobileFamiliesKey,
} from '../redis/redis-keys.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { SessionService } from '../session/session.service.js';

/** Months of `audit_events` partitions kept ahead of today (D-21). */
export const AUDIT_PARTITION_MONTHS_AHEAD = 3;

export const MAINTENANCE_JOB_NAMES = [
  'audit.ensure-partitions',
  'grants.reconcile',
  'mobile.prune-stale-families',
  'emergency.sweep-expired',
  'sessions.reconcile-ttl',
] as const;
export type MaintenanceJobName = (typeof MAINTENANCE_JOB_NAMES)[number];

export function isMaintenanceJobName(value: string): value is MaintenanceJobName {
  return (MAINTENANCE_JOB_NAMES as readonly string[]).includes(value);
}

export interface GrantReconciliationReport {
  expired: string[];
  orphanedDelegations: string[];
  withoutMembership: string[];
}

export interface StaleFamilyReport {
  usersScanned: number;
  familiesChecked: number;
  revoked: Array<{ userId: string; originJti: string }>;
}

export interface EmergencySweepReport {
  expired: string[];
}

export interface SessionTtlReport {
  job: 'sessions.reconcile-ttl';
  scanned: number;
  /** Hashes of the destroyed sessions (the id the session list exposes). */
  destroyed: string[];
  /** Records whose read or destroy threw; logged by hash and retried on the next run. */
  failed: number;
}

export type MaintenanceReport =
  | { job: 'audit.ensure-partitions'; partitions: string[] }
  | ({ job: 'grants.reconcile' } & GrantReconciliationReport)
  | ({ job: 'mobile.prune-stale-families' } & StaleFamilyReport)
  | ({ job: 'emergency.sweep-expired' } & EmergencySweepReport)
  | SessionTtlReport;

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
   * Every change is audited and the subject's caches are invalidated.
   */
  async reconcileGrants(now = new Date()): Promise<GrantReconciliationReport> {
    const expired = await this.authzRepo.findExpiredUnrevokedGrants(now);
    await this.closeGrants(expired, now, 'expired', 'grant.expired');

    const orphaned = await this.authzRepo.findOrphanedDelegations();
    await this.closeGrants(orphaned, now, 'parent_revoked', 'grant.delegation_revoked');

    const withoutMembership = await this.authzRepo.findGrantsWithoutActiveMembership();
    await this.closeGrants(withoutMembership, now, 'membership_ended', 'grant.revoked');

    const report = {
      expired: expired.map((g) => g.id),
      orphanedDelegations: orphaned.map((g) => g.id),
      withoutMembership: withoutMembership.map((g) => g.id),
    };
    this.logger.log(
      `grants reconciled: ${report.expired.length} expired, ${report.orphanedDelegations.length} orphaned, ${report.withoutMembership.length} without membership`,
    );
    return report;
  }

  private async closeGrants(
    rows: GrantRow[],
    now: Date,
    reason: 'expired' | 'parent_revoked' | 'membership_ended',
    action: 'grant.expired' | 'grant.delegation_revoked' | 'grant.revoked',
  ): Promise<void> {
    if (rows.length === 0) return;
    await this.authzRepo.revokeGrants(
      rows.map((g) => g.id),
      { at: now, byUserId: null, reason },
    );
    for (const g of rows) {
      await this.audit.record({
        action,
        actorUserId: null,
        actorKind: 'JOB',
        orgId: g.scopeOrgId,
        recordType: 'grant',
        recordId: g.id,
        result: 'ALLOWED',
        details: { reason, subjectUserId: g.subjectUserId, templateKey: g.templateKey, job: 'grants.reconcile' },
        occurredAt: now,
      });
    }
    const bySubject = new Map<string, Set<string>>();
    for (const g of rows) {
      const orgs = bySubject.get(g.subjectUserId) ?? new Set<string>();
      if (g.scopeOrgId) orgs.add(g.scopeOrgId);
      bySubject.set(g.subjectUserId, orgs);
    }
    for (const [userId, orgs] of bySubject) {
      await this.principals.invalidateUser(userId, [...orgs]);
    }
    // Delegatees of the closed grants cache them as ancestors (a grant closed
    // without its tree, e.g. without membership, leaves active children).
    await this.principals.invalidateDelegatees(rows.map((g) => g.id));
  }

  /**
   * Emergency access sweeper (4.7 lifecycle rule 5, every 15 minutes):
   * approved, unrevoked records whose `expiresAt` has passed get
   * `revokedAt = now` with no revoking user, an `emergency_access.expired`
   * audit event and a cache invalidation. Secondary enforcement only:
   * `findActiveEmergencyAccess` already ignores expired rows on every request.
   */
  async sweepExpiredEmergencyAccess(now = new Date()): Promise<EmergencySweepReport> {
    const rows = await this.authzRepo.findExpiredApprovedEmergencyAccess(now);
    const expired: string[] = [];
    for (const row of rows) {
      // Null when a manual revoke won the race: that path already audited.
      const revoked = await this.authzRepo.revokeEmergencyAccess(row.id, null, now);
      if (!revoked) continue;
      await this.audit.record({
        action: 'emergency_access.expired',
        actorUserId: null,
        actorKind: 'JOB',
        recordType: 'emergency_access',
        recordId: row.id,
        result: 'ALLOWED',
        details: { userId: row.userId, scopeKind: row.scopeKind, scopeId: row.scopeId, job: 'emergency.sweep-expired' },
        occurredAt: now,
      });
      await this.principals.invalidateUser(row.userId);
      expired.push(row.id);
    }
    this.logger.log(`emergency access swept: ${expired.length} expired`);
    return { expired };
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
