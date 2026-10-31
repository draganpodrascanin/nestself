/**
 * PrincipalLoader — resolves a userId to a LoadedPrincipal.
 *
 * Caches at `principal:{userId}` for 30 s +/- 5 s jitter.
 * Grants at `grants:{userId}:{orgId}` for 60 s +/- 10 s jitter. The entry
 * holds the subject's grants plus the delegation ancestors of its delegated
 * grants, so a change to an ancestor (held by another user) reaches it only
 * through the delegatee's own `invalidateUser` call: every path that revokes
 * or adjusts a grant calls `invalidateDelegatees` (GrantsService revoke and
 * update, MembersService.endMembership, the grants reconciliation job).
 * Assignments at `assignments:{userId}` for 60 s +/- 10 s jitter.
 * Org tree at `org_tree:{orgId}` for 5 min +/- 30 s jitter.
 *
 * @see T-1.7, D-18, AUTHZ-R-44, AUTHZ-R-45, AUTH-R-11
 */
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
 
import { IdentityRepository } from '../db/repositories/identity.repository.js';
import { AuthorizationRepository } from '../db/repositories/authorization.repository.js';
 
import { CacheGateway } from './cache-gateway.js';
import {
  KEY_VALUE_STORE,
  type KeyValueStore,
} from '../redis/key-value-store.js';
import {
  principalKey,
  grantsKey,
  assignmentsKey,
  orgTreeKey,
  contextExtrasKey,
  PRINCIPAL_TTL_BASE,
  PRINCIPAL_TTL_JITTER,
  GRANTS_TTL_BASE,
  GRANTS_TTL_JITTER,
  ASSIGNMENTS_TTL,
  ORG_TREE_TTL,
  CONTEXT_EXTRAS_TTL_BASE,
  CONTEXT_EXTRAS_TTL_JITTER,
  INVALIDATE_CHANNEL,
} from '../redis/redis-keys.js';
import type {
  PrincipalMembership,
  GrantInput,
  AssignmentInput,
  GrantCondition,
} from '@nestself/contracts';
import { PERMISSION_TEMPLATES } from '@nestself/contracts';
import { isMembershipDateCurrent } from '../authz/personal-context.js';
import type { AvailableContextExtras } from '../authz/personal-context.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LoadedPrincipal {
  userId: string;
  displayName: string;
  initials: string;
  locale: string;
  memberships: PrincipalMembership[];
  staffTemplates: string[];
  expert: { id: string; approvedCategories: string[] } | null;
  isSuspended: boolean;
  isDeactivated: boolean;
  populationHints: {
    hasStaffGrants: boolean;
    hasExpertGrants: boolean;
    hasActiveMembership: boolean;
  };
}

export interface OrgTreeEntry {
  ancestorIds: string[];
  selfApprovalAllowed: boolean;
  timezone: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jitter(base: number, range: number): number {
  return base + Math.floor(Math.random() * (range * 2 + 1)) - range;
}

function computeInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0]!.toUpperCase());
  return letters.join('') || '?';
}

/** True when a cached principal has the fields the current code reads. */
function hasCurrentShape(p: LoadedPrincipal): boolean {
  return (
    Array.isArray(p.memberships) &&
    p.memberships.every((m) => typeof m.orgName === 'string' && m.orgName.length > 0)
  );
}

/** Adapts DB-level membership to the shared currency check from personal-context. */
function isMembershipActive(
  status: string,
  startDate: Date,
  endDate: Date | null,
  now: Date,
): boolean {
  return isMembershipDateCurrent(
    {
      status: status as 'ACTIVE' | 'INVITED',
      startDate: startDate.toISOString(),
      endDate: endDate?.toISOString() ?? null,
    },
    now,
  );
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class PrincipalLoader {
  private readonly logger = new Logger(PrincipalLoader.name);

  constructor(
    @Inject(forwardRef(() => IdentityRepository)) private readonly identities: IdentityRepository,
    @Inject(forwardRef(() => AuthorizationRepository)) private readonly authzRepo: AuthorizationRepository,
    @Inject(forwardRef(() => CacheGateway)) private readonly cache: CacheGateway,
    @Inject(KEY_VALUE_STORE) private readonly store: KeyValueStore,
  ) {}

  /** Load principal data for a user. Returns null if the user does not exist. */
  async load(userId: string): Promise<LoadedPrincipal | null> {
    const cacheKey = principalKey(userId);

    // Try cache first
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as LoadedPrincipal;
        // Entries written before memberships carried orgName are a miss, so
        // a rolling deploy never serves the older shape.
        if (hasCurrentShape(parsed)) return parsed;
      } catch {
        // Corrupted cache entry — fall through
      }
    }

    // Load from Postgres
    const user = await this.identities.findUserForPrincipal(userId);

    if (!user) return null;

    const now = new Date();

    // Compute memberships
    const memberships: PrincipalMembership[] = [];
    for (const m of user.memberships) {
      if (m.status === 'ENDED') continue;
      const active = isMembershipActive(m.status, m.startDate, m.endDate, now);
      if (m.status === 'INVITED' || active) {
        memberships.push({
          membershipId: m.id,
          orgId: m.orgId,
          orgName: m.org.name,
          orgUnitId: m.orgUnitId,
          status: active ? 'ACTIVE' : 'INVITED',
          startDate: m.startDate.toISOString(),
          endDate: m.endDate?.toISOString() ?? null,
        });
      }
    }

    // Compute staff templates from grants
    const staffTemplateKeys = new Set<string>(
      PERMISSION_TEMPLATES.filter((t) => t.population === 'staff').map((t) => t.key),
    );
    const activeTemplateKeys = await this.authzRepo.findActiveGrantTemplateKeys(userId, now);
    const staffTemplates: string[] = [
      ...new Set(activeTemplateKeys.filter((key) => staffTemplateKeys.has(key))),
    ];

    // Compute expert
    const expert = user.expert ?? null;
    let expertData: LoadedPrincipal['expert'] = null;
    if (expert) {
      expertData = {
        id: expert.id,
        approvedCategories: await this.authzRepo.findApprovedCategories(expert.id, now),
      };
    }

    const loaded: LoadedPrincipal = {
      userId: user.id,
      displayName: user.displayName,
      initials: computeInitials(user.displayName),
      locale: user.locale ?? 'sr-Latn',
      memberships,
      staffTemplates,
      expert: expertData,
      isSuspended: user.suspendedAt != null,
      isDeactivated: user.deactivatedAt != null,
      populationHints: {
        hasStaffGrants: staffTemplates.length > 0,
        hasExpertGrants: expertData != null,
        hasActiveMembership: memberships.some((m) => m.status === 'ACTIVE'),
      },
    };

    // Cache
    const ttl = jitter(PRINCIPAL_TTL_BASE, PRINCIPAL_TTL_JITTER);
    await this.cache.set(cacheKey, JSON.stringify(loaded), ttl);

    return loaded;
  }

  /**
   * Pre-load the extra data that `computeAvailableContexts` needs:
   * per-org grant template keys and org names (Ruling B, T-C1.02).
   */
  async loadAvailableContextExtras(loaded: LoadedPrincipal): Promise<AvailableContextExtras> {
    const orgIds = loaded.memberships
      .filter((m) => m.status === 'ACTIVE')
      .map((m) => m.orgId);

    if (orgIds.length === 0) {
      return { orgGrantTemplateKeys: new Map(), orgNames: new Map() };
    }

    // Item 11 (T-C1.02): cache the extras with the same TTL as the principal
    // so two consecutive /me calls do not query grants and names twice.
    const cacheKey = contextExtrasKey(loaded.userId);
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as {
          orgGrantTemplateKeys: [string, string[]][];
          orgNames: [string, string][];
        };
        return {
          orgGrantTemplateKeys: new Map(parsed.orgGrantTemplateKeys),
          orgNames: new Map(parsed.orgNames),
        };
      } catch {
        // Corrupted cache entry -- fall through
      }
    }

    const now = new Date();
    const [grantRows, orgNames] = await Promise.all([
      this.authzRepo.findActiveOrgGrantTemplateKeys(loaded.userId, orgIds, now),
      this.authzRepo.findOrgNames(orgIds),
    ]);

    const keyMap = new Map<string, string[]>();
    for (const { orgId, templateKey } of grantRows) {
      const arr = keyMap.get(orgId) ?? [];
      arr.push(templateKey);
      keyMap.set(orgId, arr);
    }

    const result: AvailableContextExtras = { orgGrantTemplateKeys: keyMap, orgNames };

    // Serialise Maps for cache storage.
    const ttl = jitter(CONTEXT_EXTRAS_TTL_BASE, CONTEXT_EXTRAS_TTL_JITTER);
    await this.cache.set(cacheKey, JSON.stringify({
      orgGrantTemplateKeys: [...keyMap.entries()],
      orgNames: [...orgNames.entries()],
    }), ttl);

    return result;
  }

  /** Load grants for a user in an org context. */
  async loadGrants(userId: string, orgId: string): Promise<GrantInput[]> {
    const cacheKey = grantsKey(userId, orgId);
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached, reviveDates) as GrantInput[];
      } catch { /* fall through */ }
    }

    // Platform/own-scoped grants (scopeOrgId null) plus org-specific grants.
    const grants = await this.authzRepo.findGrantsForOrg(userId, orgId);

    // The engine validates a delegated grant against its parent chain in
    // ctx.grants, so the chain's grants (held by other users, possibly
    // revoked) travel in the same cached entry. authorize() matches only the
    // subject's own grants; the ancestors serve delegation validation alone.
    const delegatedIds = grants.filter((g) => g.parentGrantId != null).map((g) => g.id);
    const ownIds = new Set(grants.map((g) => g.id));
    const ancestors =
      delegatedIds.length > 0
        ? (await this.authzRepo.findDelegationAncestors(delegatedIds)).filter((g) => !ownIds.has(g.id))
        : [];

    const result: GrantInput[] = [...grants, ...ancestors].map((g) => ({
      id: g.id,
      subjectUserId: g.subjectUserId,
      templateKey: g.templateKey ?? '',
      actions: g.actions,
      scopeType: g.scopeType as GrantInput['scopeType'],
      scopeOrgId: g.scopeOrgId,
      scopeOrgUnitId: g.scopeOrgUnitId,
      includeDescendants: g.includeDescendants,
      scopeRefKind: g.scopeRefKind,
      scopeRefId: g.scopeRefId,
      conditions: (g.conditions ?? []) as GrantCondition[],
      validFrom: g.validFrom,
      validUntil: g.validUntil,
      delegationEnvelope: g.delegationEnvelope as GrantInput['delegationEnvelope'],
      parentGrantId: g.parentGrantId,
      revokedAt: g.revokedAt,
    }));

    const ttl = jitter(GRANTS_TTL_BASE, GRANTS_TTL_JITTER);
    await this.cache.set(cacheKey, JSON.stringify(result), ttl);
    return result;
  }

  /** Load assignments for a user. */
  async loadAssignments(userId: string): Promise<AssignmentInput[]> {
    const cacheKey = assignmentsKey(userId);
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached, reviveDates) as AssignmentInput[];
      } catch { /* fall through */ }
    }

    const now = new Date();
    const assignments = await this.authzRepo.findActiveAssignments(userId, now);

    const result: AssignmentInput[] = assignments.map((a) => ({
      id: a.id,
      userId: a.userId,
      kind: a.kind as AssignmentInput['kind'],
      targetId: a.targetId,
      startAt: a.startAt,
      endAt: a.endAt,
    }));

    const ttl = jitter(ASSIGNMENTS_TTL, 10);
    await this.cache.set(cacheKey, JSON.stringify(result), ttl);
    return result;
  }

  /** Load the org tree (ancestor ids and org settings). */
  async loadOrgTree(orgId: string): Promise<OrgTreeEntry | null> {
    const cacheKey = orgTreeKey(orgId);
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as OrgTreeEntry;
      } catch { /* fall through */ }
    }

    const org = await this.authzRepo.findOrgSettings(orgId);
    if (!org) return null;

    // Load all closure rows where the org's units are descendants.
    const closures = await this.authzRepo.findClosureForOrg(orgId);

    const ancestorIds = [...new Set(closures.map((c) => c.ancestorId))];

    const entry: OrgTreeEntry = {
      ancestorIds,
      selfApprovalAllowed: org.selfApprovalAllowed ?? false,
      timezone: org.timezone ?? 'UTC',
      status: org.status ?? 'ACTIVE',
    };

    const ttl = jitter(ORG_TREE_TTL, 30);
    await this.cache.set(cacheKey, JSON.stringify(entry), ttl);
    return entry;
  }

  /**
   * Invalidate every delegatee below the given grants: the subjects of all
   * grants delegated from them, directly or not, once each, for the
   * organization of their grants (`platform` for grants without one).
   * Their cached grants entry holds copies of these grants as delegation
   * ancestors, so any revocation or adjustment of a grant with delegations
   * calls this after its transaction commits. Reads in the system context.
   * Returns the invalidated user ids.
   */
  async invalidateDelegatees(grantIds: string[]): Promise<string[]> {
    const descendants = await this.authzRepo.findDelegationDescendants(grantIds);
    const orgsBySubject = new Map<string, Set<string>>();
    for (const g of descendants) {
      const orgs = orgsBySubject.get(g.subjectUserId) ?? new Set<string>();
      orgs.add(g.scopeOrgId ?? 'platform');
      orgsBySubject.set(g.subjectUserId, orgs);
    }
    for (const [userId, orgs] of orgsBySubject) {
      await this.invalidateUser(userId, [...orgs]);
    }
    return [...orgsBySubject.keys()];
  }

  /**
   * Invalidate cached data for a user and publish to the invalidate channel.
   * @see AUTH-R-11, AUTHZ-R-44
   */
  async invalidateUser(userId: string, orgIds?: string[]): Promise<void> {
    const keys = [principalKey(userId), assignmentsKey(userId), contextExtrasKey(userId)];
    if (orgIds) {
      for (const orgId of orgIds) {
        keys.push(grantsKey(userId, orgId));
      }
    }
    // Also purge LRU entries matching the user.
    this.cache.purgeLru(`principal:${userId}`);
    this.cache.purgeLru(`grants:${userId}`);
    this.cache.purgeLru(`assignments:${userId}`);
    this.cache.purgeLru(`ctx_extras:${userId}`);

    await this.cache.del(...keys);
    const msg = JSON.stringify({ keys, reason: 'invalidation', userId });
    try {
      await this.store.publish(INVALIDATE_CHANNEL, msg);
    } catch (err) {
      this.logger.warn(`Failed to publish invalidation: ${String(err)}`);
    }
  }
}

/** JSON reviver for Date fields in cached grant/assignment rows. */
function reviveDates(key: string, value: unknown): unknown {
  if (
    typeof value === 'string' &&
    (key === 'validFrom' || key === 'validUntil' || key === 'revokedAt' ||
     key === 'startAt' || key === 'endAt' || key === 'grantedAt' ||
     key === 'expiresAt')
  ) {
    const d = new Date(value);
    return isNaN(d.getTime()) ? value : d;
  }
  return value;
}
