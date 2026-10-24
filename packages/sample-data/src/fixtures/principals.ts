/**
 * Sample principals for use in sample/dev mode.
 *
 * Each entry mirrors what `GET /auth/me` would return for the given
 * legacy role. `effectiveActions` are pre-computed from the permission
 * templates so that `can()` works without a server.
 *
 * Ruling E (T-C1.02): employee, manager and hr_admin default to
 * `{ kind: 'personal', orgId }`. Only manager and hr_admin expose an
 * organization entry in `availableContexts` (they hold org-workspace
 * template grants). The `employee_personal` legacy role is removed.
 */
import { PrincipalSchema, PERMISSION_TEMPLATES } from '@nestself/contracts';
import type { Principal, AvailableContextEntry } from '@nestself/contracts';
import { SAMPLE_ORG, SAMPLE_ORG_B } from './org.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type LegacyRole = 'employee' | 'manager' | 'hr_admin' | 'expert' | 'operations' | 'admin';

function actionsForTemplates(...keys: string[]): readonly string[] {
  const set = new Set<string>();
  for (const key of keys) {
    const tpl = PERMISSION_TEMPLATES.find((t) => t.key === key);
    if (tpl) {
      for (const a of tpl.actions) set.add(a);
    }
  }
  return [...set];
}

const AUTH_TIME = '2026-10-22T09:00:00Z';

// ---------------------------------------------------------------------------
// Principals — all org-based users default to personal context (Ruling E)
// ---------------------------------------------------------------------------

const employeePrincipal: Principal = PrincipalSchema.parse({
  userId: 'user_jovan',
  displayName: 'Jovan Petrović',
  initials: 'JP',
  locale: 'sr-Latn',
  memberships: [
    {
      membershipId: 'mem_jovan',
      orgId: 'org_sample',
      orgUnitId: 'team_product',
      status: 'ACTIVE',
      startDate: '2024-01-15T00:00:00Z',
      endDate: null,
    },
  ],
  staffTemplates: [],
  expert: null,
  context: { kind: 'personal', orgId: 'org_sample' },
  auth: { method: 'email_otp', time: AUTH_TIME, secondFactor: false, lastStepUpAt: null },
  sessionId: 'sess_sample_employee',
  tokenFamily: null,
});

const managerPrincipal: Principal = PrincipalSchema.parse({
  userId: 'user_stefan',
  displayName: 'Stefan Marković',
  initials: 'SM',
  locale: 'sr-Latn',
  memberships: [
    {
      membershipId: 'mem_stefan',
      orgId: 'org_sample',
      orgUnitId: 'team_product',
      status: 'ACTIVE',
      startDate: '2024-03-01T00:00:00Z',
      endDate: null,
    },
  ],
  staffTemplates: [],
  expert: null,
  context: { kind: 'personal', orgId: 'org_sample' },
  auth: { method: 'email_otp', time: AUTH_TIME, secondFactor: false, lastStepUpAt: null },
  sessionId: 'sess_sample_manager',
  tokenFamily: null,
});

const hrAdminPrincipal: Principal = PrincipalSchema.parse({
  userId: 'user_ivana',
  displayName: 'Ivana Jovanović',
  initials: 'IJ',
  locale: 'sr-Latn',
  memberships: [
    {
      membershipId: 'mem_ivana',
      orgId: 'org_sample',
      orgUnitId: null,
      status: 'ACTIVE',
      startDate: '2023-11-01T00:00:00Z',
      endDate: null,
    },
  ],
  staffTemplates: [],
  expert: null,
  context: { kind: 'personal', orgId: 'org_sample' },
  auth: { method: 'email_otp', time: AUTH_TIME, secondFactor: false, lastStepUpAt: null },
  sessionId: 'sess_sample_hr_admin',
  tokenFamily: null,
});

const expertPrincipal: Principal = PrincipalSchema.parse({
  userId: 'user_milica',
  displayName: 'Milica Ristić',
  initials: 'MR',
  locale: 'sr-Latn',
  memberships: [],
  staffTemplates: [],
  expert: { id: 'expert_milica', approvedCategories: ['psychological'] },
  context: { kind: 'expert' },
  auth: { method: 'password_totp', time: AUTH_TIME, secondFactor: true, lastStepUpAt: null },
  sessionId: 'sess_sample_expert',
  tokenFamily: null,
});

const operationsPrincipal: Principal = PrincipalSchema.parse({
  userId: 'user_nikola',
  displayName: 'Nikola Đorđević',
  initials: 'NĐ',
  locale: 'sr-Latn',
  memberships: [],
  staffTemplates: ['client_operations', 'support_operator'],
  expert: null,
  context: { kind: 'operations' },
  auth: { method: 'password_totp', time: AUTH_TIME, secondFactor: true, lastStepUpAt: null },
  sessionId: 'sess_sample_operations',
  tokenFamily: null,
});

const adminPrincipal: Principal = PrincipalSchema.parse({
  userId: 'user_admin',
  displayName: 'Platform Admin',
  initials: 'PA',
  locale: 'en',
  memberships: [],
  staffTemplates: ['platform_owner'],
  expert: null,
  context: { kind: 'operations' },
  auth: { method: 'password_totp', time: AUTH_TIME, secondFactor: true, lastStepUpAt: null },
  sessionId: 'sess_sample_admin',
  tokenFamily: null,
});

// ---------------------------------------------------------------------------
// Available contexts (Ruling E)
// ---------------------------------------------------------------------------

/** Employee: personal only (no org-workspace template grant). */
const EMPLOYEE_CONTEXTS: AvailableContextEntry[] = [
  { kind: 'personal', orgId: 'org_sample', orgName: SAMPLE_ORG.name },
];

/** Manager and HR admin: personal + organization (holds org-workspace grant). */
const ORG_ADMIN_CONTEXTS: AvailableContextEntry[] = [
  { kind: 'personal', orgId: 'org_sample', orgName: SAMPLE_ORG.name },
  { kind: 'organization', orgId: 'org_sample', orgName: SAMPLE_ORG.name },
];

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const SAMPLE_PRINCIPALS: Record<
  LegacyRole,
  { principal: Principal; effectiveActions: readonly string[]; availableContexts: readonly AvailableContextEntry[] }
> = {
  employee: {
    principal: employeePrincipal,
    effectiveActions: actionsForTemplates('employee'),
    availableContexts: EMPLOYEE_CONTEXTS,
  },
  manager: {
    principal: managerPrincipal,
    effectiveActions: actionsForTemplates('employee', 'team_manager'),
    availableContexts: ORG_ADMIN_CONTEXTS,
  },
  hr_admin: {
    principal: hrAdminPrincipal,
    // The sample HR admin also holds the employer owner template
    // (`grant_user_ivana_employer_owner` in SAMPLE_GRANTS), so the access
    // management screen is reachable in sample mode.
    effectiveActions: actionsForTemplates('employee', 'hr_admin', 'employer_owner'),
    availableContexts: ORG_ADMIN_CONTEXTS,
  },
  expert: {
    principal: expertPrincipal,
    effectiveActions: actionsForTemplates('expert'),
    availableContexts: [{ kind: 'expert' }],
  },
  operations: {
    principal: operationsPrincipal,
    effectiveActions: actionsForTemplates('client_operations', 'support_operator'),
    availableContexts: [{ kind: 'operations' }],
  },
  admin: {
    principal: adminPrincipal,
    effectiveActions: actionsForTemplates('platform_owner'),
    availableContexts: [{ kind: 'operations' }],
  },
};

// ---------------------------------------------------------------------------
// Acceptance principals (T-C1.14): the second organization and the person
// with memberships in both. Employees only: personal contexts, one per org.
// ---------------------------------------------------------------------------

function acceptancePrincipal(
  userId: string,
  displayName: string,
  initials: string,
  memberships: { id: string; orgId: string; orgUnitId: string }[],
) {
  return PrincipalSchema.parse({
    userId,
    displayName,
    initials,
    locale: 'sr-Latn',
    memberships: memberships.map((m) => ({
      membershipId: m.id,
      orgId: m.orgId,
      orgUnitId: m.orgUnitId,
      status: 'ACTIVE',
      startDate: '2026-01-01T00:00:00Z',
      endDate: null,
    })),
    staffTemplates: [],
    expert: null,
    context: { kind: 'personal', orgId: memberships[0]!.orgId },
    auth: { method: 'email_otp', time: AUTH_TIME, secondFactor: false, lastStepUpAt: null },
    sessionId: `sess_sample_${userId}`,
    tokenFamily: null,
  });
}

const ORG_A_PERSONAL: AvailableContextEntry = {
  kind: 'personal',
  orgId: 'org_sample',
  orgName: SAMPLE_ORG.name,
};
const ORG_B_PERSONAL: AvailableContextEntry = {
  kind: 'personal',
  orgId: SAMPLE_ORG_B.id,
  orgName: SAMPLE_ORG_B.name,
};

export const SAMPLE_ACCEPTANCE_PRINCIPALS: Record<
  'employeeB' | 'multiOrgEmployee',
  { principal: Principal; effectiveActions: readonly string[]; availableContexts: readonly AvailableContextEntry[] }
> = {
  employeeB: {
    principal: acceptancePrincipal('user_emilija', 'Emilija', 'E', [
      { id: 'mem_emilija', orgId: SAMPLE_ORG_B.id, orgUnitId: 'ou_b_team_support' },
    ]),
    effectiveActions: actionsForTemplates('employee'),
    availableContexts: [ORG_B_PERSONAL],
  },
  multiOrgEmployee: {
    principal: acceptancePrincipal('user_mirjam', 'Mirjam', 'M', [
      { id: 'mem_mirjam_a', orgId: 'org_sample', orgUnitId: 'team_product' },
      { id: 'mem_mirjam_b', orgId: SAMPLE_ORG_B.id, orgUnitId: 'ou_b_team_support' },
    ]),
    effectiveActions: actionsForTemplates('employee'),
    availableContexts: [ORG_A_PERSONAL, ORG_B_PERSONAL],
  },
};
