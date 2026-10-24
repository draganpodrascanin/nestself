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
const SAMPLE_ORG_NAME = 'Sample Org';

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
  displayName: 'Nikola Djordjević',
  initials: 'ND́',
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
  { kind: 'personal', orgId: 'org_sample', orgName: SAMPLE_ORG_NAME },
];

/** Manager and HR admin: personal + organization (holds org-workspace grant). */
const ORG_ADMIN_CONTEXTS: AvailableContextEntry[] = [
  { kind: 'personal', orgId: 'org_sample', orgName: SAMPLE_ORG_NAME },
  { kind: 'organization', orgId: 'org_sample', orgName: SAMPLE_ORG_NAME },
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
    effectiveActions: actionsForTemplates('employee', 'hr_admin'),
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
