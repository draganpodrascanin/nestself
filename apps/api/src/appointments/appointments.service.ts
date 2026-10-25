/**
 * AppointmentsService: the appointment spine (T-CW-0.6, D-CW-02).
 *
 * - Create (`POST /orgs/:orgId/appointments`, CALL-26): NestSelf operations
 *   in the operations context with `bookings.coordinate` on the organization
 *   (`client_operations` through its CLIENT assignment). Service coordinators
 *   (`bookings.coordinate` scoped to queues) and `platform_owner` (no
 *   `bookings.coordinate`) cannot create appointments yet; experts create
 *   follow-ups through the T-CW-1.9 route (`POST /appointments/:id/follow-up`).
 *   The employee must be an active member of the organization. The expert
 *   must be allowed `consultation.join` on the new appointment by the engine:
 *   the expert, in the expert context, with the CASE assignment the
 *   appointment adds, the appointment's service category against the grant's
 *   `categories` condition. The appointment starts `confirmed`, the expert
 *   gets that CASE assignment, and `appointment.created` is audited.
 * - Read (`GET /appointments/:id`): authorized by the guard through
 *   `appointmentResource`. Every response of these routes names the
 *   participants by first name (`AppointmentsRepository.toResponses`).
 * - List (`GET /appointments`, CALL-18, CALL-28, CALL-42): `@Authenticated()`
 *   on the route, authorized here, paged on `(startsAt, id)`. Outside the
 *   operations context it lists the rows where the caller is the employee or
 *   the expert and keeps those `authorize()` allows for `consultation.join`; a
 *   caller who holds `consultation.join` in no grant (an employer-scoped
 *   principal, CALL-17) gets 404. In the operations context it lists the
 *   organizations the caller may coordinate bookings for
 *   (`bookings.coordinate`: a platform-scoped grant reaches every
 *   organization, `client_operations` its CLIENT assignments), with `orgId`,
 *   `status` and date filters.
 * - Cancel (`POST /appointments/:id/cancel`, CALL-27, CALL-30): only a
 *   `confirmed` appointment; anything else is 409 `appointment_not_joinable`.
 *   `appointment.canceled` is audited. Only the employee cancels: the
 *   canonical templates table keeps `appointment.cancel` with the `employee`
 *   template, and the expert gets 404 (guidelines 4.5 and CALL-27, which say
 *   either party, are being amended). The expert's CASE assignment is kept
 *   after a cancellation, so the expert can still read the record; every
 *   join path must therefore check the appointment's status, not only the
 *   authorization decision.
 * - Reminders (D-CW-26, T-CW-1.2): creation schedules the `appointment.remind`
 *   jobs and cancellation removes them, through `CallsJobSchedulerService`.
 *
 * Writes run inside `DbService.withOrgScope` (RLS). Audit details carry
 * identifiers only (CW-R-33a).
 */
import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  ACTIONS,
  canTransitionAppointment,
  type Action,
  type ApiErrorCode,
  type AppointmentCreateRequest,
  type AppointmentExpertCandidatesQuery,
  type AppointmentExpertCandidatesResponse,
  type AppointmentListQuery,
  type AppointmentListResponse,
  type AppointmentResponse,
  type AssignmentInput,
  type AuthorizationContext,
  type GrantInput,
  type Principal,
  type Resource,
} from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService } from '../db/db.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { MembershipsRepository } from '../db/repositories/memberships.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { PrincipalLoader } from '../principal/principal-loader.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ContextLoader } from '../authz/context-loader.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuthorizationService } from '../authz/authorization.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter } from '../audit/audit-writer.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { CallsJobSchedulerService } from '../jobs/calls-job-scheduler.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AppointmentViewerReader } from './appointment-viewer.js';
import { authorize } from '../authz/authorize.js';
import { assertOperationsSession } from '../authz/resolvers.js';
import { assemblePrincipal } from '../principal/assemble-principal.js';
import { ApiHttpException } from '../common/api-error.js';
import { appointmentResourceOf, decodeAppointmentCursor, encodeAppointmentCursor } from './appointment-mapper.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import {
  AppointmentsRepository,
  type AppointmentListFilter,
  type AppointmentRecord,
} from './appointments.repository.js';

/** An appointment between one expert and one employee is a consultation (D-CW-02). */
const APPOINTMENT_FORMAT = 'consultation';

function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ApiHttpException {
  return new ApiHttpException({ status, code, message, details });
}

function notFound(): ApiHttpException {
  return apiError(404, 'not_found', 'Resource not found');
}

function invalidField(field: string, message: string): ApiHttpException {
  return apiError(400, 'validation', message, { field });
}

/** CALL-30: a transition the appointment's status does not allow. */
function notJoinable(): ApiHttpException {
  return apiError(409, 'appointment_not_joinable', 'The appointment does not allow this in its current status');
}

/** A current, unrevoked grant of `userId` that lists `action`. */
function isCurrentGrantFor(grant: GrantInput, userId: string, action: Action, now: Date): boolean {
  return (
    grant.subjectUserId === userId &&
    grant.revokedAt == null &&
    (grant.validFrom == null || grant.validFrom <= now) &&
    (grant.validUntil == null || grant.validUntil > now) &&
    grant.actions.includes(action)
  );
}

function byKey(a: AppointmentRecord, b: AppointmentRecord): number {
  return a.startsAt.getTime() - b.startsAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Most organizations or experts a booking lookup returns. */
const BOOKING_LOOKUP_LIMIT = 50;
/** Experts read per lookup before the engine check keeps those who may take the category. */
const EXPERT_CANDIDATE_SCAN = 200;

/** Split `limit + 1` candidate rows into the page window and the cursor of the next page. */
function paginate(rows: AppointmentRecord[], limit: number): { window: AppointmentRecord[]; nextCursor: string | null } {
  const window = rows.slice(0, limit);
  const last = window[window.length - 1];
  return { window, nextCursor: rows.length > limit && last ? encodeAppointmentCursor(last) : null };
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private readonly repo: AppointmentsRepository,
    private readonly dbs: DbService,
    private readonly memberships: MembershipsRepository,
    private readonly principals: PrincipalLoader,
    private readonly contextLoader: ContextLoader,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditWriter,
    private readonly callsJobs: CallsJobSchedulerService,
    private readonly viewers: AppointmentViewerReader,
  ) {}

  // ── Create ──────────────────────────────────────────────────────────────

  async create(orgId: string, body: AppointmentCreateRequest, actor: Principal): Promise<AppointmentResponse> {
    // The route names the organization; the body is never trusted for scoping (API-R-21).
    if (body.orgId !== orgId) {
      throw invalidField('orgId', 'The organization in the body must match the route');
    }
    if (body.expertUserId === body.employeeUserId) {
      throw invalidField('expertUserId', 'The expert and the employee must be different people');
    }
    if (!(await this.memberships.findActiveByUserAndOrg(body.employeeUserId, orgId))) {
      throw apiError(409, 'subject_not_member', 'The employee is not an active member of the organization', {
        field: 'employeeUserId',
      });
    }
    const id = randomUUID();
    const planned = { id, orgId, employeeUserId: body.employeeUserId, serviceCategory: body.serviceCategory };
    if (!(await this.expertCanJoin(body.expertUserId, planned))) {
      throw invalidField('expertUserId', 'The expert cannot join this consultation');
    }

    const created = await this.dbs.withOrgScope(orgId, async (tx) => {
      const record = await this.repo.create(
        {
          id,
          orgId,
          expertUserId: body.expertUserId,
          employeeUserId: body.employeeUserId,
          startsAt: new Date(body.startsAt),
          endsAt: new Date(body.endsAt),
          status: 'confirmed',
          serviceCategory: body.serviceCategory,
          timeZone: body.timeZone,
          fundingRef: body.fundingRef ?? null,
          followUpOf: null,
        },
        tx,
      );
      await this.repo.assignExpert(record, actor.userId, tx);
      return record;
    });

    await this.audit.record({
      action: 'appointment.created',
      actorUserId: actor.userId,
      actorKind: 'USER',
      orgId,
      recordType: 'appointment',
      recordId: created.id,
      result: 'ALLOWED',
      details: {
        appointmentId: created.id,
        orgId,
        expertUserId: created.expertUserId,
        employeeUserId: created.employeeUserId,
        format: APPOINTMENT_FORMAT,
      },
    });
    // The new CASE assignment must reach the expert's next decision, not after the cache TTL.
    await this.principals.invalidateUser(created.expertUserId);

    const response = await this.repo.toResponse(created);
    await this.onAppointmentCreated(response);
    return response;
  }

  /**
   * Post-commit hook for a new appointment: one `appointment.remind` job per
   * `REMINDER_OFFSETS_MINUTES` offset still in the future (CALL-26 criterion
   * 5, D-CW-26, T-CW-1.2). The appointment is already committed, so a queue
   * failure is logged and the request still succeeds; nothing is scheduled
   * without Redis.
   */
  protected async onAppointmentCreated(appointment: AppointmentResponse): Promise<void> {
    try {
      await this.callsJobs.scheduleReminders({ id: appointment.id, startsAt: new Date(appointment.startsAt) });
    } catch (error) {
      this.logger.error(
        { appointmentId: appointment.id, operation: 'scheduleReminders', error: errorName(error) },
        'Appointment reminders not scheduled',
      );
    }
  }

  /** Post-commit hook for a cancellation: removes the pending reminder and follow-up jobs (CW-R-37a). */
  protected async onAppointmentCanceled(appointment: AppointmentResponse): Promise<void> {
    try {
      await this.callsJobs.cancelAppointmentJobs(appointment.id);
    } catch (error) {
      // A reminder that still fires re-reads the status and skips a canceled appointment (CW-R-37).
      this.logger.warn(
        { appointmentId: appointment.id, operation: 'cancelJobs', error: errorName(error) },
        'Appointment jobs not removed',
      );
    }
  }

  /**
   * Whether `authorize()` allows the expert `consultation.join` on the planned
   * appointment: the expert in the expert context, with the CASE assignment
   * `assignExpert` adds for it. The engine applies user state, context
   * validity (an expert record), grant scope (`assigned_cases`) and the
   * `categories` condition against the service category; an employee's
   * `own` grant never reaches somebody else's appointment.
   */
  private expertCanJoin(
    expertUserId: string,
    planned: Pick<AppointmentRecord, 'id' | 'orgId' | 'employeeUserId' | 'serviceCategory'>,
  ): Promise<boolean> {
    return this.expertMayConsult(expertUserId, planned, appointmentResourceOf(planned));
  }

  /**
   * The engine check behind {@link expertCanJoin}, at any appointment
   * resource: the booking form's candidates use one with only the category
   * (T-CW-1.5).
   */
  private async expertMayConsult(expertUserId: string, planned: { id: string }, resource: Resource): Promise<boolean> {
    const loaded = await this.principals.load(expertUserId);
    if (!loaded) return false;
    const expert = assemblePrincipal(loaded, { kind: 'expert' });
    const action = ACTIONS['consultation.join'];
    const ctx = await this.contextLoader.build(expert, resource, { action, loadedPrincipal: loaded });
    const assignment: AssignmentInput = {
      id: `planned_${planned.id}`,
      userId: expertUserId,
      kind: 'CASE',
      targetId: planned.id,
      startAt: ctx.now,
      endAt: null,
    };
    return authorize(expert, action, resource, { ...ctx, assignments: [...ctx.assignments, assignment] }).allowed;
  }

  // ── Read ────────────────────────────────────────────────────────────────

  /**
   * `GET /appointments/:id`, authorized here like the list and cancel
   * (T-CW-1.5): operations in the operations context through
   * `bookings.coordinate` on the appointment's organization, answered as an
   * operations row (first names and the organization's name, no viewer or
   * approval fields); everyone else through `consultation.join` on the
   * appointment (the participants), answered with the caller's state. A
   * denial is audited and answers 404 through the non-disclosure filter.
   */
  async get(id: string, principal: Principal): Promise<AppointmentResponse> {
    const record = await this.repo.findById(id);
    if (!record) throw notFound();
    if (principal.context.kind === 'operations') {
      assertOperationsSession(principal);
      await this.authz.require(principal, ACTIONS['bookings.coordinate'], { type: 'appointment', orgId: record.orgId });
      const [row] = await this.operationsRows([record]);
      return row!;
    }
    await this.authz.require(principal, ACTIONS['consultation.join'], appointmentResourceOf(record));
    const [response] = await this.viewers.decorate(principal, [record], [await this.repo.toResponse(record)]);
    return response!;
  }

  /** Operations rows: the response with the organization's name; the caller's viewer state does not apply. */
  private async operationsRows(records: AppointmentRecord[]): Promise<AppointmentResponse[]> {
    const [responses, names] = await Promise.all([
      this.repo.toResponses(records),
      this.repo.orgNamesOf(records.map((record) => record.orgId)),
    ]);
    return responses.map((response) => {
      const orgName = names.get(response.orgId);
      return orgName ? { ...response, orgName } : response;
    });
  }

  async list(principal: Principal, query: AppointmentListQuery): Promise<AppointmentListResponse> {
    const after = query.cursor ? decodeAppointmentCursor(query.cursor) : undefined;
    if (after === null) throw invalidField('cursor', 'The cursor is not valid');
    const filter: AppointmentListFilter = {
      orgId: query.orgId,
      status: query.status,
      followUpOf: query.followUpOf,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      after,
      order: query.order,
      // One extra row tells whether there is a next page.
      limit: query.limit + 1,
    };

    if (principal.context.kind === 'operations') {
      const { window, nextCursor } = paginate(await this.listForOperations(principal, filter), query.limit);
      return { items: await this.operationsRows(window), nextCursor };
    }

    // The cursor follows the candidate rows, so a row the engine drops never shifts a page.
    const action = ACTIONS['consultation.join'];
    const candidates = await this.repo.list({ ...filter, participantUserId: principal.userId });
    const { window, nextCursor } = paginate(candidates, query.limit);
    const visible = await this.authorizedRecords(principal, action, window);
    if (visible.length === 0 && !(await this.holdsAction(principal, action))) {
      await this.auditListDenial(principal, action);
      throw notFound();
    }
    return { items: await this.viewers.decorate(principal, visible, await this.repo.toResponses(visible)), nextCursor };
  }

  /** CALL-28: up to `filter.limit` appointments of the organizations the caller coordinates bookings for. */
  private async listForOperations(principal: Principal, filter: AppointmentListFilter): Promise<AppointmentRecord[]> {
    assertOperationsSession(principal);
    const action = ACTIONS['bookings.coordinate'];
    let orgIds: string[] | null;
    if (filter.orgId) {
      await this.authz.require(principal, action, { type: 'appointment', orgId: filter.orgId });
      orgIds = [filter.orgId];
    } else {
      orgIds = await this.coordinatedOrgIds(principal, action);
    }
    if (orgIds === null) return this.repo.list(filter);

    // Each organization's first `limit` rows after the cursor hold the merged first `limit`.
    const records: AppointmentRecord[] = [];
    for (const orgId of orgIds) {
      records.push(...(await this.dbs.withOrgScope(orgId, (tx) => this.repo.list({ ...filter, orgId }, tx))));
    }
    const direction = filter.order === 'desc' ? -1 : 1;
    return records.sort((a, b) => direction * byKey(a, b)).slice(0, filter.limit);
  }

  // ── Booking lookups for operations (T-CW-1.5) ─────────────────────────────

  /**
   * The active organizations the caller may coordinate bookings for, by name
   * (`GET /ops/orgs` for booking coordinators). Null when the caller
   * coordinates bookings nowhere; nothing is audited then, so the event
   * managers' path of the same route can answer.
   */
  async bookableOrganisations(principal: Principal, q: string | undefined): Promise<{ id: string; name: string }[] | null> {
    if (principal.context.kind !== 'operations') return null;
    const orgIds = await this.coordinatedOrgIdsQuietly(principal, ACTIONS['bookings.coordinate']);
    if (orgIds !== null && orgIds.length === 0) return null;
    return this.repo.organisationsNamed(orgIds, q || undefined, BOOKING_LOOKUP_LIMIT);
  }

  /**
   * `GET /ops/appointment-experts`: the experts who may take a consultation
   * of `serviceCategory`, decided by the engine exactly as the creation path
   * checks the chosen expert (the expert template's `categories` condition).
   * The caller must coordinate bookings somewhere; otherwise the denial is
   * audited and answers 404.
   */
  async expertCandidates(principal: Principal, query: AppointmentExpertCandidatesQuery): Promise<AppointmentExpertCandidatesResponse> {
    assertOperationsSession(principal);
    const action = ACTIONS['bookings.coordinate'];
    const orgIds = await this.coordinatedOrgIdsQuietly(principal, action);
    if (orgIds !== null && orgIds.length === 0) await this.authz.require(principal, action, { type: 'appointment' });

    const items: AppointmentExpertCandidatesResponse['items'] = [];
    for (const candidate of await this.repo.expertCandidates(query.q || undefined, EXPERT_CANDIDATE_SCAN)) {
      const planned = { id: `candidate_${candidate.userId}`, serviceCategory: query.serviceCategory };
      if (await this.expertMayConsult(candidate.userId, planned, { type: 'appointment', id: planned.id, category: planned.serviceCategory })) {
        items.push(candidate);
        if (items.length === BOOKING_LOOKUP_LIMIT) break;
      }
    }
    return { items };
  }

  /**
   * Organizations the caller may coordinate bookings for: null for a
   * platform-scoped grant (every organization), otherwise the targets of
   * their CLIENT assignments that `authorize()` allows. With neither, the
   * platform-level `require()` audits the denial and throws.
   */
  private async coordinatedOrgIds(principal: Principal, action: Action): Promise<string[] | null> {
    const allowed = await this.coordinatedOrgIdsQuietly(principal, action);
    if (allowed !== null && allowed.length === 0) await this.authz.require(principal, action, { type: 'appointment' });
    return allowed;
  }

  /** As {@link coordinatedOrgIds}, but an empty list instead of the audited denial. */
  private async coordinatedOrgIdsQuietly(principal: Principal, action: Action): Promise<string[] | null> {
    const platform: Resource = { type: 'appointment' };
    const platformCtx = await this.contextLoader.build(principal, platform, { action });
    if (authorize(principal, action, platform, platformCtx).allowed) return null;

    const candidates = new Set(platformCtx.assignments.filter((a) => a.kind === 'CLIENT').map((a) => a.targetId));
    const allowed: string[] = [];
    for (const orgId of candidates) {
      const resource: Resource = { type: 'appointment', orgId };
      const ctx = await this.contextLoader.build(principal, resource, { action });
      if (authorize(principal, action, resource, ctx).allowed) allowed.push(orgId);
    }
    return allowed;
  }

  /** The records `authorize()` allows for `action`, one context per organization. */
  private async authorizedRecords(
    principal: Principal,
    action: Action,
    records: AppointmentRecord[],
  ): Promise<AppointmentRecord[]> {
    const contexts = new Map<string, AuthorizationContext>();
    const visible: AppointmentRecord[] = [];
    for (const record of records) {
      const resource = appointmentResourceOf(record);
      let ctx = contexts.get(record.orgId);
      if (!ctx) {
        ctx = await this.contextLoader.build(principal, resource, { action });
        contexts.set(record.orgId, ctx);
      }
      if (authorize(principal, action, resource, ctx).allowed) visible.push(record);
    }
    return visible;
  }

  /**
   * Whether any current grant of the caller lists `action`, in any
   * organization they belong to: the line between a participant with no
   * appointments (an empty page) and a caller who may never join one (404).
   */
  private async holdsAction(principal: Principal, action: Action): Promise<boolean> {
    const now = new Date();
    const orgIds = new Set<string>(['platform']);
    if (principal.context.kind === 'organization') orgIds.add(principal.context.orgId);
    for (const membership of principal.memberships) {
      if (membership.status === 'ACTIVE') orgIds.add(membership.orgId);
    }
    for (const orgId of orgIds) {
      const grants = await this.principals.loadGrants(principal.userId, orgId);
      if (grants.some((grant) => isCurrentGrantFor(grant, principal.userId, action, now))) return true;
    }
    return false;
  }

  /** Same record as the guard writes for a denial. */
  private async auditListDenial(principal: Principal, action: Action): Promise<void> {
    await this.audit.record({
      action: 'access.denied',
      actorUserId: principal.userId,
      actorKind: 'USER',
      orgId: principal.context.kind === 'organization' ? principal.context.orgId : null,
      recordType: 'appointment',
      recordId: 'unknown',
      result: 'DENIED',
      details: { actionAttempted: action, resourceType: 'appointment', reason: 'no_matching_grant' },
    });
  }

  // ── Cancel ──────────────────────────────────────────────────────────────

  /** CALL-27, CALL-30: only a `confirmed` appointment can be canceled. */
  /** `POST /appointments/:id/cancel`: the caller's cancel path is checked first (`authorizeCancel`), then the cancel. */
  async cancelAs(id: string, principal: Principal): Promise<AppointmentResponse> {
    const current = await this.repo.findById(id);
    if (!current) throw notFound();
    await this.authorizeCancel(principal, current);
    return this.cancel(id, principal);
  }

  /** The cancel itself, for a caller already authorized (the route through `cancelAs`, or an internal step). */
  async cancel(id: string, actor: Principal): Promise<AppointmentResponse> {
    const current = await this.repo.findById(id);
    if (!current) throw notFound();
    if (!canTransitionAppointment(current.status, 'canceled')) throw notJoinable();

    const canceled = await this.dbs.withOrgScope(current.orgId, (tx) =>
      this.repo.transitionStatus(id, 'canceled', tx),
    );
    // Another request moved it first.
    if (!canceled) throw notJoinable();

    await this.audit.record({
      action: 'appointment.canceled',
      actorUserId: actor.userId,
      actorKind: 'USER',
      orgId: canceled.orgId,
      recordType: 'appointment',
      recordId: canceled.id,
      result: 'ALLOWED',
      details: { appointmentId: canceled.id, canceledByUserId: actor.userId },
    });
    const response = await this.repo.toResponse(canceled);
    await this.onAppointmentCanceled(response);
    return response;
  }

  /**
   * Who may cancel (CALL-27, T-CW-1.5): the employee through
   * `appointment.cancel` on the appointment, and NestSelf operations in the
   * operations context through `bookings.coordinate` on its organization
   * (`client_operations` by its CLIENT assignment). The service coordinator
   * template is queue-scoped and an appointment carries no queue, so it cannot
   * reach one; the coordinator's cancel is the operations path until the
   * booking epic adds queues to appointments. A denial is audited and answers
   * 404 through the controller's non-disclosure filter.
   */
  private async authorizeCancel(principal: Principal, record: AppointmentRecord): Promise<void> {
    if (principal.context.kind === 'operations') {
      assertOperationsSession(principal);
      await this.authz.require(principal, ACTIONS['bookings.coordinate'], { type: 'appointment', orgId: record.orgId });
      return;
    }
    await this.authz.require(principal, ACTIONS['appointment.cancel'], appointmentResourceOf(record));
  }
}
