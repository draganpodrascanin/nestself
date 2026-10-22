/**
 * Sample org-unit tree for the sample organization.
 *
 * Structure:
 *   org_sample (COMPANY root)
 *   ├── dept_engineering (DEPARTMENT)
 *   │   ├── team_product (TEAM)
 *   │   └── team_operations (TEAM)
 *   └── dept_commercial (DEPARTMENT)
 *       └── team_sales (TEAM)
 *
 * Team org-unit ids intentionally match SAMPLE_TEAMS ids so
 * Membership.orgUnitId can mirror the legacy teamId.
 */
export const SAMPLE_ORG_UNITS = [
  {
    id: 'ou_root',
    orgId: 'org_sample',
    parentId: null,
    kind: 'COMPANY' as const,
    name: 'Example d.o.o.',
    sample: true as const,
  },
  {
    id: 'ou_engineering',
    orgId: 'org_sample',
    parentId: 'ou_root',
    kind: 'DEPARTMENT' as const,
    name: 'Engineering',
    sample: true as const,
  },
  {
    id: 'ou_commercial',
    orgId: 'org_sample',
    parentId: 'ou_root',
    kind: 'DEPARTMENT' as const,
    name: 'Commercial',
    sample: true as const,
  },
  {
    id: 'team_product',
    orgId: 'org_sample',
    parentId: 'ou_engineering',
    kind: 'TEAM' as const,
    name: 'Product',
    sample: true as const,
  },
  {
    id: 'team_operations',
    orgId: 'org_sample',
    parentId: 'ou_engineering',
    kind: 'TEAM' as const,
    name: 'Operations',
    sample: true as const,
  },
  {
    id: 'team_sales',
    orgId: 'org_sample',
    parentId: 'ou_commercial',
    kind: 'TEAM' as const,
    name: 'Sales',
    sample: true as const,
  },
] as const;
