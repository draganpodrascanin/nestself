/**
 * ReviewEngagementsService: the accepted work (spec REV-03, REV-06, REV-09,
 * REV-10; ADR 0002 D-EL-03, D-EL-11, D-EL-12).
 *
 * - The coordinator assigns a qualified reviewer (an APPROVED
 *   `workplace_review` credential and an engine decision with the planned
 *   CASE assignment) and proposes one to three meeting windows.
 * - The employer requester books one window. The booking runs in a system
 *   transaction under a per-reviewer advisory lock, checks the reviewer's
 *   non-final appointments across organizations for an overlap, and creates
 *   the `appointments` row (`workplace_review`) and the expert's CASE
 *   assignment, so two confirmations cannot both succeed.
 * - Cancel ends the meeting through the appointments spine and the
 *   reviewer's assignment; scores are never touched. Follow-up and completion
 *   are the reviewer's; completion is independent of score colour.
 */
import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  ACTIONS,
  ACTIVE_REVIEW_ENGAGEMENT_STATUSES,
  WORKPLACE_REVIEW_SERVICE_CATEGORY,
  type Action,
  type AssignmentInput,
  type Principal,
  type ReviewAssignRequest,
  type ReviewBookRequest,
  type ReviewCancelRequest,
  type ReviewEngagementListResponse,
  type ReviewEngagementResponse,
  type ReviewFollowUpRequest,
  type ReviewWindowsRequest,
  type ReviewerCandidatesResponse,
} from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AppointmentCancelHooks } from '../appointments/appointment-cancel-hooks.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AppointmentsRepository, type AppointmentRecord } from '../appointments/appointments.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter } from '../audit/audit-writer.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuthorizationService } from '../authz/authorization.service.js';
import { authorize } from '../authz/authorize.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ContextLoader } from '../authz/context-loader.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db/db.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuthorizationRepository } from '../db/repositories/authorization.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { MembershipsRepository } from '../db/repositories/memberships.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { OrganizationsRepository } from '../db/repositories/organizations.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { CallsJobSchedulerService } from '../jobs/calls-job-scheduler.service.js';
import { assemblePrincipal } from '../principal/assemble-principal.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { PrincipalLoader } from '../principal/principal-loader.js';
import { DENY_AS_NOT_FOUND, conflict, notFound, validationError } from './review-errors.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ReviewNotifier } from './review-notifier.js';
import { engagementResourceOf } from './review-resolvers.js';
import { toEngagementResponse } from './review-views.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { REVIEWER_ASSIGNMENT_REASON, WorkplaceReviewsRepository, type EngagementRow } from './workplace-reviews.repository.js';

const REVIEWER_SCAN = 200;
const REVIEWER_LIMIT = 20;

@Injectable()
export class ReviewEngagementsService {
  private readonly logger = new Logger(ReviewEngagementsService.name);

  constructor(
    private readonly dbs: DbService,
    private readonly repo: WorkplaceReviewsRepository,
    private readonly appointments: AppointmentsRepository,
    private readonly cancelHooks: AppointmentCancelHooks,
    private readonly callsJobs: CallsJobSchedulerService,
    private readonly authz: AuthorizationService,
    private readonly authzRepo: AuthorizationRepository,
    private readonly principals: PrincipalLoader,
    private readonly contextLoader: ContextLoader,
    private readonly organizations: OrganizationsRepository,
    private readonly audit: AuditWriter,
    private readonly notifier: ReviewNotifier,
    private readonly memberships: MembershipsRepository,
  ) {}

  /** A follow-up owner is an active member of the engagement's organization, never an account from elsewhere. */
  async assertMember(userId: string, orgId: string, tx: DbExecutor): Promise<void> {
    if (!(await this.memberships.findActiveByUserAndOrg(userId, orgId, tx))) {
      throw validationError('The owner must be an active member of the organization', 'ownerUserId');
    }
  }

  // ── Views ───────────────────────────────────────────────────────────────

  /** The full response of an engagement, loaded in its organization's scope. */
  async response(engagement: EngagementRow, now = new Date()): Promise<ReviewEngagementResponse> {
    return this.dbs.withOrgScope(engagement.orgId, async (tx) => {
      const [request, scope, appointment, grants, versions, actions] = await Promise.all([
        this.repo.findRequest(engagement.requestId, tx),
        this.repo.findScope(engagement.scopeId, tx),
        engagement.appointmentId ? this.appointments.findById(engagement.appointmentId, tx) : Promise.resolve(null),
        this.repo.listSharingGrants(engagement.id, tx),
        this.repo.listReportVersions(engagement.id, tx),
        this.repo.listActions(engagement.id, tx),
      ]);
      if (!request || !scope) throw notFound();
      const sharedReport = [...versions].reverse().find((v) => v.status === 'shared') ?? null;
      const names = await this.repo.displayNames(
        [engagement.reviewerUserId, engagement.coordinatorUserId, engagement.followUpOwnerUserId, sharedReport?.authorUserId, ...actions.map((a) => a.ownerUserId)],
        tx,
      );
      return toEngagementResponse({ engagement, request, scope, appointment, grants, sharedReport, actions, names, now });
    });
  }

  /** The engagement of the organization, or 404. */
  async inOrg(orgId: string, id: string): Promise<EngagementRow> {
    const row = await this.dbs.withOrgScope(orgId, (tx) => this.repo.findEngagement(id, tx));
    if (!row || row.orgId !== orgId) throw notFound();
    return row;
  }

  async get(orgId: string, id: string): Promise<ReviewEngagementResponse> {
    return this.response(await this.inOrg(orgId, id));
  }

  async list(orgId: string): Promise<ReviewEngagementListResponse> {
    const rows = await this.dbs.withOrgScope(orgId, (tx) => this.repo.listEngagements(orgId, tx));
    return { items: await Promise.all(rows.map((r) => this.response(r))) };
  }

  /** The coordinator's view: any engagement by id. */
  async getOps(id: string): Promise<ReviewEngagementResponse> {
    const row = await this.repo.findEngagement(id);
    if (!row) throw notFound();
    return this.response(row);
  }

  // ── Reviewer (expert context) ────────────────────────────────────────────

  /** The engagement the reviewer is assigned to, authorized through the CASE assignment; a denial is a 404. */
  async forReviewer(principal: Principal, id: string, action: Action = ACTIONS['workplace_reviews.engagement.read']): Promise<EngagementRow> {
    const row = await this.repo.findEngagement(id);
    if (!row) throw notFound();
    await this.authz.require(principal, action, engagementResourceOf(row), DENY_AS_NOT_FOUND);
    return row;
  }

  async listForReviewer(principal: Principal, now = new Date()): Promise<ReviewEngagementListResponse> {
    const assigned = await this.authzRepo.findActiveAssignments(principal.userId, now);
    const ids = [...new Set(assigned.filter((a) => a.kind === 'CASE' && a.reason === REVIEWER_ASSIGNMENT_REASON).map((a) => a.targetId))];
    const rows = await this.repo.listEngagementsByIds(ids);
    const items: ReviewEngagementResponse[] = [];
    for (const row of rows) {
      if (await this.authz.allows(principal, ACTIONS['workplace_reviews.engagement.read'], engagementResourceOf(row))) items.push(await this.response(row, now));
    }
    return { items };
  }

  async getForReviewer(principal: Principal, id: string): Promise<ReviewEngagementResponse> {
    return this.response(await this.forReviewer(principal, id));
  }

  // ── Coordinator ─────────────────────────────────────────────────────────

  async reviewerCandidates(q: string | undefined): Promise<ReviewerCandidatesResponse> {
    const candidates = await this.repo.reviewerCandidates(q, REVIEWER_SCAN);
    const items: ReviewerCandidatesResponse['items'] = [];
    for (const candidate of candidates) {
      if (await this.reviewerAllowed(candidate.userId, { id: `candidate_${candidate.userId}`, orgId: 'candidate' })) {
        items.push(candidate);
        if (items.length === REVIEWER_LIMIT) break;
      }
    }
    return { items };
  }

  /**
   * Qualification (D-EL-11): an APPROVED `workplace_review` credential and an
   * engine decision that lets the reviewer read the engagement once the CASE
   * assignment exists (the `workplace_reviewer` template with its category
   * condition). Evaluated with a planned assignment, like `expertMayConsult`.
   */
  async reviewerAllowed(userId: string, engagement: { id: string; orgId: string }): Promise<boolean> {
    if (!(await this.repo.hasReviewerCredential(userId))) return false;
    const loaded = await this.principals.load(userId);
    if (!loaded) return false;
    const reviewer = assemblePrincipal(loaded, { kind: 'expert' });
    const action = ACTIONS['workplace_reviews.engagement.read'];
    const resource = engagementResourceOf(engagement);
    const ctx = await this.contextLoader.build(reviewer, resource, { action, loadedPrincipal: loaded });
    const planned: AssignmentInput = { id: `planned_${engagement.id}`, userId, kind: 'CASE', targetId: engagement.id, startAt: ctx.now, endAt: null };
    return authorize(reviewer, action, resource, { ...ctx, assignments: [...ctx.assignments, planned] }).allowed;
  }

  async assign(id: string, body: ReviewAssignRequest, actor: Principal, now = new Date()): Promise<ReviewEngagementResponse> {
    const engagement = await this.repo.findEngagement(id);
    if (!engagement) throw notFound();
    if (!ACTIVE_REVIEW_ENGAGEMENT_STATUSES.includes(engagement.status)) throw conflict('invalid_state', 'The engagement is no longer active');
    if (!(await this.reviewerAllowed(body.reviewerUserId, engagement))) {
      throw conflict('reviewer_not_qualified', 'The reviewer holds no approved workplace review credential or no reviewer grant');
    }
    const result = await this.dbs.withOrgScope(engagement.orgId, async (tx) => {
      const locked = await this.repo.lockEngagement(id, tx);
      if (!locked) throw notFound();
      if (locked.reviewerUserId === body.reviewerUserId) return { next: locked, previous: null as string | null };
      await this.repo.endReviewerAssignments(id, now, tx);
      await this.repo.insertReviewerAssignment({ userId: body.reviewerUserId, targetId: id, assignedByUserId: actor.userId, startAt: now }, tx);
      const next = await this.repo.updateEngagement(id, { reviewerUserId: body.reviewerUserId, coordinatorUserId: actor.userId }, tx);
      await this.audit.record(
        {
          action: 'workplace_review.reviewer_assigned',
          actorUserId: actor.userId,
          actorKind: 'USER',
          orgId: engagement.orgId,
          recordType: 'review_engagement',
          recordId: id,
          result: 'ALLOWED',
          details: { reviewerUserId: body.reviewerUserId, previousReviewerUserId: locked.reviewerUserId },
        },
        { tx },
      );
      return { next, previous: locked.reviewerUserId };
    });
    await Promise.all([
      this.principals.invalidateUser(body.reviewerUserId),
      result.previous && result.previous !== body.reviewerUserId ? this.principals.invalidateUser(result.previous) : Promise.resolve(),
    ]);
    return this.response(result.next, now);
  }

  async proposeWindows(id: string, body: ReviewWindowsRequest, actor: Principal, now = new Date()): Promise<ReviewEngagementResponse> {
    const engagement = await this.repo.findEngagement(id);
    if (!engagement) throw notFound();
    if (engagement.status !== 'accepted') throw conflict('invalid_state', 'Windows can be proposed only before the meeting is booked');
    if (!engagement.reviewerUserId) throw conflict('reviewer_not_qualified', 'Assign a reviewer before proposing windows');
    if (body.windows.some((w) => Date.parse(w.startsAt) <= now.getTime())) throw conflict('no_windows', 'Every window must start in the future');
    const next = await this.dbs.withOrgScope(engagement.orgId, async (tx) => {
      const updated = await this.repo.updateEngagement(
        id,
        { proposedWindows: body.windows.map((w) => ({ startsAt: w.startsAt, endsAt: w.endsAt })), proposedTimeZone: body.timeZone, coordinatorUserId: actor.userId },
        tx,
      );
      await this.audit.record(
        {
          action: 'workplace_review.windows_proposed',
          actorUserId: actor.userId,
          actorKind: 'USER',
          orgId: engagement.orgId,
          recordType: 'review_engagement',
          recordId: id,
          result: 'ALLOWED',
          details: { windows: body.windows.length, timeZone: body.timeZone },
        },
        { tx },
      );
      return updated;
    });
    const request = await this.repo.findRequest(engagement.requestId);
    if (request) await this.notifier.requestUpdate(engagement.orgId, request.id, request.requesterUserId, 'windows_proposed');
    return this.response(next, now);
  }

  // ── Employer: booking and cancel ────────────────────────────────────────

  /**
   * Books one proposed window (spec REV-06, D-EL-03, D-EL-12). A system
   * transaction: the overlap check must see the reviewer's appointments in
   * every organization, which the tenant scope would hide; the service checks
   * the organization itself.
   */
  async book(orgId: string, id: string, body: ReviewBookRequest, principal: Principal, now = new Date()): Promise<ReviewEngagementResponse> {
    const timeZoneFallback = (await this.organizations.findById(orgId))?.timezone ?? 'Europe/Belgrade';
    const result = await this.dbs.withTransaction(async (tx) => {
      const engagement = await this.repo.lockEngagement(id, tx);
      if (!engagement || engagement.orgId !== orgId) throw notFound();
      if (engagement.status !== 'accepted') throw conflict('invalid_state', 'The engagement is not awaiting a booking');
      if (!engagement.reviewerUserId) throw conflict('no_windows', 'No reviewer is assigned yet');
      const window = (engagement.proposedWindows ?? [])[body.windowIndex];
      if (!window) throw conflict('no_windows', 'No proposed window at that position');
      const startsAt = new Date(window.startsAt);
      const endsAt = new Date(window.endsAt);
      if (startsAt.getTime() <= now.getTime()) throw conflict('slot_unavailable', 'The window has passed');
      await this.repo.lockReviewerCalendar(engagement.reviewerUserId, tx);
      if (await this.repo.reviewerBusy(engagement.reviewerUserId, startsAt, endsAt, tx)) throw conflict('slot_unavailable', 'The reviewer is no longer free in that window');
      const appointment = await this.appointments.create(
        {
          id: randomUUID(),
          orgId,
          expertUserId: engagement.reviewerUserId,
          employeeUserId: principal.userId,
          startsAt,
          endsAt,
          status: 'confirmed',
          serviceCategory: WORKPLACE_REVIEW_SERVICE_CATEGORY,
          timeZone: engagement.proposedTimeZone ?? timeZoneFallback,
        },
        tx,
      );
      await this.appointments.assignExpert(appointment, principal.userId, tx);
      const next = await this.repo.updateEngagement(
        id,
        { appointmentId: appointment.id, participantUserId: principal.userId, status: 'scheduled', proposedWindows: null },
        tx,
      );
      await this.audit.record(
        {
          action: 'workplace_review.appointment_booked',
          actorUserId: principal.userId,
          actorKind: 'USER',
          orgId,
          recordType: 'review_engagement',
          recordId: id,
          result: 'ALLOWED',
          details: { appointmentId: appointment.id, windowIndex: body.windowIndex, startsAt: startsAt.toISOString() },
        },
        { tx },
      );
      return { next, appointment, reviewerUserId: engagement.reviewerUserId };
    });
    try {
      await this.callsJobs.scheduleReminders({ id: result.appointment.id, startsAt: result.appointment.startsAt }, now);
    } catch (error) {
      this.logger.error({ appointmentId: result.appointment.id, error: error instanceof Error ? error.name : 'UnknownError' }, 'Review meeting reminders not scheduled');
    }
    await this.notifier.booked(orgId, id, result.appointment, principal.userId, result.reviewerUserId);
    return this.response(result.next, now);
  }

  /** Cancels an active engagement: the meeting through the appointments spine, the reviewer's assignment, never a score (spec REV-10). */
  async cancel(id: string, body: ReviewCancelRequest, actor: Principal, now = new Date(), orgId?: string): Promise<ReviewEngagementResponse> {
    const engagement = await this.repo.findEngagement(id);
    if (!engagement || (orgId !== undefined && engagement.orgId !== orgId)) throw notFound();
    if (!ACTIVE_REVIEW_ENGAGEMENT_STATUSES.includes(engagement.status)) throw conflict('invalid_state', 'The engagement is already closed');
    const result = await this.dbs.withOrgScope(engagement.orgId, async (tx) => {
      const locked = await this.repo.lockEngagement(id, tx);
      if (!locked || !ACTIVE_REVIEW_ENGAGEMENT_STATUSES.includes(locked.status)) throw conflict('invalid_state', 'The engagement is already closed');
      let appointment: AppointmentRecord | null = null;
      if (locked.appointmentId) {
        const current = await this.appointments.findById(locked.appointmentId, tx);
        if (current && (current.status === 'confirmed' || current.status === 'proposed' || current.status === 'awaiting_approval')) {
          appointment = await this.appointments.transitionStatus(current.id, 'canceled', tx);
        }
      }
      await this.repo.endReviewerAssignments(id, now, tx);
      const next = await this.repo.updateEngagement(id, { status: 'canceled', canceledAt: now, cancelReason: body.reason ?? null }, tx);
      await this.audit.record(
        {
          action: 'workplace_review.canceled',
          actorUserId: actor.userId,
          actorKind: 'USER',
          orgId: engagement.orgId,
          recordType: 'review_engagement',
          recordId: id,
          result: 'ALLOWED',
          details: { fromStatus: locked.status, appointmentCanceled: appointment !== null, hasReason: body.reason !== undefined },
        },
        { tx },
      );
      return { next, appointment };
    });
    if (result.appointment) {
      try {
        await this.callsJobs.cancelAppointmentJobs(result.appointment.id);
      } catch (error) {
        this.logger.warn({ appointmentId: result.appointment.id, error: error instanceof Error ? error.name : 'UnknownError' }, 'Review meeting jobs not removed');
      }
      await this.cancelHooks.run(result.appointment, actor.userId);
    }
    if (engagement.reviewerUserId) await this.principals.invalidateUser(engagement.reviewerUserId);
    return this.response(result.next, now);
  }

  // ── Reviewer: follow-up and completion (REV-09) ─────────────────────────

  async planFollowUp(principal: Principal, id: string, body: ReviewFollowUpRequest, now = new Date()): Promise<ReviewEngagementResponse> {
    const engagement = await this.forReviewer(principal, id, ACTIONS['workplace_reviews.report.write']);
    if (!ACTIVE_REVIEW_ENGAGEMENT_STATUSES.includes(engagement.status)) throw conflict('invalid_state', 'The engagement is closed');
    const next = await this.dbs.withOrgScope(engagement.orgId, async (tx) => {
      if (body.ownerUserId) await this.assertMember(body.ownerUserId, engagement.orgId, tx);
      const updated = await this.repo.updateEngagement(
        id,
        { followUpTargetDate: new Date(body.targetDate), followUpOwnerUserId: body.ownerUserId ?? null, status: engagement.status === 'report_shared' ? 'follow_up' : engagement.status },
        tx,
      );
      await this.audit.record(
        {
          action: 'workplace_review.follow_up_planned',
          actorUserId: principal.userId,
          actorKind: 'USER',
          orgId: engagement.orgId,
          recordType: 'review_engagement',
          recordId: id,
          result: 'ALLOWED',
          details: { targetDate: body.targetDate, hasOwner: body.ownerUserId !== undefined },
        },
        { tx },
      );
      return updated;
    });
    return this.response(next, now);
  }

  /** Completes the engagement; measurement and work have distinct states, so a red area may remain (spec REV-09). */
  async complete(principal: Principal, id: string, now = new Date()): Promise<ReviewEngagementResponse> {
    const engagement = await this.forReviewer(principal, id, ACTIONS['workplace_reviews.report.write']);
    if (!ACTIVE_REVIEW_ENGAGEMENT_STATUSES.includes(engagement.status)) throw conflict('invalid_state', 'The engagement is already closed');
    const next = await this.dbs.withOrgScope(engagement.orgId, async (tx) => {
      const updated = await this.repo.updateEngagement(id, { status: 'completed', completedAt: now }, tx);
      await this.audit.record(
        {
          action: 'workplace_review.completed',
          actorUserId: principal.userId,
          actorKind: 'USER',
          orgId: engagement.orgId,
          recordType: 'review_engagement',
          recordId: id,
          result: 'ALLOWED',
          details: { fromStatus: engagement.status },
        },
        { tx },
      );
      return updated;
    });
    return this.response(next, now);
  }

  /** Marks the engagement in progress once the reviewer starts writing. */
  async markInProgress(engagement: EngagementRow, tx: DbExecutor): Promise<EngagementRow> {
    if (engagement.status !== 'accepted' && engagement.status !== 'scheduled') return engagement;
    return this.repo.updateEngagement(engagement.id, { status: 'in_progress' }, tx);
  }
}
