/**
 * Shared helpers for personal-context resolution (T-C1.02).
 *
 * Consolidates the duplicate `isMembershipDateCurrent`,
 * `hasActiveDateCurrentMembership` and `resolveDefaultPersonalOrgId`
 * implementations that were scattered across three services.
 *
 * @see ACC-R-12, ACC-R-15
 */
import type { PrincipalMembership, AvailableContextEntry } from '@nestself/contracts';

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
  const sorted = [...active].sort(
    (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
  );
  return sorted[0]?.orgId;
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
 * When omitted the function falls back to including an organization entry
 * for every ACTIVE membership (legacy / test paths).
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
  extras?: AvailableContextExtras,
): AvailableContextEntry[] {
  const entries: AvailableContextEntry[] = [];
  const now = new Date();

  for (const m of loaded.memberships) {
    if (!isMembershipDateCurrent(m, now)) continue;
    const orgName = extras?.orgNames.get(m.orgId);
    entries.push({ kind: 'personal', orgId: m.orgId, ...(orgName ? { orgName } : {}) });

    // Organization entry: only when user holds a grant from an
    // organization-workspace template in this org (Ruling B).
    if (extras) {
      const templateKeys = extras.orgGrantTemplateKeys.get(m.orgId) ?? [];
      const hasOrgGrant = templateKeys.some((k) => ORG_WORKSPACE_TEMPLATE_KEYS.has(k));
      if (hasOrgGrant) {
        entries.push({ kind: 'organization', orgId: m.orgId, ...(orgName ? { orgName } : {}) });
      }
    } else {
      // Legacy fallback: include organization entry for every active membership.
      entries.push({ kind: 'organization', orgId: m.orgId });
    }
  }

  if (!entries.some((e) => e.kind === 'personal')) {
    entries.push({ kind: 'personal' });
  }

  if (loaded.expert) entries.push({ kind: 'expert' });
  if (loaded.staffTemplates.length > 0) entries.push({ kind: 'operations' });

  return entries;
}
