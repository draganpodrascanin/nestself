/**
 * The contexts a principal may switch to, in picker order: personal, each
 * organization with an ACTIVE membership (never an invited or ended one,
 * Review Focus 4), expert when the user has an expert record, operations
 * when they hold staff templates. The API applies the same rule again.
 */
import type { ActiveContext, Principal } from '@nestself/contracts';

export type ContextOption =
  | { key: 'personal'; context: ActiveContext }
  | { key: `organization:${string}`; context: ActiveContext; orgName: string }
  | { key: 'expert'; context: ActiveContext }
  | { key: 'operations'; context: ActiveContext };

export function contextOptions(principal: Principal): ContextOption[] {
  const options: ContextOption[] = [{ key: 'personal', context: { kind: 'personal' } }];
  const seen = new Set<string>();
  for (const m of principal.memberships) {
    if (m.status !== 'ACTIVE' || seen.has(m.orgId)) continue;
    seen.add(m.orgId);
    options.push({
      key: `organization:${m.orgId}`,
      context: { kind: 'organization', orgId: m.orgId },
      orgName: m.orgName,
    });
  }
  if (principal.expert) options.push({ key: 'expert', context: { kind: 'expert' } });
  if (principal.staffTemplates.length > 0) options.push({ key: 'operations', context: { kind: 'operations' } });
  return options;
}

export function sameContext(a: ActiveContext, b: ActiveContext): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== 'organization' || (b.kind === 'organization' && a.orgId === b.orgId);
}

