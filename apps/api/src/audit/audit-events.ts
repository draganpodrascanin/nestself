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
  'data.erasure.requested',
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
  'webinar.poll.opened',
  'webinar.poll.closed',
  'webinar.recording.started',
  'webinar.recording.stopped',
  'webinar.recording.ready',
  'webinar.recording.handed_off',
  'webinar.recording.failed',
  'webinar.attendance.viewed',
  'webinar.certificate.issued',
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
  if (action === 'data.erasure.requested') return 'ADMIN';
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
  // Exhaustive fallback — should never be reached.
  return 'ADMIN';
}

/** Return the audit category for a given action. */
export function categoryFor(action: AuditAction): AuditCategory {
  return CATEGORY_MAP.get(action)!;
}
