/**
 * Sample-mode data for the access screen, derived from the shared fixtures.
 * Nothing here is created or sent anywhere.
 */
import { SAMPLE_GRANTS, SAMPLE_ORG_UNITS, SAMPLE_PEOPLE } from '@nestself/sample-data';
import type { GrantResponse } from '@nestself/contracts';
import { grantStatus } from './access-labels';
import type { AccessMember, AccessOrgUnit } from './access-labels';

export function sampleGrants(orgId: string): GrantResponse[] {
  return SAMPLE_GRANTS.filter((g) => g.scopeOrgId === orgId);
}

export function sampleMembers(orgId: string): AccessMember[] {
  return SAMPLE_PEOPLE.filter((p) => p.orgId === orgId).map((p) => ({
    userId: p.id,
    displayName: p.displayName,
  }));
}

export function sampleOrgUnits(orgId: string): AccessOrgUnit[] {
  return SAMPLE_ORG_UNITS.filter((u) => u.orgId === orgId).map((u) => ({ id: u.id, name: u.name }));
}

/** The actions the active sample grants give a person in the organization. */
export function sampleEffectiveActions(orgId: string, userId: string): string[] {
  const actions = new Set<string>();
  for (const g of sampleGrants(orgId)) {
    if (g.subjectUserId === userId && grantStatus(g) === 'active') {
      for (const a of g.actions) actions.add(a);
    }
  }
  return [...actions];
}
