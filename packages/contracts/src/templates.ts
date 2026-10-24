/**
 * Permission template keys and definitions.
 *
 * The 17 templates bridge the product persona model and the grant-based
 * authorization engine. Each template seeds one or more Grant rows.
 * [D-17, 4.4]
 *
 * @see Section 4.4 of auth-strategy.md
 */
import type { Action } from './actions.ts';
import type { GrantCondition, ScopeType, Workspace, Population } from './authorization.ts';

// ---------------------------------------------------------------------------
// Template keys
// ---------------------------------------------------------------------------

export const TEMPLATE_KEYS = [
  'platform_owner',
  'client_operations',
  'content_author',
  'content_publisher',
  'service_coordinator',
  'support_operator',
  'nestself_finance',
  'expert',
  'expert_lead',
  'employer_owner',
  'hr_admin',
  'team_manager',
  'approver',
  'employer_finance',
  'reporting_user',
  'employee',
  'event_supplier',
] as const;

export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

// ---------------------------------------------------------------------------
// Template definition interface (orchestrator ruling #4)
// ---------------------------------------------------------------------------

export interface PermissionTemplateDefinition {
  key: TemplateKey;
  name: string;
  workspace: Workspace;
  population: Population;
  actions: readonly Action[];
  scopeType: ScopeType;
  defaultConditions: readonly GrantCondition[];
  /**
   * Condition types that MUST be present when a grant is created from
   * this template. Actual threshold values are organisation-specific, so
   * `defaultConditions` stays `[]`; this list tells grant-creation
   * validation which condition types to require.
   */
  requiredConditionTypes: readonly GrantCondition['type'][];
  requiresSecondFactor: boolean;
  stepUpActions: readonly Action[];
  isActive: boolean;
  legacyRole:
    | 'EMPLOYEE'
    | 'MANAGER'
    | 'HR_ADMIN'
    | 'EXPERT'
    | 'OPERATIONS'
    | 'ADMIN'
    | null;
}

// ---------------------------------------------------------------------------
// The 17 permission template definitions (4.4 table)
// ---------------------------------------------------------------------------

/** @see Section 4.4 template table */
export const PERMISSION_TEMPLATES: readonly PermissionTemplateDefinition[] = [
  {
    key: 'platform_owner',
    name: 'Platform Owner',
    workspace: 'operations',
    population: 'staff',
    actions: [
      'client.create', 'client.configure', 'access.grant', 'access.revoke',
      'access.preview', 'access.emergency.request', 'access.emergency.approve',
      'policy.manage', 'service.enable', 'audit.read', 'platform.configure',
      'sso.manage', 'session.revoke.any', 'people.deactivate',
      'preferences.manage', 'feedback.submit', 'data.export.own', 'data.erasure.request',
    ],
    scopeType: 'platform',
    defaultConditions: [],
    requiredConditionTypes: [],
    requiresSecondFactor: true,
    stepUpActions: [
      'access.grant', 'access.revoke', 'access.emergency.request',
      'access.emergency.approve', 'sso.manage', 'session.revoke.any',
      'people.deactivate',
    ],
    isActive: true,
    legacyRole: 'ADMIN',
  },
  {
    key: 'client_operations',
    name: 'Client Operations',
    workspace: 'operations',
    population: 'staff',
    actions: [
      'client.configure', 'people.import', 'people.onboard', 'people.deactivate',
      'service.configure', 'request.view', 'request.route', 'bookings.coordinate',
      'preferences.manage', 'feedback.submit', 'data.export.own', 'data.erasure.request',
    ],
    scopeType: 'assigned_clients',
    defaultConditions: [],
    requiredConditionTypes: [],
    requiresSecondFactor: true,
    // Offboarding on behalf of an assigned client (API-R-27 suspension and
    // membership end). Step-up class "administration" (3.6.9).
    stepUpActions: ['people.deactivate'],
    isActive: true,
    legacyRole: 'OPERATIONS',
  },
  {
    key: 'content_author',
    name: 'Content Author',
    workspace: 'operations',
    population: 'staff',
    actions: [
      'content.write', 'content.submit', 'content.preview',
      'preferences.manage', 'feedback.submit', 'data.export.own', 'data.erasure.request',
    ],
    scopeType: 'assigned_collections',
    defaultConditions: [],
    requiredConditionTypes: [],
    requiresSecondFactor: true,
    stepUpActions: [],
    isActive: true,
    legacyRole: 'OPERATIONS',
  },
  {
    key: 'content_publisher',
    name: 'Content Publisher',
    workspace: 'operations',
    population: 'staff',
    actions: [
      'content.review', 'content.publish', 'content.schedule',
      'content.archive', 'content.restrict',
      'preferences.manage', 'feedback.submit', 'data.export.own', 'data.erasure.request',
    ],
    scopeType: 'assigned_collections',
    defaultConditions: [],
    requiredConditionTypes: [],
    requiresSecondFactor: true,
    stepUpActions: [],
    isActive: true,
    legacyRole: 'OPERATIONS',
  },
  {
    key: 'service_coordinator',
    name: 'Service Coordinator',
    workspace: 'operations',
    population: 'staff',
    actions: [
      'request.route', 'request.assign', 'request.escalate',
      'bookings.coordinate', 'appointment.propose',
      'preferences.manage', 'feedback.submit', 'data.export.own', 'data.erasure.request',
    ],
    scopeType: 'assigned_queues',
    defaultConditions: [],
    requiredConditionTypes: [],
    requiresSecondFactor: true,
    stepUpActions: [],
    isActive: true,
    legacyRole: 'OPERATIONS',
  },
  {
    key: 'support_operator',
    name: 'Support Operator',
    workspace: 'operations',
    population: 'staff',
    actions: [
      'support.troubleshoot', 'account.help', 'diagnostic.read',
      'preferences.manage', 'feedback.submit', 'data.export.own', 'data.erasure.request',
    ],
    scopeType: 'assigned_cases',
    defaultConditions: [],
    requiredConditionTypes: [],
    requiresSecondFactor: true,
    stepUpActions: [],
    isActive: true,
    legacyRole: 'OPERATIONS',
  },
  {
    key: 'nestself_finance',
    name: 'NestSelf Finance',
    workspace: 'operations',
    population: 'staff',
    actions: [
      'funding.credit', 'funding.reconcile', 'funding.adjust',
      'statement.produce', 'settlement.manage', 'claim.manage', 'voucher.verify',
      'preferences.manage', 'feedback.submit', 'data.export.own', 'data.erasure.request',
    ],
    scopeType: 'platform',
    defaultConditions: [],
    requiredConditionTypes: [],
    requiresSecondFactor: true,
    stepUpActions: [],
    isActive: true,
    legacyRole: 'OPERATIONS',
  },
  {
    key: 'expert',
    name: 'Expert',
    workspace: 'expert',
    population: 'expert',
    actions: [
      'availability.manage', 'case.accept', 'case.decline',
      'appointment.propose', 'conversation.participate', 'conversation.read.assigned',
      'consultation.join', 'delivery.record', 'earnings.read', 'expert.profile.edit',
      'preferences.manage', 'feedback.submit', 'data.export.own', 'data.erasure.request',
    ],
    scopeType: 'assigned_cases',
    defaultConditions: [],
    requiredConditionTypes: ['categories'],
    requiresSecondFactor: true,
    stepUpActions: [
      'conversation.read.assigned', 'data.export.own',
    ],
    isActive: true,
    legacyRole: 'EXPERT',
  },
  {
    key: 'expert_lead',
    name: 'Expert Lead',
    workspace: 'expert',
    population: 'expert',
    actions: [
      'expert.verify', 'expert.assign', 'quality.review',
      'workload.manage', 'request.reassign',
      'preferences.manage', 'feedback.submit', 'data.export.own', 'data.erasure.request',
    ],
    scopeType: 'assigned_practice',
    defaultConditions: [],
    requiredConditionTypes: [],
    requiresSecondFactor: true,
    stepUpActions: [
      'notes.read.supervision', 'data.export.own',
    ],
    isActive: true,
    legacyRole: 'EXPERT',
  },
  {
    key: 'employer_owner',
    name: 'Employer Owner',
    workspace: 'organization',
    population: 'employer_admin',
    actions: [
      'access.delegate', 'access.preview', 'policy.manage',
      'service.configure', 'org.settings',
    ],
    scopeType: 'organization',
    defaultConditions: [],
    requiredConditionTypes: [],
    requiresSecondFactor: true,
    stepUpActions: ['access.delegate'],
    isActive: true,
    legacyRole: null,
  },
  {
    key: 'hr_admin',
    name: 'HR Administrator',
    workspace: 'organization',
    population: 'employer_admin',
    actions: [
      'people.invite', 'people.import', 'people.deactivate', 'people.move',
      'org_units.manage', 'program.overview', 'reports.aggregate.read',
      'content.promote',
    ],
    scopeType: 'organization',
    defaultConditions: [],
    requiredConditionTypes: [],
    requiresSecondFactor: true,
    stepUpActions: ['people.deactivate'],
    isActive: true,
    legacyRole: 'HR_ADMIN',
  },
  {
    key: 'team_manager',
    name: 'Team Manager',
    workspace: 'organization',
    population: 'employer_admin',
    actions: [
      'events.request', 'activity.request', 'offer.accept', 'event.invite',
      'budget.read', 'budget.allocate', 'budget.topup.request', 'spend.approve',
    ],
    scopeType: 'org_unit',
    defaultConditions: [],
    requiredConditionTypes: ['spending_ceiling'],
    requiresSecondFactor: true,
    stepUpActions: ['spend.approve', 'budget.allocate'],
    isActive: true,
    legacyRole: 'MANAGER',
  },
  {
    key: 'approver',
    name: 'Approver',
    workspace: 'organization',
    population: 'employer_admin',
    actions: ['approval.decide', 'approval.delegate'],
    scopeType: 'organization',
    defaultConditions: [],
    requiredConditionTypes: ['spending_ceiling', 'categories'],
    requiresSecondFactor: true,
    stepUpActions: [],
    isActive: true,
    legacyRole: null,
  },
  {
    key: 'employer_finance',
    name: 'Employer Finance',
    workspace: 'organization',
    population: 'employer_admin',
    actions: [
      'budget.allocate', 'budget.read', 'funding.allocate', 'funding.renew',
      'statement.read', 'approval.confidential',
    ],
    scopeType: 'org_unit',
    defaultConditions: [],
    requiredConditionTypes: ['spending_ceiling'],
    requiresSecondFactor: true,
    stepUpActions: ['funding.allocate', 'budget.allocate'],
    isActive: true,
    legacyRole: null,
  },
  {
    key: 'reporting_user',
    name: 'Reporting User',
    workspace: 'organization',
    population: 'employer_admin',
    actions: ['reports.aggregate.read', 'report.export'],
    scopeType: 'org_unit',
    defaultConditions: [],
    requiredConditionTypes: [],
    requiresSecondFactor: true,
    stepUpActions: ['report.export'],
    isActive: true,
    legacyRole: null,
  },
  {
    key: 'employee',
    name: 'Employee',
    workspace: 'employee',
    population: 'employee',
    actions: [
      'content.read', 'content.bookmark', 'service.request', 'service.book',
      'appointment.cancel', 'appointment.reschedule', 'event.register',
      'consultation.join', 'conversation.participate',
      'preferences.manage', 'voucher.activate',
      'feedback.submit', 'data.export.own', 'data.erasure.request',
    ],
    scopeType: 'own',
    defaultConditions: [],
    requiredConditionTypes: [],
    requiresSecondFactor: false,
    stepUpActions: ['data.export.own'],
    isActive: true,
    legacyRole: 'EMPLOYEE',
  },
  {
    key: 'event_supplier',
    name: 'Event Supplier',
    workspace: 'organization',
    population: 'external',
    actions: ['logistics.view', 'delivery.confirm'],
    scopeType: 'assigned_cases',
    defaultConditions: [],
    requiredConditionTypes: ['time_window'],
    requiresSecondFactor: false,
    stepUpActions: [],
    isActive: true,
    legacyRole: null,
  },
] as const;
