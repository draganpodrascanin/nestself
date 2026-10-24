/**
 * Shared helpers for personal-context resolution (T-C1.02).
 *
 * Consolidates `isMembershipDateCurrent`, `hasActiveDateCurrentMembership`,
 * `resolveDefaultPersonalOrgId`, `defaultContext` (ruling 9), and
 * `computeAvailableContexts` / `canEnterContext` (ruling 3).
 *
 * @see ACC-R-12, ACC-R-15
 */
import type { PrincipalMembership, AvailableContextEntry, ActiveContext } from '@nestself/contracts';

/**
 * A membership is date-current when:
 * - status is ACTIVE
 * - startDate <= now
 * - endDate is null OR endDate > now
 */
export function isMembershipDateCurrent(
  m: Pick<PrincipalMembership, 'status' | 'startDate' | 'endDate'>,
  now: Date = new Date(),
): boolean {
  if (m.status !== 'ACTIVE') return false;
  if (new Date(m.startDate) > now) return false;
  if (m.endDate != null && new Date(m.endDate) <= now) return false;
  return true;
}

/**
 * Check that the user holds an ACTIVE, date-current membership in `orgId`.
 */
export function hasActiveDateCurrentMembership(
  memberships: readonly Pick<PrincipalMembership, 'orgId' | 'status' | 'startDate' | 'endDate'>[],
  orgId: string,
  now: Date = new Date(),
): boolean {
  return memberships.some(
    (m) => m.orgId === orgId && isMembershipDateCurrent(m, now),
  );
}

/**
 * Resolve the default orgId for a personal context (ACC-R-12):
 * the `lastUsed` orgId if it still has an ACTIVE date-current membership,
 * else the ACTIVE date-current membership with the earliest `startDate`.
 */
export function resolveDefaultPersonalOrgId(
  memberships: readonly Pick<PrincipalMembership, 'orgId' | 'status' | 'startDate' | 'endDate'>[],
  lastUsed?: string,
  now: Date = new Date(),
): string | undefined {
  const active = memberships.filter((m) => isMembershipDateCurrent(m, now));

  if (active.length === 0) return undefined;

  if (lastUsed && active.some((m) => m.orgId === lastUsed)) {
    return lastUsed;
  }

  // Earliest startDate among ACTIVE, date-current memberships.
  // Equal startDate ties are broken by orgId ascending (deterministic).
  const sorted = [...active].sort((a, b) => {
    const dateDiff = new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
    if (dateDiff !== 0) return dateDiff;
    return a.orgId.localeCompare(b.orgId);
  });
  return sorted[0]?.orgId;
}

/**
 * Default initial context for a user who has no stored session context
 * (sign-in via bearer token, WS ticket, or first session).
 *
 * Staff -> operations, expert -> expert, everyone else -> personal with
 * a resolved orgId when possible (ACC-R-12).
 */
export function defaultContext(
  loaded: { memberships: readonly Pick<PrincipalMembership, 'orgId' | 'status' | 'startDate' | 'endDate'>[]; staffTemplates: readonly unknown[]; expert: unknown | null },
): ActiveContext {
  if (loaded.staffTemplates.length > 0) return { kind: 'operations' };
  if (loaded.expert) return { kind: 'expert' };
  const orgId = resolveDefaultPersonalOrgId(loaded.memberships);
  return orgId ? { kind: 'personal', orgId } : { kind: 'personal' };
}

/**
 * Build the `availableContexts` array for a MeResponse.
 *
 * - Personal: one entry per ACTIVE date-current membership (with orgName).
 * - Organization: only for an org where the user holds at least one active
 *   grant whose template's `workspace` is `'organization'` (Ruling B).
 * - Expert and operations entries when the user has the capability.
 */
/** Fields read by `computeAvailableContexts`. Both `Principal` and `LoadedPrincipal` satisfy this. */
export interface AvailableContextSource {
  memberships: readonly Pick<PrincipalMembership, 'orgId' | 'status' | 'startDate' | 'endDate'>[];
  staffTemplates: readonly string[];
  expert: { id: string } | null;
}

/**
 * Extra data that callers pre-load from the DB for `computeAvailableContexts`.
 * Required: callers must always load extras (ruling 3, T-C1.02).
 */
export interface AvailableContextExtras {
  /** Active grant template keys per org, from the DB. */
  orgGrantTemplateKeys: ReadonlyMap<string, readonly string[]>;
  /** Org names keyed by orgId. */
  orgNames: ReadonlyMap<string, string>;
}

import { PERMISSION_TEMPLATES } from '@nestself/contracts';

/** Template keys whose workspace is 'organization'. */
const ORG_WORKSPACE_TEMPLATE_KEYS: ReadonlySet<string> = new Set(
  PERMISSION_TEMPLATES
    .filter((t) => t.workspace === 'organization')
    .map((t) => t.key as string),
);

export function computeAvailableContexts(
  loaded: AvailableContextSource,
  extras: AvailableContextExtras,
): AvailableContextEntry[] {
  const entries: AvailableContextEntry[] = [];
  const now = new Date();

  for (const m of loaded.memberships) {
    if (!isMembershipDateCurrent(m, now)) continue;
    const orgName = extras.orgNames.get(m.orgId);
    entries.push({ kind: 'personal', orgId: m.orgId, ...(orgName ? { orgName } : {}) });

    // Organization entry: only when user holds a grant from an
    // organization-workspace template in this org (Ruling B).
    const templateKeys = extras.orgGrantTemplateKeys.get(m.orgId) ?? [];
    const hasOrgGrant = templateKeys.some((k) => ORG_WORKSPACE_TEMPLATE_KEYS.has(k));
    if (hasOrgGrant) {
      entries.push({ kind: 'organization', orgId: m.orgId, ...(orgName ? { orgName } : {}) });
    }
  }

  // No bare {kind:'personal'} fallback (ruling 3): every personal entry
  // carries an orgId. Users with no active memberships have expert,
  // operations, or no available contexts.

  if (loaded.expert) entries.push({ kind: 'expert' });
  if (loaded.staffTemplates.length > 0) entries.push({ kind: 'operations' });

  // Deterministic order: personal entries first (tie-broken by orgId),
  // then organization (tie-broken by orgId), then expert, then operations.
  entries.sort((a, b) => {
    const kindOrder = ['personal', 'organization', 'expert', 'operations'];
    const ki = kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind);
    if (ki !== 0) return ki;
    const aOrg = 'orgId' in a ? a.orgId ?? '' : '';
    const bOrg = 'orgId' in b ? b.orgId ?? '' : '';
    return aOrg.localeCompare(bOrg);
  });

  return entries;
}

/**
 * Check whether a target context is available to enter (ruling 3, T-C1.02).
 * Uses the same `computeAvailableContexts` output so switch acceptance and
 * the available-contexts list are always consistent.
 */
export function canEnterContext(
  available: readonly AvailableContextEntry[],
  target: ActiveContext,
): boolean {
  return available.some((entry) => {
    if (entry.kind !== target.kind) return false;
    if (entry.kind === 'personal' && target.kind === 'personal') {
      return entry.orgId === target.orgId;
    }
    if (entry.kind === 'organization' && target.kind === 'organization') {
      return entry.orgId === target.orgId;
    }
    return true; // expert, operations — no orgId to compare
  });
}
