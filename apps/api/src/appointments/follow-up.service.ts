/**
 * FollowUpService: the post-call follow-up lifecycle (T-CW-1.9, D-CW-37,
 * CALL-35 to CALL-38, guidelines 4.5 and 7.1).
 *
 * Who does what (the guard has already allowed the route's action on the
 * appointment through `appointmentResource`; anybody without it gets 404 from
 * `AppointmentNonDisclosureFilter`):
 *
 * - Propose (`POST /appointments/:id/follow-up`, `appointment.propose` on the
 *   finished consultation): its expert only, once its latest outcome is
 *   `completed` (409 `follow_up_not_allowed` otherwise, CW-R-105), and while
 *   it has no other open follow-up (`proposed` or `awaiting_approval`, 409
 *   `follow_up_not_allowed`; proposals on one consultation are serialised by
 *   a row lock). The body is `{ startsAt, durationMinutes, timeZone }` and
 *   nothing else (D-CW-04): the start must be in the future and the time zone
 *   must be the consultation's, in which the client converted the picked
 *   wall-clock time. The new appointment is `proposed`, `follow_up_of` the
 *   consultation, with the same organization, expert, employee, service
 *   category and time zone, and its own CASE assignment for the expert (as
 *   at creation), so the expert can schedule and join it. Reminder jobs are
 *   scheduled now; they fire only once it is `confirmed` (CW-R-37).
 * - Confirm, suggest times, decline (`consultation.join` on the follow-up):
 *   its employee only (the expert also holds `consultation.join`, and gets
 *   404 like anybody else), while it is `proposed` (409
 *   `appointment_not_proposed`).
 *   - Confirm follows the organization's `follow_up_approval_policy`:
 *     `automatic` confirms it (reminders, calendar email to both parties);
 *     `manager_approval` moves it to `awaiting_approval` and hands it to the
 *     {@link FOLLOW_UP_APPROVAL} requester in the same transaction, so a
 *     refusal (409 `approver_missing` until T-CW-1.10) leaves it `proposed`.
 *   - Suggest times stores one to three `{ startsAt, endsAt }` windows (a
 *     second suggestion replaces the first). Each must start in the future
 *     and be long enough for the proposed duration. The status stays
 *     `proposed`.
 *   - Decline moves it to `declined`, removes its reminder jobs and tells the
 *     expert. The consultation may then get a new proposal.
 * - Schedule (`POST /appointments/:id/schedule`, `appointment.propose` on the
 *   follow-up): its expert only, while `proposed` with suggested windows; the
 *   picked window's start becomes the start, the proposed duration is kept,
 *   and the same policy applies as for a confirmation.
 *
 * Every status change is checked by `canTransitionAppointment` and applied
 * only from the status that was read, so two concurrent responses cannot both
 * succeed. Audit details carry identifiers only (guidelines 7.5, CW-R-33a).
 * Room events and emails go out after the commit (`FollowUpNotifier`).
 */
import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type AppointmentFollowUpRequest,
  type AppointmentResponse,
  type AppointmentStatus,
  type AppointmentSuggestTimesRequest,
  type FollowUpApprovalPolicy,
  type FollowUpScheduleRequest,
  type FollowUpTimeWindow,
  FOLLOW_UP_MAX_SUGGESTED_WINDOWS,
  type Principal,
} from '@nestself/contracts';
import type { AuditAction } from '../audit/audit-events.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter } from '../audit/audit-writer.js';
import { ApiHttpException } from '../common/api-error.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService } from '../db/db.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { CallsJobSchedulerService } from '../jobs/calls-job-scheduler.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { PrincipalLoader } from '../principal/principal-loader.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AppointmentsRepository, type AppointmentRecord } from './appointments.repository.js';
import { FOLLOW_UP_APPROVAL, type FollowUpApprovalRequester } from './follow-up-approval.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { FollowUpCallRoom } from './follow-up-call-room.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { FollowUpNotifier } from './follow-up-notifier.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { FollowUpPolicyReader } from './follow-up-policy.js';

const MINUTE_MS = 60_000;

function notFound(): ApiHttpException {
  return new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
}

function invalidField(field: string, message: string): ApiHttpException {
  return new ApiHttpException({ status: 400, code: 'validation', message, details: { field } });
}

/** 409 `follow_up_not_allowed`: the outcome is not `completed`, or a follow-up is already open (CW-R-105). */
function followUpNotAllowed(message: string): ApiHttpException {
  return new ApiHttpException({ status: 409, code: 'follow_up_not_allowed', message });
}

/** 409 `appointment_not_proposed`: the appointment is not (or no longer) a `proposed` follow-up. */
function notProposed(): ApiHttpException {
  return new ApiHttpException({
    status: 409,
    code: 'appointment_not_proposed',
    message: 'The appointment is not a proposed follow-up',
  });
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

function durationMsOf(appointment: Pick<AppointmentRecord, 'startsAt' | 'endsAt'>): number {
  return appointment.endsAt.getTime() - appointment.startsAt.getTime();
}

/** Where a confirmation lands under each policy. */
const CONFIRMATION_TARGET: Readonly<Record<FollowUpApprovalPolicy, Extract<AppointmentStatus, 'confirmed' | 'awaiting_approval'>>> = {
  automatic: 'confirmed',
  manager_approval: 'awaiting_approval',
};

@Injectable()
export class FollowUpService {
  private readonly logger = new Logger(FollowUpService.name);

  constructor(
    private readonly repo: AppointmentsRepository,
    private readonly dbs: DbService,
    private readonly principals: PrincipalLoader,
    private readonly audit: AuditWriter,
    private readonly callsJobs: CallsJobSchedulerService,
    private readonly policies: FollowUpPolicyReader,
    @Inject(FOLLOW_UP_APPROVAL) private readonly approvals: FollowUpApprovalRequester,
    private readonly callRoom: FollowUpCallRoom,
    private readonly notifier: FollowUpNotifier,
  ) {}

  // ── Propose (CALL-35) ─────────────────────────────────────────────────────

  async propose(consultationId: string, body: AppointmentFollowUpRequest, actor: Principal): Promise<AppointmentResponse> {
    const consultation = await this.repo.findById(consultationId);
    if (!consultation || consultation.expertUserId !== actor.userId) throw notFound();

    const now = new Date();
    const startsAt = new Date(body.startsAt);
    if (startsAt.getTime() <= now.getTime()) throw invalidField('startsAt', 'The follow-up must start in the future');
    if (body.timeZone !== consultation.timeZone) {
      throw invalidField('timeZone', 'The follow-up is proposed in the consultation’s time zone');
    }
    if ((await this.callRoom.latestOutcomeStatus(consultation)) !== 'completed') {
      throw followUpNotAllowed('A follow-up can be proposed only after a completed consultation');
    }

    const created = await this.dbs.withOrgScope(consultation.orgId, async (tx) => {
      // Serialises proposals on this consultation: the open-follow-up check below cannot race.
      if (!(await this.repo.lockById(consultation.id, tx))) throw notFound();
      if (await this.repo.findOpenFollowUp(consultation.id, tx)) {
        throw followUpNotAllowed('This consultation already has an open follow-up');
      }
      const record = await this.repo.create(
        {
          id: randomUUID(),
          orgId: consultation.orgId,
          expertUserId: consultation.expertUserId,
          employeeUserId: consultation.employeeUserId,
          startsAt,
          endsAt: new Date(startsAt.getTime() + body.durationMinutes * MINUTE_MS),
          status: 'proposed',
          serviceCategory: consultation.serviceCategory,
          timeZone: consultation.timeZone,
          fundingRef: null,
          followUpOf: consultation.id,
          proposedAt: now,
        },
        tx,
      );
      await this.repo.assignExpert(record, actor.userId, tx);
      return record;
    });

    await this.record('appointment.follow_up.proposed', actor, created, {
      followUpOfId: consultation.id,
      expertUserId: created.expertUserId,
    });
    // The new CASE assignment must reach the expert's next decision, not after the cache TTL.
    await this.principals.invalidateUser(created.expertUserId);
    await this.scheduleReminders(created);
    await this.notifier.proposed(created);
    return this.repo.toResponse(created);
  }

  // ── Confirm (CALL-36) ─────────────────────────────────────────────────────

  async confirm(followUpId: string, actor: Principal): Promise<AppointmentResponse> {
    const followUp = await this.proposedFollowUp(followUpId, actor, 'employee');
    const now = new Date();
    return this.confirmWith(followUp, actor, { respondedAt: now });
  }

  // ── Suggest times (CALL-37) ───────────────────────────────────────────────

  async suggestTimes(
    followUpId: string,
    body: AppointmentSuggestTimesRequest,
    actor: Principal,
  ): Promise<AppointmentResponse> {
    const followUp = await this.proposedFollowUp(followUpId, actor, 'employee');
    const windows = this.checkedWindows(body.windows, durationMsOf(followUp), new Date());

    const updated = await this.dbs.withOrgScope(followUp.orgId, (tx) =>
      this.repo.updateFromStatus(followUp.id, 'proposed', null, { suggestedWindows: windows, respondedAt: new Date() }, tx),
    );
    if (!updated) throw notProposed();

    await this.record('appointment.times_suggested', actor, updated, { windowCount: windows.length });
    await this.notifier.timesSuggested(updated, windows);
    return this.repo.toResponse(updated);
  }

  // ── Schedule (CALL-37 criterion 4) ────────────────────────────────────────

  async schedule(followUpId: string, body: FollowUpScheduleRequest, actor: Principal): Promise<AppointmentResponse> {
    const followUp = await this.proposedFollowUp(followUpId, actor, 'expert');
    const window = followUp.suggestedWindows?.[body.selectedWindowIndex];
    if (!window) throw invalidField('selectedWindowIndex', 'The employee suggested no window at this index');
    const startsAt = new Date(window.startsAt);
    if (startsAt.getTime() <= Date.now()) throw invalidField('selectedWindowIndex', 'The suggested window has passed');

    return this.confirmWith(followUp, actor, {
      startsAt,
      endsAt: new Date(startsAt.getTime() + durationMsOf(followUp)),
    });
  }

  // ── Decline (CALL-38) ─────────────────────────────────────────────────────

  async decline(followUpId: string, actor: Principal): Promise<AppointmentResponse> {
    const followUp = await this.proposedFollowUp(followUpId, actor, 'employee');
    const declined = await this.dbs.withOrgScope(followUp.orgId, (tx) =>
      this.repo.updateFromStatus(followUp.id, 'proposed', 'declined', { respondedAt: new Date() }, tx),
    );
    if (!declined) throw notProposed();

    await this.record('appointment.declined', actor, declined, { declinedByUserId: actor.userId });
    await this.cancelJobs(declined);
    await this.notifier.declined(declined);
    return this.repo.toResponse(declined);
  }

  // ── Shared ────────────────────────────────────────────────────────────────

  /**
   * The follow-up, when `actor` is its `role` participant (404 otherwise, so a
   * refusal never tells anybody else that it exists) and it is `proposed`
   * (409 `appointment_not_proposed`).
   */
  private async proposedFollowUp(id: string, actor: Principal, role: 'employee' | 'expert'): Promise<AppointmentRecord> {
    const followUp = await this.repo.findById(id);
    if (!followUp) throw notFound();
    const participant = role === 'employee' ? followUp.employeeUserId : followUp.expertUserId;
    if (participant !== actor.userId) throw notFound();
    if (followUp.status !== 'proposed') throw notProposed();
    return followUp;
  }

  /**
   * The confirmation path shared by the employee's confirm and the expert's
   * pick of a window: `confirmed` or `awaiting_approval` per the policy, with
   * `changes` applied in the same update.
   */
  private async confirmWith(
    followUp: AppointmentRecord,
    actor: Principal,
    changes: { respondedAt?: Date; startsAt?: Date; endsAt?: Date },
  ): Promise<AppointmentResponse> {
    const policy = await this.policies.policyOf(followUp.orgId);
    const target = CONFIRMATION_TARGET[policy];
    const moved = await this.dbs.withOrgScope(followUp.orgId, async (tx) => {
      const updated = await this.repo.updateFromStatus(followUp.id, 'proposed', target, changes, tx);
      // A refusal throws and rolls the move back: the follow-up stays `proposed` (D-CW-37).
      if (updated && target === 'awaiting_approval') await this.approvals.request(updated, tx, actor.userId);
      return updated;
    });
    if (!moved) throw notProposed();

    await this.record('appointment.confirmed', actor, moved, { confirmedByUserId: actor.userId, policy });
    if (moved.startsAt.getTime() !== followUp.startsAt.getTime()) await this.cancelJobs(moved);
    await this.scheduleReminders(moved);
    await this.notifier.confirmed(moved, target);
    return this.repo.toResponse(moved);
  }

  /**
   * The employee's windows, normalised to ISO instants: one to three, each
   * starting in the future and at least as long as the proposed session.
   */
  private checkedWindows(windows: FollowUpTimeWindow[], durationMs: number, now: Date): FollowUpTimeWindow[] {
    if (windows.length === 0 || windows.length > FOLLOW_UP_MAX_SUGGESTED_WINDOWS) {
      throw invalidField('windows', 'Suggest one to three windows');
    }
    return windows.map((window, index) => {
      const startsAt = new Date(window.startsAt);
      const endsAt = new Date(window.endsAt);
      if (startsAt.getTime() <= now.getTime()) {
        throw invalidField(`windows.${index}.startsAt`, 'A suggested window must start in the future');
      }
      if (endsAt.getTime() - startsAt.getTime() < durationMs) {
        throw invalidField(`windows.${index}.endsAt`, 'A suggested window must fit the proposed session');
      }
      return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
    });
  }

  private async record(
    action: AuditAction,
    actor: Principal,
    appointment: AppointmentRecord,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      action,
      actorUserId: actor.userId,
      actorKind: 'USER',
      orgId: appointment.orgId,
      recordType: 'appointment',
      recordId: appointment.id,
      result: 'ALLOWED',
      details: { appointmentId: appointment.id, ...details },
    });
  }

  /** `appointment.remind` per offset still ahead (CW-R-46); the job skips anything not `confirmed`. Best effort. */
  private async scheduleReminders(appointment: AppointmentRecord): Promise<void> {
    try {
      await this.callsJobs.scheduleReminders({ id: appointment.id, startsAt: appointment.startsAt });
    } catch (error) {
      this.logger.error(
        { appointmentId: appointment.id, operation: 'scheduleReminders', error: errorName(error) },
        'Follow-up reminders not scheduled',
      );
    }
  }

  /** Removes the pending jobs: a declined follow-up, or reminders at a start that moved. Best effort. */
  private async cancelJobs(appointment: AppointmentRecord): Promise<void> {
    try {
      await this.callsJobs.cancelAppointmentJobs(appointment.id);
    } catch (error) {
      // A reminder that still fires re-reads the appointment and skips it (CW-R-37).
      this.logger.warn(
        { appointmentId: appointment.id, operation: 'cancelJobs', error: errorName(error) },
        'Follow-up jobs not removed',
      );
    }
  }
}
