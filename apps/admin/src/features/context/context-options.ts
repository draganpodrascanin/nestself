/**
 * The contexts a principal may switch to, derived from the `availableContexts`
 * array that the API returns in every `MeResponse`. Using the API's list
 * instead of deriving from `principal.memberships` guarantees the picker
 * never offers a context that `POST /auth/context` would reject.
 *
 * For employees with only an `employee` grant (workspace: `'employee'`), the
 * API emits personal entries per org, not organization entries. For users
 * with organization-workspace grants (e.g. `hr_admin`), it also emits
 * organization entries.
 */
import type { ActiveContext, AvailableContextEntry } from '@nestself/contracts';

export type ContextOption =
  | { key: `personal:${string}`; context: ActiveContext; orgName: string }
  | { key: `organization:${string}`; context: ActiveContext; orgName: string }
  | { key: 'expert'; context: ActiveContext }
  | { key: 'operations'; context: ActiveContext };

/**
 * Build the picker options from the `availableContexts` array of a
 * `MeResponse`. The order follows the API's deterministic sort: personal
 * entries first, then organization, then expert, then operations.
 */
export function contextOptions(
  availableContexts: readonly AvailableContextEntry[],
): ContextOption[] {
  const options: ContextOption[] = [];
  for (const entry of availableContexts) {
    switch (entry.kind) {
      case 'personal':
        options.push({
          key: `personal:${entry.orgId}`,
          context: { kind: 'personal', orgId: entry.orgId },
          orgName: entry.orgName ?? entry.orgId,
        });
        break;
      case 'organization':
        options.push({
          key: `organization:${entry.orgId}`,
          context: { kind: 'organization', orgId: entry.orgId },
          orgName: entry.orgName ?? entry.orgId,
        });
        break;
      case 'expert':
        options.push({ key: 'expert', context: { kind: 'expert' } });
        break;
      case 'operations':
        options.push({ key: 'operations', context: { kind: 'operations' } });
        break;
    }
  }
  return options;
}

/**
 * Two contexts are the same when they share the kind and, for personal and
 * organization contexts, the same orgId.
 */
export function sameContext(a: ActiveContext, b: ActiveContext): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'personal' && b.kind === 'personal') {
    return (a.orgId ?? undefined) === (b.orgId ?? undefined);
  }
  if (a.kind === 'organization' && b.kind === 'organization') {
    return a.orgId === b.orgId;
  }
  return true; // expert, operations
}
