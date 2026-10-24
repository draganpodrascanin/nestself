/**
 * Action catalogue — the single source of truth for all action strings.
 *
 * Every action is an exact dotted-lowercase string. No wildcards or patterns
 * are used in grant evaluation; a grant allows only the literal actions it
 * lists. [D-15, AUTHZ-R-31]
 *
 * @see Section 4.3 of auth-strategy.md
 */
export const ACTIONS = {
  // Identity and access
  'access.grant': 'access.grant',
  'access.revoke': 'access.revoke',
  'access.delegate': 'access.delegate',
  'access.preview': 'access.preview',
  'access.emergency.request': 'access.emergency.request',
  'access.emergency.approve': 'access.emergency.approve',
  'audit.read': 'audit.read',
  'session.revoke.any': 'session.revoke.any',

  // Platform and clients
  'client.create': 'client.create',
  'client.configure': 'client.configure',
  'service.enable': 'service.enable',
  'service.configure': 'service.configure',
  'policy.manage': 'policy.manage',
  'platform.configure': 'platform.configure',
  'sso.manage': 'sso.manage',

  // People and organization
  'people.invite': 'people.invite',
  'people.import': 'people.import',
  'people.deactivate': 'people.deactivate',
  'people.move': 'people.move',
  'people.onboard': 'people.onboard',
  'org_units.manage': 'org_units.manage',
  'org.settings': 'org.settings',
  'program.overview': 'program.overview',

  // Content
  'content.read': 'content.read',
  'content.write': 'content.write',
  'content.submit': 'content.submit',
  'content.preview': 'content.preview',
  'content.review': 'content.review',
  'content.publish': 'content.publish',
  'content.schedule': 'content.schedule',
  'content.archive': 'content.archive',
  'content.restrict': 'content.restrict',
  'content.promote': 'content.promote',
  'content.bookmark': 'content.bookmark',
  'taxonomy.manage': 'taxonomy.manage',
  'home.manage': 'home.manage',
  'media.upload': 'media.upload',
  'media.manage': 'media.manage',

  // Engagement
  'poll.manage': 'poll.manage',
  'poll.respond': 'poll.respond',
  'poll.results.read': 'poll.results.read',

  // Editorial requests
  'editorial.request.submit': 'editorial.request.submit',
  'editorial.request.manage': 'editorial.request.manage',
  'editorial.brief.manage': 'editorial.brief.manage',

  // Requests, scheduling and services
  'request.view': 'request.view',
  'request.route': 'request.route',
  'request.assign': 'request.assign',
  'request.reassign': 'request.reassign',
  'request.escalate': 'request.escalate',
  'service.request': 'service.request',
  'service.book': 'service.book',
  'appointment.propose': 'appointment.propose',
  'appointment.cancel': 'appointment.cancel',
  'appointment.reschedule': 'appointment.reschedule',
  'bookings.coordinate': 'bookings.coordinate',
  'availability.manage': 'availability.manage',
  'case.accept': 'case.accept',
  'case.decline': 'case.decline',
  'delivery.record': 'delivery.record',
  'consultation.join': 'consultation.join',

  // Professional interaction (restricted)
  'conversation.participate': 'conversation.participate',
  'conversation.read.assigned': 'conversation.read.assigned',
  'notes.read.supervision': 'notes.read.supervision',
  'records.read.emergency': 'records.read.emergency',
  'intake.queue.view': 'intake.queue.view',
  'intake.claim': 'intake.claim',
  'intake.reassign': 'intake.reassign',
  'intake.respond': 'intake.respond',
  'intake.permission.request': 'intake.permission.request',

  // Experts
  'expert.verify': 'expert.verify',
  'expert.assign': 'expert.assign',
  'expert.profile.edit': 'expert.profile.edit',
  'quality.review': 'quality.review',
  'workload.manage': 'workload.manage',
  'earnings.read': 'earnings.read',

  // Money
  'budget.read': 'budget.read',
  'budget.allocate': 'budget.allocate',
  'budget.topup.request': 'budget.topup.request',
  'spend.approve': 'spend.approve',
  'approval.decide': 'approval.decide',
  'approval.delegate': 'approval.delegate',
  'approval.confidential': 'approval.confidential',
  'funding.credit': 'funding.credit',
  'funding.reconcile': 'funding.reconcile',
  'funding.adjust': 'funding.adjust',
  'funding.allocate': 'funding.allocate',
  'funding.renew': 'funding.renew',
  'statement.read': 'statement.read',
  'statement.produce': 'statement.produce',
  'settlement.manage': 'settlement.manage',
  'claim.manage': 'claim.manage',
  'voucher.verify': 'voucher.verify',
  'voucher.activate': 'voucher.activate',

  // Events
  'events.request': 'events.request',
  'activity.request': 'activity.request',
  'offer.accept': 'offer.accept',
  'event.invite': 'event.invite',
  'event.register': 'event.register',
  'event.present': 'event.present',
  'logistics.view': 'logistics.view',
  'delivery.confirm': 'delivery.confirm',

  // Reporting
  'reports.aggregate.read': 'reports.aggregate.read',
  'report.export': 'report.export',
  'content.metrics.read': 'content.metrics.read',

  // Support
  'support.troubleshoot': 'support.troubleshoot',
  'account.help': 'account.help',
  'diagnostic.read': 'diagnostic.read',

  // Personal
  'preferences.manage': 'preferences.manage',
  'feedback.submit': 'feedback.submit',
  'data.export.own': 'data.export.own',
  'data.erasure.request': 'data.erasure.request',
} as const;

/** A dotted action string from the catalogue in 4.3. */
export type Action = keyof typeof ACTIONS;

/** Ordered list of every action in the catalogue. */
export const ACTION_LIST: readonly Action[] = Object.keys(ACTIONS) as Action[];

/** Type guard: returns true when `value` is a valid Action string. */
export function isAction(value: string): value is Action {
  return Object.prototype.hasOwnProperty.call(ACTIONS, value);
}

/**
 * Actions that target the confidential / restricted domain.
 * Used by the hard-deny check in authorize() step 3.
 * [AUTHZ-R-33, CONF-R-04, D-20]
 */
export const CONFIDENTIAL_ACTIONS: readonly Action[] = [
  'conversation.participate',
  'conversation.read.assigned',
  'notes.read.supervision',
  'records.read.emergency',
  'intake.respond',
  'intake.permission.request',
] as const;

/**
 * Actions considered "approval actions" for the self-approval rule.
 * [AUTHZ-R-39, D-17, DR-16]
 */
export const APPROVAL_ACTIONS: readonly Action[] = [
  'approval.decide',
  'spend.approve',
] as const;
