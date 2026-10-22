/**
 * Zod validation schema for golden-table.json tuples.
 *
 * Each tuple is a `(principal, action, resource, ctx, expected)` record
 * that the `authorize()` engine evaluates deterministically.
 *
 * @see Section 4.5.12 of auth-strategy.md (AUTHZ-R-47)
 */
import { z } from 'zod';

const _iso = z.string().datetime({ offset: true });

const ActiveContextSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('personal') }),
  z.object({ kind: z.literal('organization'), orgId: z.string().min(1) }),
  z.object({ kind: z.literal('expert') }),
  z.object({ kind: z.literal('operations') }),
]);

const PrincipalMembershipSchema = z.object({
  membershipId: z.string().min(1),
  orgId: z.string().min(1),
  orgUnitId: z.string().min(1).nullable(),
  status: z.enum(['INVITED', 'ACTIVE']),
  startDate: z.string(),
  endDate: z.string().nullable(),
});

const AuthInfoSchema = z.object({
  method: z.enum(['email_otp', 'password_totp', 'sso', 'passkey']),
  time: z.string(),
  secondFactor: z.boolean(),
  lastStepUpAt: z.string().nullable(),
});

const PrincipalTupleSchema = z.object({
  userId: z.string().min(1),
  displayName: z.string().min(1),
  initials: z.string().min(1).max(3),
  locale: z.string(),
  context: ActiveContextSchema,
  memberships: z.array(PrincipalMembershipSchema),
  staffTemplates: z.array(z.string()),
  expert: z
    .object({
      id: z.string().min(1),
      approvedCategories: z.array(z.string()),
    })
    .nullable(),
  auth: AuthInfoSchema,
  sessionId: z.string().nullable(),
  tokenFamily: z.string().nullable(),
});

const GrantConditionSchema = z.discriminatedUnion('type', [
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

const DelegationEnvelopeSchema = z
  .object({
    actions: z.array(z.string()).optional(),
    scopeType: z.string().optional(),
    scopeOrgUnitId: z.string().optional(),
    includeDescendants: z.boolean().optional(),
    conditions: z.array(GrantConditionSchema).optional(),
    maxDepth: z.number().int().optional(),
  })
  .nullable();

const GrantInputSchema = z.object({
  id: z.string().min(1),
  subjectUserId: z.string().min(1),
  templateKey: z.string().min(1),
  actions: z.array(z.string().min(1)),
  scopeType: z.string().min(1),
  scopeOrgId: z.string().nullable(),
  scopeOrgUnitId: z.string().nullable(),
  includeDescendants: z.boolean(),
  scopeRefKind: z.string().nullable(),
  scopeRefId: z.string().nullable(),
  conditions: z.array(GrantConditionSchema),
  validFrom: z.string().nullable(),
  validUntil: z.string().nullable(),
  delegationEnvelope: DelegationEnvelopeSchema,
  parentGrantId: z.string().nullable(),
  revokedAt: z.string().nullable(),
});

const AssignmentInputSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  kind: z.enum([
    'CASE',
    'QUEUE',
    'CLIENT',
    'PRACTICE_GROUP',
    'COLLECTION',
    'SUPPORT_CASE',
    'SUPERVISION',
  ]),
  targetId: z.string().min(1),
  startAt: z.string(),
  endAt: z.string().nullable(),
});

const EmergencyAccessInputSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  scopeKind: z.enum(['CASE', 'USER_RECORDS']),
  scopeId: z.string().min(1),
  grantedAt: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
});

const ResourceTupleSchema = z.object({
  type: z.string().min(1),
  id: z.string().optional(),
  orgId: z.string().optional(),
  orgUnitId: z.string().optional(),
  queueId: z.string().optional(),
  practiceGroupId: z.string().optional(),
  collectionId: z.string().optional(),
  ownerId: z.string().optional(),
  amountMinor: z.number().optional(),
  currency: z.string().optional(),
  category: z.string().optional(),
  isConfidential: z.boolean().optional(),
});

const CtxTupleSchema = z.object({
  now: z.string(),
  isDeactivated: z.boolean(),
  isSuspended: z.boolean(),
  grants: z.array(GrantInputSchema),
  assignments: z.array(AssignmentInputSchema),
  ancestorIds: z.array(z.string()),
  orgSelfApprovalAllowed: z.boolean(),
  organizationTimezone: z.string(),
  requesterId: z.string().optional(),
  delegatorGrants: z.array(GrantInputSchema).optional(),
  emergencyAccess: z.array(EmergencyAccessInputSchema).optional(),
});

const ExpectedSchema = z.object({
  allowed: z.boolean(),
  denialReason: z.string().nullable(),
});

export const GoldenTupleSchema = z.object({
  label: z.string().min(1),
  principal: PrincipalTupleSchema,
  action: z.string().min(1),
  resource: ResourceTupleSchema,
  ctx: CtxTupleSchema,
  expected: ExpectedSchema,
});

export type GoldenTuple = z.infer<typeof GoldenTupleSchema>;

export const GoldenTableSchema = z.array(GoldenTupleSchema);
