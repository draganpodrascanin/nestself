/**
 * ApprovalService: follow-up approval items and the organization's follow-up
 * policy (T-CW-1.10, D-CW-37, CALL-36, CALL-40, CALL-41, guidelines 4.5, 7.1,
 * 7.4 and 7.5).
 *
 * - Request (bound to `FOLLOW_UP_APPROVAL`): when a follow-up is confirmed
 *   under `manager_approval`, `FollowUpService` has moved it to
 *   `awaiting_approval` and calls {@link request} in the same transaction.
 *   The approver is selected from the organization's approval authorities
 *   (`approval-selection.ts`) for the employee's unit. Without one the
 *   confirmation fails visibly with 409 `approver_missing` (FollowUpService
 *   audits `appointment.approval.missing_approver` after the rollback) and
 *   the follow-up stays `proposed`. Otherwise a `pending` row is inserted in
 *   the transaction; after the commit ({@link afterCommit})
 *   `appointment.approval.requested` is audited, the approver and the
 *   alternate emailed and the
 *   reminder (5 working days) and expiry (10 working days) jobs scheduled.
 * - List (`GET /orgs/:orgId/appointment-approvals`): the items the caller
 *   approves or is the alternate for, as the approver's DTO (`approval-dto.ts`).
 * - Approve and reject (`POST /appointment-approvals/:id/approve|reject`):
 *   the guard has already required `approval.decide` on the item's
 *   organization and `approvalResource` has answered 404 to anybody but the
 *   item's approver and alternate. Here the engine runs again with the
 *   employee as the requester, so its self-approval step applies (403
 *   `self_approval_denied` unless the organization allows it), and the
 *   caller's authority must still cover the employee's unit (404 otherwise).
 *   The item moves from `pending` only (409 `approval_not_pending`) and the
 *   appointment from `awaiting_approval` to `confirmed` (reminders scheduled,
 *   calendar emails) or `declined` (the safe reason goes to the employee and
 *   nowhere else, never into the audit log).
 * - Lapse: an item is decidable until the earlier of the proposed start and
 *   ten working days. {@link remindDeciders} emails the approver and the
 *   alternate while the item is pending; {@link expire} moves a still-pending
 *   item to `expired` and its appointment to `declined`, removes its jobs,
 *   audits `appointment.approval.expired` and tells the employee. A decision
 *   or a reminder after the start runs the same lapse first (409
 *   `approval_not_pending` for the decision), since the jobs are best effort.
 * - Self-approval off and the employee routed their own follow-up: they get
 *   no email, do not see the item and may not decide it; the alternate can.
 * - Policy (`GET|PATCH /orgs/:orgId/settings/follow-up-approval`, HR with
 *   `program.overview`): a change audits `org.follow_up_policy.changed`.
 *
 * Audit details carry identifiers and policies only (guidelines 7.5, CW-R-33a).
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  type AppointmentApprovalItem,
  type AppointmentApprovalListResponse,
  type FollowUpApprovalPolicy,
  type FollowUpApprovalPolicyResponse,
  type Principal,
  type Resource,
} from '@nestself/contracts';
import type { AuditAction } from '../audit/audit-events.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter } from '../audit/audit-writer.js';
import { authorize } from '../authz/authorize.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ContextLoader } from '../authz/context-loader.js';
import { ApiHttpException } from '../common/api-error.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db/db.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { MembershipsRepository } from '../db/repositories/memberships.repository.js';
import type {
  ApprovalReminderRecipient,
  CallsJobContext,
  CallsJobData,
} from '../jobs/calls-job-scheduler.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { CallsJobSchedulerService } from '../jobs/calls-job-scheduler.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AppointmentsRepository, type AppointmentRecord } from './appointments.repository.js';
import { toApprovalItem } from './approval-dto.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ApprovalNotifier } from './approval-notifier.js';
import { approvalDeadlines } from './approval-schedule.js';
import { mayDecide, selectApprover, type SelectedApprover, type UnitAncestry } from './approval-selection.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ApprovalRepository, type ApprovalRow } from './approval.repository.js';
import { APPROVAL_RESOURCE_TYPE, isNamedDecider } from './approval.resolver.js';
import { approverMissing, type FollowUpApprovalRequester } from './follow-up-approval.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { FollowUpPolicyReader } from './follow-up-policy.js';

export type ApprovalDecision = { decision: 'approve' } | { decision: 'reject'; reason: string };

export interface ApprovalJobResult {
  approvalId: string;
  /** `started`: the proposed start has passed, so the item lapsed instead. */
  skipped?: 'not_found' | 'status' | 'started';
  sentTo?: ApprovalReminderRecipient[];
  expired?: boolean;
}

function notFound(): ApiHttpException {
  return new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
}

/** 409 `approval_not_pending`: the item was already decided or has expired. */
function approvalNotPending(): ApiHttpException {
  return new ApiHttpException({
    status: 409,
    code: 'approval_not_pending',
    message: 'This approval has already been decided or has expired',
  });
}

/** 403 `self_approval_denied`: the decider is the employee and the organization does not allow it. */
function selfApprovalDenied(): ApiHttpException {
  return new ApiHttpException({
    status: 403,
    code: 'self_approval_denied',
    message: 'You cannot decide your own follow-up',
  });
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

@Injectable()
export class ApprovalService implements FollowUpApprovalRequester {
  private readonly logger = new Logger(ApprovalService.name);

  constructor(
    private readonly repo: ApprovalRepository,
    private readonly appointments: AppointmentsRepository,
    private readonly memberships: MembershipsRepository,
    private readonly dbs: DbService,
    private readonly audit: AuditWriter,
    private readonly callsJobs: CallsJobSchedulerService,
    private readonly contextLoader: ContextLoader,
    private readonly policies: FollowUpPolicyReader,
    private readonly notifier: ApprovalNotifier,
  ) {}

  // ── Approver selection (guidelines 7.4) ───────────────────────────────────

  /** The approver and alternate for an employee of `orgId` in `employeeOrgUnitId`; null when nobody covers them. */
  async findApprover(
    orgId: string,
    employeeOrgUnitId: string | null,
    employeeUserId: string,
    tx?: DbExecutor,
    now: Date = new Date(),
  ): Promise<SelectedApprover | null> {
    const authorities = await this.repo.authoritiesOf(orgId, tx);
    const ancestry = await this.repo.ancestryOf(employeeOrgUnitId, tx);
    const selfApprovalAllowed = await this.repo.selfApprovalAllowed(orgId, tx);
    return selectApprover(authorities, { ancestry, employeeUserId, now, selfApprovalAllowed });
  }

  // ── Request (FOLLOW_UP_APPROVAL, CALL-36) ─────────────────────────────────

  /**
   * Inside the confirming transaction: the `pending` row for the selected
   * approver, or 409 `approver_missing` (FollowUpService audits it after the
   * rollback). Nothing here takes a second pool connection.
   */
  async request(appointment: AppointmentRecord, tx: DbExecutor, _actorUserId: string): Promise<void> {
    await this.createApprovalItem(appointment, tx);
  }

  /** After the commit: `appointment.approval.requested`, the approver's and the alternate's email and the jobs. */
  async afterCommit(appointment: AppointmentRecord, actorUserId: string): Promise<void> {
    const row = await this.repo.findPendingByAppointment(appointment.id);
    if (!row) return;
    await this.record('appointment.approval.requested', actorUserId, 'USER', row, {
      approverUserId: row.approverUserId,
    });
    await this.scheduleApprovalJobs(row, appointment);
    const names = await this.repo.displayNamesOf([appointment.employeeUserId]);
    const name = names.get(appointment.employeeUserId) ?? '';
    for (const userId of await this.decidersToNotify(row, appointment)) {
      await this.notifier.requested(appointment, userId, name);
    }
  }

  /**
   * The approver and the alternate, without the employee when they were routed
   * their own follow-up and the organization does not allow self-approval: the
   * item is not theirs to decide, so they get no email and do not see it.
   */
  private async decidersToNotify(
    row: Pick<ApprovalRow, 'orgId' | 'approverUserId' | 'alternateUserId'>,
    appointment: Pick<AppointmentRecord, 'employeeUserId'>,
  ): Promise<string[]> {
    const selfApprovalAllowed = await this.repo.selfApprovalAllowed(row.orgId);
    return [row.approverUserId, row.alternateUserId].filter(
      (userId): userId is string => !!userId && (selfApprovalAllowed || userId !== appointment.employeeUserId),
    );
  }

  /** The `pending` row routed to the approver chosen for the employee's unit; 409 `approver_missing` without one. */
  async createApprovalItem(appointment: AppointmentRecord, tx: DbExecutor): Promise<ApprovalRow> {
    const membership = await this.memberships.findActiveByUserAndOrg(appointment.employeeUserId, appointment.orgId, tx);
    const orgUnitId = membership?.orgUnitId ?? null;
    const selected = await this.findApprover(appointment.orgId, orgUnitId, appointment.employeeUserId, tx);
    if (!selected) throw approverMissing();
    return this.repo.insert(
      {
        appointmentId: appointment.id,
        orgId: appointment.orgId,
        orgUnitId,
        approverUserId: selected.approverUserId,
        alternateUserId: selected.alternateUserId,
      },
      tx,
    );
  }

  // ── List ──────────────────────────────────────────────────────────────────

  /**
   * The caller's items, read in one organization-scoped transaction with the
   * appointments batched. A pending item is listed only while the caller may
   * still decide it: their authority still covers the employee's unit, and
   * they are not the employee unless the organization allows self-approval.
   * Decided items stay listed as history.
   */
  async list(orgId: string, principal: Principal): Promise<AppointmentApprovalListResponse> {
    return this.dbs.withOrgScope(orgId, async (tx) => {
      const rows = await this.repo.listForDecider(orgId, principal.userId, tx);
      if (rows.length === 0) return { items: [] };
      const facts = await this.repo.appointmentFactsOf(
        rows.map((row) => row.appointmentId),
        tx,
      );
      const authorities = await this.repo.authoritiesOf(orgId, tx);
      const selfApprovalAllowed = await this.repo.selfApprovalAllowed(orgId, tx);
      const ancestries = new Map<string | null, UnitAncestry | null>();
      for (const unitId of new Set(rows.map((row) => row.orgUnitId))) {
        ancestries.set(unitId, await this.repo.ancestryOf(unitId, tx));
      }
      const names = await this.repo.displayNamesOf(
        [...facts.values()].map((a) => a.employeeUserId),
        tx,
      );
      const now = new Date();
      const items: AppointmentApprovalItem[] = [];
      for (const row of rows) {
        const appointment = facts.get(row.appointmentId);
        if (!appointment) continue;
        if (row.status === 'PENDING') {
          if (!mayDecide(principal.userId, authorities, ancestries.get(row.orgUnitId) ?? null, now)) continue;
          if (!selfApprovalAllowed && appointment.employeeUserId === principal.userId) continue;
        }
        items.push(toApprovalItem(row, appointment, names.get(appointment.employeeUserId) ?? ''));
      }
      return { items };
    });
  }

  // ── Approve and reject (CW-R-116) ─────────────────────────────────────────

  async decide(approvalId: string, principal: Principal, decision: ApprovalDecision): Promise<AppointmentApprovalItem> {
    const row = await this.repo.findById(approvalId);
    if (!row || !isNamedDecider(row, principal.userId)) throw notFound();
    const appointment = await this.appointments.findById(row.appointmentId);
    if (!appointment) throw notFound();

    await this.requireDecider(principal, row, appointment);
    if (row.status !== 'PENDING') throw approvalNotPending();

    const now = new Date();
    if (appointment.startsAt.getTime() <= now.getTime()) {
      // Too late to book: the item lapses now, whether or not the expiry job ran.
      await this.expire(row.id, now, 'SYSTEM');
      throw approvalNotPending();
    }
    const approve = decision.decision === 'approve';
    const reason = decision.decision === 'reject' ? decision.reason : null;
    const { decided, moved } = await this.dbs.withOrgScope(row.orgId, async (tx) => {
      const decidedRow = await this.repo.decideFromPending(row.id, approve ? 'APPROVED' : 'REJECTED', reason, now, tx);
      if (!decidedRow) throw approvalNotPending();
      const movedAppointment = await this.appointments.updateFromStatus(
        appointment.id,
        'awaiting_approval',
        approve ? 'confirmed' : 'declined',
        {},
        tx,
      );
      // The appointment was canceled or changed meanwhile: the decision rolls back.
      if (!movedAppointment) throw approvalNotPending();
      return { decided: decidedRow, moved: movedAppointment };
    });

    await this.record(
      approve ? 'appointment.approval.approved' : 'appointment.approval.rejected',
      principal.userId,
      'USER',
      decided,
      { approverUserId: principal.userId },
    );
    await this.bestEffort(decided, 'cancelApprovalJobs', () => this.callsJobs.cancelApprovalJobs(decided.id));
    if (approve) {
      await this.bestEffort(decided, 'scheduleReminders', () =>
        this.callsJobs.scheduleReminders({ id: moved.id, startsAt: moved.startsAt }),
      );
      await this.notifier.approved(moved);
    } else {
      await this.bestEffort(decided, 'cancelAppointmentJobs', () => this.callsJobs.cancelAppointmentJobs(moved.id));
      await this.notifier.rejected(moved, reason ?? '');
    }
    const names = await this.repo.displayNamesOf([moved.employeeUserId]);
    return toApprovalItem(decided, moved, names.get(moved.employeeUserId) ?? '');
  }

  /**
   * The engine's verdict with the employee as the requester (its step 6, the
   * self-approval rule) and the authority check: the caller's authority must
   * still cover the employee's unit. Denials are audited as `access.denied`.
   */
  private async requireDecider(principal: Principal, row: ApprovalRow, appointment: AppointmentRecord): Promise<void> {
    const resource: Resource = {
      type: APPROVAL_RESOURCE_TYPE,
      id: row.id,
      orgId: row.orgId,
      ...(row.orgUnitId ? { orgUnitId: row.orgUnitId } : {}),
    };
    const ctx = await this.contextLoader.build(principal, resource, { action: 'approval.decide' });
    const verdict = authorize(principal, 'approval.decide', resource, { ...ctx, requesterId: appointment.employeeUserId });
    let reason = verdict.denialReason;
    if (verdict.allowed) {
      const authorities = await this.repo.authoritiesOf(row.orgId);
      const ancestry = await this.repo.ancestryOf(row.orgUnitId);
      if (mayDecide(principal.userId, authorities, ancestry, ctx.now)) return;
      reason = 'approval_authority_not_covering';
    }
    await this.audit.record({
      action: 'access.denied',
      actorUserId: principal.userId,
      actorKind: 'USER',
      orgId: row.orgId,
      recordType: APPROVAL_RESOURCE_TYPE,
      recordId: row.id,
      result: 'DENIED',
      details: {
        actionAttempted: 'approval.decide',
        resourceType: APPROVAL_RESOURCE_TYPE,
        resourceId: row.id,
        reason,
      },
    });
    if (reason === 'self_approval_denied') throw selfApprovalDenied();
    throw notFound();
  }

  // ── Jobs (CALL-40) ────────────────────────────────────────────────────────

  /** `appointment.approval.remind`: the approver and the alternate, while the item is pending. */
  async remindDeciders(
    data: CallsJobData['appointment.approval.remind'],
    context: CallsJobContext<'appointment.approval.remind'>,
  ): Promise<ApprovalJobResult> {
    const sentTo = [...(data.sentTo ?? [])];
    const row = await this.repo.findById(data.approvalId);
    if (!row) return { approvalId: data.approvalId, skipped: 'not_found', sentTo };
    const appointment = await this.appointments.findById(row.appointmentId);
    if (row.status !== 'PENDING' || appointment?.status !== 'awaiting_approval') {
      return { approvalId: row.id, skipped: 'status', sentTo };
    }
    if (appointment.startsAt.getTime() <= Date.now()) {
      await this.expire(row.id);
      return { approvalId: row.id, skipped: 'started', sentTo };
    }
    const names = await this.repo.displayNamesOf([appointment.employeeUserId]);
    const name = names.get(appointment.employeeUserId) ?? '';
    const deciders = await this.decidersToNotify(row, appointment);
    const recipients: [ApprovalReminderRecipient, string | null][] = [
      ['approver', row.approverUserId],
      ['alternate', row.alternateUserId],
    ];
    for (const [role, userId] of recipients) {
      if (!userId || sentTo.includes(role) || !deciders.includes(userId)) continue;
      await this.notifier.reminder(appointment, userId, name);
      sentTo.push(role);
      await context.updateData({ ...data, sentTo });
    }
    this.logger.log({ approvalId: row.id, operation: 'remindDeciders', sentTo }, 'Approval reminder sent');
    return { approvalId: row.id, sentTo };
  }

  /**
   * `appointment.approval.expire`, and the lapse at the proposed start: a
   * still-pending item expires, its follow-up is declined, its jobs are removed
   * and the employee is told.
   */
  async expire(approvalId: string, now: Date = new Date(), actorKind: 'JOB' | 'SYSTEM' = 'JOB'): Promise<ApprovalJobResult> {
    const row = await this.repo.findById(approvalId);
    if (!row) return { approvalId, skipped: 'not_found', expired: false };
    if (row.status !== 'PENDING') return { approvalId, skipped: 'status', expired: false };

    const result = await this.dbs.withOrgScope(row.orgId, async (tx) => {
      const expired = await this.repo.decideFromPending(row.id, 'EXPIRED', null, now, tx);
      if (!expired) return null;
      const moved = await this.appointments.updateFromStatus(row.appointmentId, 'awaiting_approval', 'declined', {}, tx);
      return { expired, moved };
    });
    if (!result) return { approvalId, skipped: 'status', expired: false };

    await this.record('appointment.approval.expired', null, actorKind, result.expired, {});
    await this.bestEffort(result.expired, 'cancelApprovalJobs', () => this.callsJobs.cancelApprovalJobs(approvalId));
    if (result.moved) {
      const moved = result.moved;
      await this.bestEffort(result.expired, 'cancelAppointmentJobs', () => this.callsJobs.cancelAppointmentJobs(moved.id));
      await this.notifier.expired(moved);
    }
    this.logger.log({ approvalId, operation: 'expire' }, 'Approval expired');
    return { approvalId, expired: true };
  }

  // ── Policy (CALL-41) ──────────────────────────────────────────────────────

  async getPolicy(orgId: string): Promise<FollowUpApprovalPolicyResponse> {
    return { policy: await this.policies.policyOf(orgId) };
  }

  async setPolicy(orgId: string, policy: FollowUpApprovalPolicy, principal: Principal): Promise<FollowUpApprovalPolicyResponse> {
    const previous = await this.dbs.withTransaction((tx) => this.repo.replacePolicy(orgId, policy, tx));
    if (previous === null) throw notFound();
    if (previous !== policy) {
      await this.audit.record({
        action: 'org.follow_up_policy.changed',
        actorUserId: principal.userId,
        actorKind: 'USER',
        orgId,
        recordType: 'organization',
        recordId: orgId,
        result: 'ALLOWED',
        details: { orgId, oldPolicy: previous, newPolicy: policy },
      });
    }
    return { policy };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async record(
    action: AuditAction,
    actorUserId: string | null,
    actorKind: 'USER' | 'JOB' | 'SYSTEM',
    row: ApprovalRow,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      action,
      actorUserId,
      actorKind,
      orgId: row.orgId,
      recordType: APPROVAL_RESOURCE_TYPE,
      recordId: row.id,
      result: 'ALLOWED',
      details: { approvalId: row.id, appointmentId: row.appointmentId, ...details },
    });
  }

  /**
   * The reminder and expiry jobs (expiry at the earlier of ten working days and
   * the proposed start). Best effort: without them, a decision or a reminder
   * after the start still lapses the item.
   */
  private async scheduleApprovalJobs(row: ApprovalRow, appointment: Pick<AppointmentRecord, 'startsAt'>): Promise<void> {
    await this.bestEffort(row, 'scheduleApprovalJobs', () =>
      this.callsJobs.scheduleApprovalJobs(row.id, approvalDeadlines(row.createdAt, appointment.startsAt)),
    );
  }

  private async bestEffort(row: Pick<ApprovalRow, 'id'>, operation: string, run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.logger.error({ approvalId: row.id, operation, error: errorName(error) }, 'Approval job operation failed');
    }
  }
}
