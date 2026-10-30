import { PERMISSION_TEMPLATES } from '@nestself/contracts';
import type { GrantResponse } from '@nestself/contracts';
import { SAMPLE_PEOPLE } from './people.ts';
import { SAMPLE_TEAMS } from './org.ts';

/** A sample grant row; `sample: true` is the fixture marker, not part of the API shape. */
export type SampleGrant = GrantResponse & { sample: true };

const GRANTED_BY = 'user_ivana';
const GRANTED_AT = '2026-01-01T00:00:00.000Z';
const DEFAULT_TEAM_ID = SAMPLE_TEAMS[0].id;

/**
 * Grants the API seed derives for the sample people: the templates whose
 * `legacyRole` matches the person's org or platform role, plus the employee
 * template for every org member (`templatesForLegacyRoles` in the API seed).
 */
function templatesFor(orgRole: string | null, platformRole: string | null) {
  const org = orgRole?.toUpperCase() ?? null;
  const platform = platformRole?.toUpperCase() ?? null;
  const matching = PERMISSION_TEMPLATES.filter(
    (t) => t.legacyRole != null && (t.legacyRole === org || t.legacyRole === platform),
  );
  if (org && !matching.some((t) => t.key === 'employee')) {
    const employee = PERMISSION_TEMPLATES.find((t) => t.key === 'employee');
    if (employee) matching.push(employee);
  }
  return matching;
}

const DERIVED_GRANTS: SampleGrant[] = SAMPLE_PEOPLE.flatMap((person) =>
  templatesFor(person.orgRole, person.platformRole).map((tmpl): SampleGrant => {
    const orgId = person.orgId;
    const scope =
      tmpl.scopeType === 'platform'
        ? { scopeOrgId: null, scopeOrgUnitId: null, includeDescendants: false }
        : tmpl.scopeType === 'org_unit'
          ? { scopeOrgId: orgId, scopeOrgUnitId: DEFAULT_TEAM_ID, includeDescendants: true }
          : { scopeOrgId: orgId, scopeOrgUnitId: null, includeDescendants: false };
    return {
      id: `grant_${person.id}_${tmpl.key}`,
      subjectUserId: person.id,
      templateKey: tmpl.key,
      actions: [...tmpl.actions],
      scopeType: tmpl.scopeType,
      ...scope,
      conditions: [],
      validFrom: GRANTED_AT,
      validUntil: null,
      parentGrantId: null,
      grantedByUserId: GRANTED_BY,
      grantedAt: GRANTED_AT,
      revokedAt: null,
      sample: true,
    };
  }),
);

const OWNER_TEMPLATE = PERMISSION_TEMPLATES.find((t) => t.key === 'employer_owner');

/**
 * The sample HR admin is also the organization's employer owner. The owner
 * template has no legacy role, so this grant is added explicitly rather than
 * derived; it matches `SAMPLE_PRINCIPALS.hr_admin.effectiveActions`.
 */
const OWNER_GRANT: SampleGrant = {
  id: 'grant_user_ivana_employer_owner',
  subjectUserId: 'user_ivana',
  templateKey: 'employer_owner',
  actions: [...(OWNER_TEMPLATE?.actions ?? [])],
  scopeType: 'organization',
  scopeOrgId: 'org_sample',
  scopeOrgUnitId: null,
  includeDescendants: false,
  conditions: [],
  validFrom: GRANTED_AT,
  validUntil: null,
  parentGrantId: null,
  grantedByUserId: GRANTED_BY,
  grantedAt: GRANTED_AT,
  revokedAt: null,
  sample: true,
};

const APPROVER_TEMPLATE = PERMISSION_TEMPLATES.find((t) => t.key === 'approver');

/**
 * The sample HR admin also approves follow-ups (T-CW-1.5): the approver
 * template has no legacy role either, so it is explicit too; her approval
 * authority is `SAMPLE_APPROVAL_AUTHORITIES`.
 */
const APPROVER_GRANT: SampleGrant = {
  ...OWNER_GRANT,
  id: 'grant_user_ivana_approver',
  templateKey: 'approver',
  actions: [...(APPROVER_TEMPLATE?.actions ?? [])],
};

export const SAMPLE_GRANTS: SampleGrant[] = [...DERIVED_GRANTS, OWNER_GRANT, APPROVER_GRANT];
