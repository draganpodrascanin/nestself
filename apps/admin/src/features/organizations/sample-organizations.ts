/**
 * Sample-mode clients, derived from the shared fixture. Nothing here is
 * created or sent anywhere.
 */
import { SAMPLE_ORG } from '@nestself/sample-data';
import type { OrganizationResponse } from '@nestself/contracts';

/** The fixture has no creation date; this fixed one is sample data too. */
const SAMPLE_CREATED_AT = '2024-01-01T00:00:00.000Z';

const SAMPLE_ORGANIZATIONS: OrganizationResponse[] = [
  { id: SAMPLE_ORG.id, name: SAMPLE_ORG.name, slug: SAMPLE_ORG.slug, status: 'ACTIVE', createdAt: SAMPLE_CREATED_AT },
];

/** The sample clients whose name or slug starts with `search` (the API's prefix match). */
export function sampleOrganizations(search: string): OrganizationResponse[] {
  const q = search.trim().toLowerCase();
  if (!q) return SAMPLE_ORGANIZATIONS;
  return SAMPLE_ORGANIZATIONS.filter((o) => o.name.toLowerCase().startsWith(q) || o.slug.toLowerCase().startsWith(q));
}

/** One sample client; `null` when the id is not the sample organization, like the API's 404. */
export function sampleOrganization(orgId: string): OrganizationResponse | null {
  return SAMPLE_ORGANIZATIONS.find((o) => o.id === orgId) ?? null;
}
