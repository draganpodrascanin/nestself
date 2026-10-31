/**
 * Sample-mode data for the access screens, derived from the shared fixtures.
 * Nothing here is created or sent anywhere.
 */
import { SAMPLE_EDITORIAL_STAFF, SAMPLE_GRANTS, SAMPLE_PEOPLE } from '@nestself/sample-data';
import type { GrantResponse, UserAccessContext } from '@nestself/contracts';
import { grantStatus } from './access-labels';
import type { AccessMember } from './access-labels';

export function sampleOrgGrants(orgId: string): GrantResponse[] {
  return SAMPLE_GRANTS.filter((g) => g.scopeOrgId === orgId);
}

/** Grants without an organization: staff and expert templates. */
export function samplePlatformGrants(): GrantResponse[] {
  return SAMPLE_GRANTS.filter((g) => g.scopeOrgId === null);
}

export function sampleMembers(orgId: string): AccessMember[] {
  return SAMPLE_PEOPLE.filter((p) => p.orgId === orgId).map((p) => ({
    userId: p.id,
    displayName: p.displayName,
  }));
}

/** Every sample person, for naming the subjects of platform grants. */
export function samplePeople(): AccessMember[] {
  return [...SAMPLE_PEOPLE, ...SAMPLE_EDITORIAL_STAFF].map((p) => ({ userId: p.id, displayName: p.displayName }));
}

/**
 * What `userAccess` would return for a sample person: one context per
 * organization (or the platform) their active sample grants cover. `null`
 * when the id is not a sample person, like the API's 404.
 */
export function sampleUserAccess(userId: string): UserAccessContext[] | null {
  if (![...SAMPLE_PEOPLE, ...SAMPLE_EDITORIAL_STAFF].some((p) => p.id === userId)) return null;
  const contexts = new Map<string | null, UserAccessContext>();
  for (const g of SAMPLE_GRANTS) {
    if (g.subjectUserId !== userId || grantStatus(g) !== 'active') continue;
    const context = contexts.get(g.scopeOrgId) ?? { orgId: g.scopeOrgId, actions: [], grantIds: [], assignmentIds: [] };
    for (const a of g.actions) if (!context.actions.includes(a)) context.actions.push(a);
    context.grantIds.push(g.id);
    contexts.set(g.scopeOrgId, context);
  }
  return [...contexts.values()];
}
