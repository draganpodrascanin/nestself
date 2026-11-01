/**
 * Audit action catalogue and category mapping.
 *
 * @see D-21, Appendix I Part C "Audit event catalogue"
 */

export const AUDIT_ACTIONS = [
  'auth.sign_in.succeeded',
  'auth.sign_in.failed',
  'auth.sign_out',
  'auth.session.created',
  'auth.session.destroyed',
  'auth.session.revoked',
  'auth.step_up.completed',
  'auth.step_up.failed',
  'auth.token.refreshed',
  'auth.token.revoked',
  'auth.mobile_family.revoked',
  'auth.mfa.enrolled',
  'auth.mfa.removed',
  'identity.created',
  'identity.linked',
  'identity.unlinked',
  /** An SSO sign-in matched no identity, invitation or JIT rule; the orphan IdP user was deleted (SSO-R-10). */
  'identity.denied',
  /**
   * An OIDC sign-in without `email_verified` is pending: the binding waits
   * for the user to confirm the address with a NestSelf code (SSO-R-08).
   */
  'identity.verification_started',
  'invitation.created',
  'invitation.accepted',
  'invitation.revoked',
  'invitation.expired',
  'membership.activated',
  'membership.updated',
  'membership.moved',
  'membership.ended',
  'membership.suspended',
  'org_unit.created',
  'org_unit.updated',
  'org_unit.moved',
  'user.created',
  'user.updated',
  'user.suspended',
  'user.reactivated',
  'user.deactivated',
  'grant.created',
  'grant.adjusted',
  'grant.revoked',
  'grant.delegated',
  'grant.delegation_revoked',
  'grant.expired',
  'approval_authority.changed',
  'access.denied',
  'emergency_access.requested',
  'emergency_access.approved',
  'emergency_access.denied',
  'emergency_access.expired',
  'emergency_access.revoked',
  'emergency_access.used',
  'export.generated',
  'content.created',
  'content.updated',
  'content.archived',
  'sso_connection.created',
  'sso_connection.updated',
  'sso_connection.activated',
  'sso_connection.deactivated',
  /** Any status change; details `{ from, to }`. */
  'sso_connection.changed',
  'sso_connection.tested',
  'sso_domain.added',
  'sso_domain.verified',
  'data.erasure.requested',
  // CMS media and editorial workflow (CMS-EE)
  'media.uploaded',
  'media.rejected',
  'media.updated',
  'media.deleted',
  'content.submitted',
  'content.approved',
  'content.changes_requested',
  'publication.created',
  // Consultations and webinars (NS-CALLS-01, decision record section 7)
  'appointment.created',
  'appointment.canceled',
  'appointment.completed',
  'appointment.no_show',
  'appointment.follow_up.proposed',
  'appointment.confirmed',
  'appointment.declined',
  'appointment.times_suggested',
  'appointment.approval.requested',
  'appointment.approval.approved',
  'appointment.approval.rejected',
  'appointment.approval.expired',
  'appointment.approval.missing_approver',
  'org.follow_up_policy.changed',
  'call.session.created',
  'call.joined',
  'call.ended',
  'call.outcome.recorded',
  'call.feedback.submitted',
  'call.diagnostics.viewed',
  'call.ticket.issued',
  'call.problem.reported',
  'webinar.created',
  'webinar.updated',
  'webinar.published',
  'webinar.canceled',
  'webinar.started',
  'webinar.ended',
  'webinar.registered',
  'webinar.unregistered',
  'webinar.joined',
  'webinar.message.submitted',
  'webinar.message.published',
  'webinar.message.answered',
  'webinar.message.dismissed',
  'webinar.floor.given',
  'webinar.floor.taken',
  // WBN-26 (T-CW-2.1): a host mutes the floor holder, asks them to unmute, and the attendee consents.
  'webinar.floor.muted',
  'webinar.floor.unmute_requested',
  'webinar.floor.unmuted',
  'webinar.poll.opened',
  'webinar.poll.closed',
  'webinar.recording.started',
  'webinar.recording.stopped',
  'webinar.recording.ready',
  'webinar.recording.handed_off',
  'webinar.recording.failed',
  'webinar.attendance.viewed',
  'webinar.certificate.issued',
  // Employee listening (ADR 0002; spec CFG-01, CFG-03, SUR-01..04, REP, REV-01).
  // Details carry ids, versions, counts and field names: never an answer, a
  // participant or a score of a hidden cell.
  'listening.configuration.changed',
  'listening.questionnaire.created',
  'listening.questionnaire.updated',
  'listening.questionnaire.submitted',
  'listening.questionnaire.published',
  'listening.questionnaire.archived',
  'listening.cycle.scheduled',
  'listening.cycle.launched',
  'listening.cycle.canceled',
  'listening.cycle.finalized',
  'listening.cycle.failed',
  'listening.reminders.sent',
  'listening.report.read',
  'listening.export.generated',
  'listening.offer.dismissed',
  // Organizational feedback cases (ADR 0002; spec FBK-01..06). Details carry
  // ids, states, route kinds and field names: never a message body, an
  // explanation or the reporter. Rows written on the reporter's behalf carry
  // no actor (`actorUserId: null`, `actorKind: 'SYSTEM'`).
  'feedback_route.changed',
  'feedback_case.created',
  'feedback_case.read',
  'feedback_case.message_sent',
  'feedback_case.reporter_replied',
  'feedback_case.state_changed',
  'feedback_case.reassigned',
  'feedback_case.escalated',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditCategory =
  | 'SECURITY'
  | 'ADMIN'
  | 'AUTHORIZATION'
  | 'CONTENT_ACCESS'
  | 'FINANCIAL';

const CATEGORY_MAP: ReadonlyMap<AuditAction, AuditCategory> = new Map<AuditAction, AuditCategory>(
  AUDIT_ACTIONS.map((action) => [action, resolveCategory(action)]),
);

function resolveCategory(action: AuditAction): AuditCategory {
  if (action.startsWith('auth.')) return 'SECURITY';
  // API-R-27: suspension is a security event (3-year tier), not an admin change.
  if (action === 'user.suspended') return 'SECURITY';
  if (action.startsWith('identity.')) return 'ADMIN';
  if (action.startsWith('invitation.')) return 'ADMIN';
  if (action.startsWith('membership.')) return 'ADMIN';
  if (action.startsWith('org_unit.')) return 'ADMIN';
  if (action.startsWith('user.')) return 'ADMIN';
  if (action.startsWith('grant.')) return 'AUTHORIZATION';
  if (action === 'approval_authority.changed') return 'AUTHORIZATION';
  if (action === 'access.denied') return 'AUTHORIZATION';
  if (action.startsWith('emergency_access.')) return 'AUTHORIZATION';
  if (action === 'export.generated') return 'CONTENT_ACCESS';
  if (action.startsWith('content.')) return 'CONTENT_ACCESS';
  if (action.startsWith('sso_connection.')) return 'ADMIN';
  if (action.startsWith('sso_domain.')) return 'ADMIN';
  if (action === 'data.erasure.requested') return 'ADMIN';
  if (action.startsWith('media.')) return 'CONTENT_ACCESS';
  if (action === 'publication.created') return 'CONTENT_ACCESS';
  // NS-CALLS-01 (guidelines 7.5, CW-R-27a, CW-R-33b): completion and no-show
  // and the outcome feed settlement; joins and tickets prove who was in the
  // room; messages, the floor and recordings are content access.
  if (action === 'appointment.completed' || action === 'appointment.no_show') return 'FINANCIAL';
  if (action.startsWith('appointment.')) return 'ADMIN';
  if (action === 'org.follow_up_policy.changed') return 'ADMIN';
  if (action === 'call.outcome.recorded') return 'FINANCIAL';
  if (action === 'call.joined' || action === 'call.ticket.issued') return 'SECURITY';
  if (action === 'call.diagnostics.viewed' || action === 'call.problem.reported') return 'CONTENT_ACCESS';
  if (action.startsWith('call.')) return 'ADMIN';
  if (action === 'webinar.joined') return 'SECURITY';
  // Per-registrant presence is personal data, read like the call diagnostics (WBN-33, T-CW-2.5).
  if (action === 'webinar.attendance.viewed') return 'CONTENT_ACCESS';
  if (
    action.startsWith('webinar.message.') ||
    action.startsWith('webinar.floor.') ||
    action.startsWith('webinar.recording.')
  ) {
    return 'CONTENT_ACCESS';
  }
  if (action.startsWith('webinar.')) return 'ADMIN';
  // Employee listening (ADR 0002): reads of protected reports and exports are
  // content access; configuration, questionnaire and cycle changes are admin.
  if (action === 'listening.report.read' || action === 'listening.export.generated') return 'CONTENT_ACCESS';
  if (action.startsWith('listening.')) return 'ADMIN';
  // Feedback cases: a handler opening a case is content access; the rest is case administration.
  if (action === 'feedback_case.read') return 'CONTENT_ACCESS';
  if (action.startsWith('feedback_case.') || action.startsWith('feedback_route.')) return 'ADMIN';
  // Exhaustive fallback — should never be reached.
  return 'ADMIN';
}

/** Return the audit category for a given action. */
export function categoryFor(action: AuditAction): AuditCategory {
  return CATEGORY_MAP.get(action)!;
}
