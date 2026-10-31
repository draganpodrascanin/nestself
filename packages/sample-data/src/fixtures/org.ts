export const SAMPLE_ORG = {
  id: 'org_sample',
  name: 'Example d.o.o.',
  slug: 'example',
  sample: true as const,
} as const;

export const SAMPLE_TEAMS = [
  { id: 'team_product', name: 'Product', orgId: 'org_sample', sample: true as const },
  { id: 'team_operations', name: 'Operations', orgId: 'org_sample', sample: true as const },
  { id: 'team_sales', name: 'Sales', orgId: 'org_sample', sample: true as const },
] as const;

/**
 * Second sample organization (organization B) for the CMS acceptance roles
 * (T-C1.14). Fictional; `SAMPLE_ORG` stays organization A.
 */
export const SAMPLE_ORG_B = {
  id: 'org_sample_b',
  name: 'Example B kft.',
  slug: 'example-b',
  sample: true as const,
} as const;
