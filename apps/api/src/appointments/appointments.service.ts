/**
 * AppointmentsService: the appointment spine (T-CW-0.6, D-CW-02).
 *
 * - Create (`POST /orgs/:orgId/appointments`, CALL-26): the employee must be
 *   an active member of the organization and the expert must be able to join
 *   (an expert record and a current `assigned_cases` grant holding
 *   `consultation.join`, the `expert` template). The appointment starts
 *   `confirmed`; the expert gets the CASE assignment that brings it into the
 *   scope of that grant; `appointment.created` is audited.
 * - Read (`GET /appointments/:id`): authorized by the guard through
 *   `appointmentResource`.
 * - List (`GET /appointments`, CALL-18, CALL-28, CALL-42): `@Authenticated()`
 *   on the route, authorized here. Outside the operations context it lists
 *   the rows where the caller is the employee or the expert and keeps those
 *   `authorize()` allows for `consultation.join`; a caller who holds
 *   `consultation.join` in no grant (an employer-scoped principal, CALL-17)
 *   gets 404. In the operations context it lists the organizations the caller
 *   may coordinate bookings for (`bookings.coordinate`: a platform-scoped
 *   grant reaches every organization, `client_operations` its CLIENT
 *   assignments), with `orgId`, `status` and date filters.
 * - Cancel (`POST /appointments/:id/cancel`, CALL-27, CALL-30): only a
 *   `confirmed` appointment; anything else is 409 `appointment_not_joinable`.
 *   `appointment.canceled` is audited.
 *
 * Writes run inside `DbService.withOrgScope` (RLS). Audit details carry
 * identifiers only (CW-R-33a).
 */
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  ACTIONS,
  AppointmentStatusSchema,
  canTransitionAppointment,
  type Action,
  type ApiErrorCode,
  type AppointmentCreateRequest,
  type AppointmentListResponse,
  type AppointmentResponse,
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
import { authorize } from '../authz/authorize.js';
import { assertOperationsSession } from '../authz/resolvers.js';
import { ApiHttpException } from '../common/api-error.js';
import { appointmentResourceOf, toAppointmentResponse } from './appointment-mapper.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import {
  AppointmentsRepository,
  type AppointmentListFilter,
  type AppointmentRecord,
} from './appointments.repository.js';

/** `GET /appointments` query (CALL-28): all filters optional; dates bound `startsAt`. */
export const AppointmentListQuerySchema = z
  .object({
    orgId: z.string().min(1).optional(),
    status: AppointmentStatusSchema.optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .refine((q) => !q.from || !q.to || Date.parse(q.from) < Date.parse(q.to), {
    path: ['to'],
    message: 'to must be after from',
  });
export type AppointmentListQuery = z.infer<typeof AppointmentListQuerySchema>;

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

function byStart(a: AppointmentRecord, b: AppointmentRecord): number {
  return a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id);
}

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly repo: AppointmentsRepository,
    private readonly dbs: DbService,
    private readonly memberships: MembershipsRepository,
    private readonly principals: PrincipalLoader,
    private readonly contextLoader: ContextLoader,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditWriter,
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
    if (!(await this.expertCanJoin(body.expertUserId, orgId))) {
      throw invalidField('expertUserId', 'The expert cannot join consultations');
    }

    const created = await this.dbs.withOrgScope(orgId, async (tx) => {
      const record = await this.repo.create(
        {
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

    const response = toAppointmentResponse(created);
    await this.onAppointmentCreated(response);
    return response;
  }

  /**
   * Post-commit hook for a new appointment. T-CW-1.2 extends it to schedule
   * the `appointment.remind` jobs at `REMINDER_OFFSETS_MINUTES` before
   * `startsAt` (CALL-26 criterion 5). Until then a new appointment has no
   * effect beyond its row, the expert's assignment and the audit event.
   */
  protected onAppointmentCreated(_appointment: AppointmentResponse): Promise<void> {
    return Promise.resolve();
  }

  /**
   * True when the expert's `assigned_cases` grant holding `consultation.join`
   * (the `expert` template) will cover the appointment once the CASE
   * assignment exists. Another scope (an employee's `own` grant) never
   * reaches somebody else's appointment, so it does not count.
   */
  private async expertCanJoin(expertUserId: string, orgId: string): Promise<boolean> {
    const expert = await this.principals.load(expertUserId);
    if (!expert?.expert || expert.isSuspended || expert.isDeactivated) return false;
    const now = new Date();
    const grants = await this.principals.loadGrants(expertUserId, orgId);
    return grants.some(
      (grant) =>
        grant.scopeType === 'assigned_cases' &&
        isCurrentGrantFor(grant, expertUserId, ACTIONS['consultation.join'], now),
    );
  }

  // ── Read ────────────────────────────────────────────────────────────────

  /** The guard has authorized the caller on this appointment. */
  async get(id: string): Promise<AppointmentResponse> {
    const record = await this.repo.findById(id);
    if (!record) throw notFound();
    return toAppointmentResponse(record);
  }

  async list(principal: Principal, query: AppointmentListQuery): Promise<AppointmentListResponse> {
    const filter: AppointmentListFilter = {
      orgId: query.orgId,
      status: query.status,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    };
    const records =
      principal.context.kind === 'operations'
        ? await this.listForOperations(principal, filter)
        : await this.listForParticipant(principal, filter);
    return { items: records.map(toAppointmentResponse) };
  }

  /** CALL-18, CALL-42: the caller's own appointments, as employee or as expert. */
  private async listForParticipant(principal: Principal, filter: AppointmentListFilter): Promise<AppointmentRecord[]> {
    const action = ACTIONS['consultation.join'];
    const candidates = await this.repo.list({ ...filter, participantUserId: principal.userId });
    const visible = await this.authorizedRecords(principal, action, candidates);
    if (visible.length === 0 && !(await this.holdsAction(principal, action))) {
      await this.auditListDenial(principal, action);
      throw notFound();
    }
    return visible;
  }

  /** CALL-28: appointments of the organizations the caller coordinates bookings for. */
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

    const records: AppointmentRecord[] = [];
    for (const orgId of orgIds) {
      records.push(...(await this.dbs.withOrgScope(orgId, (tx) => this.repo.list({ ...filter, orgId }, tx))));
    }
    return records.sort(byStart);
  }

  /**
   * Organizations the caller may coordinate bookings for: null for a
   * platform-scoped grant (every organization), otherwise the targets of
   * their CLIENT assignments that `authorize()` allows. With neither, the
   * platform-level `require()` audits the denial and throws.
   */
  private async coordinatedOrgIds(principal: Principal, action: Action): Promise<string[] | null> {
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
    if (allowed.length === 0) await this.authz.require(principal, action, platform);
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

  /** Whether any current grant of the caller lists `action`, in any organization they belong to. */
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
    return toAppointmentResponse(canceled);
  }
}
