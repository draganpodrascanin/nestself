/**
 * Synthetic acceptance dataset for the CMS epic (T-C1.14, cms-ee-strategy
 * 4.7, C-29). Fictional people for the acceptance roles of epic 23.1:
 * Employee A (in organization A), Employee B (in organization B) and one
 * person with ACTIVE memberships in both organizations.
 *
 * Only first names are used and every record is flagged `sample`. The seed
 * writes the named people always; the generated employees only when it runs
 * with `seedAcceptanceScale` (tests that need the 30/12 employee counts).
 */
import { SAMPLE_ORG, SAMPLE_TEAMS } from './org.ts';
import { SAMPLE_ORG_B } from './org.ts';
import { SAMPLE_ORG_B_UNITS } from './org-units.ts';

export interface SampleAcceptanceMembership {
  readonly orgId: string;
  readonly orgUnitId: string;
}

export interface SampleAcceptancePerson {
  readonly id: string;
  readonly displayName: string;
  readonly initials: string;
  /** ACTIVE memberships. The first one is the person's home organization. */
  readonly memberships: readonly SampleAcceptanceMembership[];
  readonly sample: true;
}

export const SAMPLE_ACCEPTANCE_PEOPLE: readonly SampleAcceptancePerson[] = [
  {
    id: 'user_emilija',
    displayName: 'Emilija',
    initials: 'E',
    memberships: [{ orgId: SAMPLE_ORG_B.id, orgUnitId: 'ou_b_team_support' }],
    sample: true,
  },
  {
    id: 'user_bela',
    displayName: 'Bela',
    initials: 'B',
    memberships: [{ orgId: SAMPLE_ORG_B.id, orgUnitId: 'ou_b_team_field' }],
    sample: true,
  },
  {
    id: 'user_mirjam',
    displayName: 'Mirjam',
    initials: 'M',
    memberships: [
      { orgId: SAMPLE_ORG.id, orgUnitId: 'team_product' },
      { orgId: SAMPLE_ORG_B.id, orgUnitId: 'ou_b_team_support' },
    ],
    sample: true,
  },
];

/**
 * Named acceptance roles (epic 23.1) mapped to stable user ids. Employee A
 * is the existing sample employee; the editorial roles are the staff from
 * `SAMPLE_EDITORIAL_STAFF`.
 */
export const SAMPLE_ACCEPTANCE_ROLES = {
  employeeA: 'user_jovan',
  employeeB: 'user_emilija',
  /** ACTIVE memberships in organization A and organization B. */
  multiOrgEmployee: 'user_mirjam',
  author: 'user_katarina',
  reviewer: 'user_darko',
  publisher: 'user_teodora',
  editorialLead: 'user_vuk',
} as const;

/** Employee totals of the epic's acceptance dataset (epic 23.1). */
export const SAMPLE_ACCEPTANCE_SCALE = { orgA: 30, orgB: 12 } as const;

export interface SampleGeneratedEmployee {
  readonly id: string;
  readonly displayName: string;
  readonly orgId: string;
  readonly orgUnitId: string;
  readonly sample: true;
}

/**
 * `count` synthetic employees of `orgId`, spread over `unitIds` in turn.
 * Deterministic: the same arguments always return the same ids.
 */
export function generateAcceptanceEmployees(
  orgId: string,
  tag: string,
  count: number,
  unitIds: readonly string[],
): SampleGeneratedEmployee[] {
  if (unitIds.length === 0) throw new Error('generateAcceptanceEmployees needs at least one unit');
  return Array.from({ length: Math.max(0, count) }, (_, i) => {
    const n = String(i + 1).padStart(3, '0');
    return {
      id: `user_acc_${tag}_${n}`,
      displayName: `Sample employee ${tag.toUpperCase()}-${n}`,
      orgId,
      orgUnitId: unitIds[i % unitIds.length]!,
      sample: true as const,
    };
  });
}

const namedCount = (orgId: string, named: readonly string[]): number =>
  named.length +
  SAMPLE_ACCEPTANCE_PEOPLE.filter((p) => p.memberships.some((m) => m.orgId === orgId)).length;

/** Org A people from `SAMPLE_PEOPLE` that hold an organization membership. */
const ORG_A_LEGACY_MEMBERS = ['user_jovan', 'user_ana', 'user_stefan', 'user_ivana', 'user_dragan'];

/**
 * The generated employees that bring each organization up to the epic's
 * totals (30 in A, 12 in B) together with the named people.
 */
export function acceptanceScaleEmployees(): SampleGeneratedEmployee[] {
  return [
    ...generateAcceptanceEmployees(
      SAMPLE_ORG.id,
      'a',
      SAMPLE_ACCEPTANCE_SCALE.orgA - namedCount(SAMPLE_ORG.id, ORG_A_LEGACY_MEMBERS),
      SAMPLE_TEAMS.map((t) => t.id),
    ),
    ...generateAcceptanceEmployees(
      SAMPLE_ORG_B.id,
      'b',
      SAMPLE_ACCEPTANCE_SCALE.orgB - namedCount(SAMPLE_ORG_B.id, []),
      SAMPLE_ORG_B_UNITS.filter((u) => u.kind === 'TEAM').map((u) => u.id),
    ),
  ];
}
