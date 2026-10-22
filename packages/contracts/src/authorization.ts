/**
 * Authorization types, schemas and constants for the grant-based engine.
 *
 * @see Section 4.5, 5.8.2 of auth-strategy.md
 */
import { z } from 'zod';
import type { Action } from './actions.ts';
import type { Principal } from './auth.ts';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const WorkspaceSchema = z.enum(['employee', 'organization', 'expert', 'operations']);
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const PopulationSchema = z.enum([
  'employee',
  'employer_admin',
  'expert',
  'staff',
  'external',
]);
export type Population = z.infer<typeof PopulationSchema>;

export const ScopeTypeSchema = z.enum([
  'platform',
  'organization',
  'org_unit',
  'assigned_clients',
  'assigned_queues',
  'assigned_cases',
  'assigned_practice',
  'assigned_collections',
  'own',
]);
export type ScopeType = z.infer<typeof ScopeTypeSchema>;

// ---------------------------------------------------------------------------
// Grant conditions (discriminator: `type` per orchestrator ruling #1)
// ---------------------------------------------------------------------------

export const GrantConditionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('spending_ceiling'),
    amountMinor: z.number().int().nonnegative(),
    currency: z.string().length(3),
  }),
  z.object({
    type: z.literal('categories'),
    allowed: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    type: z.literal('confidential_approver'),
  }),
  z.object({
    type: z.literal('time_window'),
    days: z.array(z.number().int().min(0).max(6)).min(1),
    from: z.string().regex(/^\d{2}:\d{2}$/),
    to: z.string().regex(/^\d{2}:\d{2}$/),
  }),
]);
export type GrantCondition = z.infer<typeof GrantConditionSchema>;

// ---------------------------------------------------------------------------
// Assignment kind enum
// ---------------------------------------------------------------------------

export const AssignmentKindSchema = z.enum([
  'CASE',
  'QUEUE',
  'CLIENT',
  'PRACTICE_GROUP',
  'COLLECTION',
  'SUPPORT_CASE',
  'SUPERVISION',
]);
export type AssignmentKind = z.infer<typeof AssignmentKindSchema>;

// ---------------------------------------------------------------------------
// Resource (rich shape per 4.5.1, orchestrator ruling #2)
// ---------------------------------------------------------------------------

export interface Resource {
  type: string;
  id?: string;
  orgId?: string;
  orgUnitId?: string;
  queueId?: string;
  practiceGroupId?: string;
  collectionId?: string;
  ownerId?: string;
  amountMinor?: number;
  currency?: string;
  category?: string;
  isConfidential?: boolean;
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export const DecisionSchema = z.object({
  allowed: z.boolean(),
  grantIds: z.array(z.string()),
  assignmentIds: z.array(z.string()),
  denialReason: z.string().nullable(),
  explanation: z.array(z.string()),
});
export type Decision = z.infer<typeof DecisionSchema>;

// ---------------------------------------------------------------------------
// Delegation envelope (4.5.6)
// ---------------------------------------------------------------------------

export interface DelegationEnvelope {
  actions?: string[];
  scopeType?: ScopeType;
  scopeOrgUnitId?: string;
  includeDescendants?: boolean;
  conditions?: GrantCondition[];
  maxDepth?: number;
}

// ---------------------------------------------------------------------------
// Effective-access entry (4.5.10)
// ---------------------------------------------------------------------------

export interface EffectiveAccessEntry {
  action: Action;
  scopeType: string;
  scopeUnitName: string | null;
  conditions: GrantCondition[];
  validFrom: string | null;
  validUntil: string | null;
  grantId: string;
  isDelegated: boolean;
}

// ---------------------------------------------------------------------------
// Input interfaces for pre-loaded rows (Appendix I Part B fields)
// Dates are Date objects; the golden-table JSON uses ISO strings parsed
// by the test loader.
// ---------------------------------------------------------------------------

/** Pre-loaded grant row fed into AuthorizationContext. */
export interface GrantInput {
  id: string;
  subjectUserId: string;
  templateKey: string;
  actions: readonly string[];
  scopeType: ScopeType;
  scopeOrgId: string | null;
  scopeOrgUnitId: string | null;
  includeDescendants: boolean;
  scopeRefKind: string | null;
  scopeRefId: string | null;
  conditions: readonly GrantCondition[];
  validFrom: Date | null;
  validUntil: Date | null;
  delegationEnvelope: DelegationEnvelope | null;
  parentGrantId: string | null;
  revokedAt: Date | null;
}

/** Pre-loaded assignment row. */
export interface AssignmentInput {
  id: string;
  userId: string;
  kind: AssignmentKind;
  targetId: string;
  startAt: Date;
  endAt: Date | null;
}

/** Pre-loaded emergency access row. */
export interface EmergencyAccessInput {
  id: string;
  userId: string;
  scopeKind: 'CASE' | 'USER_RECORDS';
  scopeId: string;
  grantedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

// ---------------------------------------------------------------------------
// AuthorizationContext (rich shape per 4.5.1, orchestrator ruling #2)
// ---------------------------------------------------------------------------

export interface AuthorizationContext {
  now: Date;
  isDeactivated: boolean;
  isSuspended: boolean;
  grants: readonly GrantInput[];
  assignments: readonly AssignmentInput[];
  ancestorIds: readonly string[];
  orgSelfApprovalAllowed: boolean;
  organizationTimezone: string;
  requesterId?: string;
  delegatorGrants?: readonly GrantInput[];
  emergencyAccess?: readonly EmergencyAccessInput[];
}

// ---------------------------------------------------------------------------
// AuthorizationRequest (batch evaluation, 4.5.8)
// ---------------------------------------------------------------------------

export interface AuthorizationRequest {
  principal: Principal;
  action: Action;
  resource: Resource;
  ctx: AuthorizationContext;
}

// ---------------------------------------------------------------------------
// Step-up classes (3.6.9, orchestrator ruling #5)
// ---------------------------------------------------------------------------

/** Step-up class names. */
export type StepUpClass =
  | 'emergency'
  | 'restricted'
  | 'export'
  | 'financial'
  | 'administration';

/**
 * Maximum authentication age in seconds per step-up class.
 * [AUTHZ-R-46, 3.6.9]
 */
export const STEP_UP_MAX_AGE_SECONDS: Record<StepUpClass, number> = {
  emergency: 300,
  restricted: 900,
  export: 900,
  financial: 900,
  administration: 1800,
} as const;

/**
 * Maps individual actions to their step-up class.
 * The engine itself does NOT enforce step-up (that is the guard's job).
 * [3.6.9]
 */
export const STEP_UP_CLASS_BY_ACTION: Partial<Record<Action, StepUpClass>> = {
  // financial
  'spend.approve': 'financial',
  'funding.allocate': 'financial',
  'budget.allocate': 'financial',

  // administration
  'access.grant': 'administration',
  'access.revoke': 'administration',
  'access.delegate': 'administration',
  'sso.manage': 'administration',
  'people.deactivate': 'administration',
  'session.revoke.any': 'administration',

  // restricted
  'conversation.read.assigned': 'restricted',
  'notes.read.supervision': 'restricted',
  'records.read.emergency': 'restricted',

  // export
  'report.export': 'export',
  'data.export.own': 'export',

  // emergency
  'access.emergency.request': 'emergency',
  'access.emergency.approve': 'emergency',
} as const;

// Re-export Action from actions.ts so all authorization types
// are importable from this module (D-15).
export type { Action } from './actions.ts';
