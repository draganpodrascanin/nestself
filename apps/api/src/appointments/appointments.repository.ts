/**
 * AppointmentsRepository: the `appointments` rows and the CASE assignment that
 * lets the assigned expert reach one (T-CW-0.6).
 *
 * PostgreSQL stores statuses UPPER_CASE; this is the one place that maps them
 * to and from the lower-case contract spellings (CW-R-19a), so every method
 * returns an {@link AppointmentRecord} with a contract status.
 *
 * Reads without a `tx` run in system context: the resolver and the
 * participant list do not know the organization before loading the row, and
 * every row is authorized before it is returned. Writes run inside
 * `DbService.withOrgScope` (RLS).
 *
 * Follow-ups (T-CW-1.9): {@link lockById} serialises proposals on one
 * consultation, {@link findOpenFollowUp} finds the one open follow-up (a
 * `proposed` one only while its start is ahead), and
 * {@link updateFromStatus} changes a follow-up only from the status the
 * caller read, so a concurrent response cannot slip in between.
 */
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, gte, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import {
  APPOINTMENT_STATUSES,
  canTransitionAppointment,
  type AppointmentResponse,
  type AppointmentStatus,
} from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db/db.service.js';
import { appointments, assignments, experts, organizations, users } from '../db/schema/index.js';
import { firstNameOf, toAppointmentResponse, type AppointmentParticipants } from './appointment-mapper.js';

type AppointmentRow = typeof appointments.$inferSelect;
type DbAppointmentStatus = AppointmentRow['status'];

const TO_CONTRACT_STATUS: Readonly<Record<DbAppointmentStatus, AppointmentStatus>> = {
  PROPOSED: 'proposed',
  AWAITING_APPROVAL: 'awaiting_approval',
  CONFIRMED: 'confirmed',
  COMPLETED: 'completed',
  CANCELED: 'canceled',
  DECLINED: 'declined',
  NO_SHOW: 'no_show',
};

const TO_DB_STATUS: Readonly<Record<AppointmentStatus, DbAppointmentStatus>> = {
  proposed: 'PROPOSED',
  awaiting_approval: 'AWAITING_APPROVAL',
  confirmed: 'CONFIRMED',
  completed: 'COMPLETED',
  canceled: 'CANCELED',
  declined: 'DECLINED',
  no_show: 'NO_SHOW',
};

/** The UPPER_CASE database spelling of a contract status (CW-R-19a); the seed uses it too. */
export function toDbAppointmentStatus(status: AppointmentStatus): DbAppointmentStatus {
  return TO_DB_STATUS[status];
}

/** The follow-up columns (T-CW-1.9), which the call layer does not read. */
type FollowUpColumn = 'suggestedWindows' | 'proposedAt' | 'respondedAt';

/**
 * An appointment row with the contract spelling of its status. The repository
 * always fills the follow-up columns; they are optional in the type so a
 * record built elsewhere (the call layer's fixtures) need not name them.
 */
export type AppointmentRecord = Omit<AppointmentRow, 'status' | FollowUpColumn> &
  Partial<Pick<AppointmentRow, FollowUpColumn>> & { status: AppointmentStatus };

/** The service generates `id` up front, so the expert's eligibility can be checked against it. */
export type NewAppointment = Omit<typeof appointments.$inferInsert, 'id' | 'status' | 'createdAt' | 'updatedAt'> & {
  id: string;
  status: AppointmentStatus;
};

/** The columns a follow-up response may change besides the status. */
export type FollowUpChanges = Partial<
  Pick<typeof appointments.$inferInsert, 'startsAt' | 'endsAt' | 'suggestedWindows' | 'respondedAt'>
>;


/** A position in the `(startsAt, id)` order: the last row of the previous page. */
export interface AppointmentKey {
  startsAt: Date;
  id: string;
}

export interface AppointmentListFilter {
  /** Rows where this user is the employee or the expert. */
  participantUserId?: string;
  /** The follow-ups of this consultation. */
  followUpOf?: string;
  orgId?: string;
  status?: AppointmentStatus;
  /** Inclusive lower bound on `startsAt`. */
  from?: Date;
  /** Exclusive upper bound on `startsAt`. */
  to?: Date;
  /** Rows strictly after this key in the list's order. */
  after?: AppointmentKey;
  /** `asc` (default): earliest `startsAt` first; `desc`: latest first (T-CW-1.5). */
  order?: 'asc' | 'desc';
  /** At most this many rows. */
  limit?: number;
}

/** `q` as a literal inside an ILIKE pattern. */
function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function toRecord(row: AppointmentRow): AppointmentRecord {
  return { ...row, status: TO_CONTRACT_STATUS[row.status] };
}

@Injectable()
export class AppointmentsRepository {
  constructor(private readonly dbs: DbService) {}

  private exec(tx?: DbExecutor): DbExecutor {
    return tx ?? this.dbs.db;
  }

  async findById(id: string, tx?: DbExecutor): Promise<AppointmentRecord | null> {
    const [row] = await this.exec(tx).select().from(appointments).where(eq(appointments.id, id));
    return row ? toRecord(row) : null;
  }

  async create(values: NewAppointment, tx?: DbExecutor): Promise<AppointmentRecord> {
    const [row] = await this.exec(tx)
      .insert(appointments)
      .values({ ...values, status: TO_DB_STATUS[values.status] })
      .returning();
    return toRecord(row!);
  }

  /**
   * The CASE assignment through which the expert's `assigned_cases` grant
   * (the `expert` template) reaches this appointment in `authorize()`. It has
   * no end, so the expert keeps the record after the appointment is over.
   */
  async assignExpert(appointment: AppointmentRecord, assignedByUserId: string, tx?: DbExecutor): Promise<void> {
    await this.exec(tx).insert(assignments).values({
      userId: appointment.expertUserId,
      kind: 'CASE',
      targetId: appointment.id,
      assignedByUserId,
      startAt: new Date(),
      reason: 'appointment_expert',
    });
  }

  /**
   * The row, locked `FOR UPDATE` until `tx` ends: concurrent follow-up
   * proposals on one consultation run one after the other.
   */
  async lockById(id: string, tx: DbExecutor): Promise<AppointmentRecord | null> {
    const [row] = await tx.select().from(appointments).where(eq(appointments.id, id)).for('update');
    return row ? toRecord(row) : null;
  }

  /**
   * The open follow-up of `followUpOf`, if any: one is open while it is
   * `awaiting_approval`, or `proposed` with its start, or one of the
   * employee's suggested windows, still ahead (the expert can still schedule
   * a window). A proposal nobody answered in time no longer blocks a new one
   * (D-CW-37); it can no longer be confirmed either.
   */
  async findOpenFollowUp(followUpOf: string, tx?: DbExecutor): Promise<AppointmentRecord | null> {
    const windowAhead = sql`exists (select 1 from jsonb_array_elements(coalesce(${appointments.suggestedWindows}, '[]'::jsonb)) as w where (w->>'startsAt')::timestamptz > now())`;
    const open = or(
      eq(appointments.status, TO_DB_STATUS.awaiting_approval),
      and(eq(appointments.status, TO_DB_STATUS.proposed), or(gt(appointments.startsAt, sql`now()`), windowAhead)),
    )!;
    const [row] = await this.exec(tx)
      .select()
      .from(appointments)
      .where(and(eq(appointments.followUpOf, followUpOf), open))
      .orderBy(desc(appointments.createdAt))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  /**
   * Update the appointment only while its status is still `from`, moving it
   * to `to` when given (`canTransitionAppointment` must allow the move).
   * Null when the row is missing, its status is no longer `from` or the move
   * is not allowed.
   */
  async updateFromStatus(
    id: string,
    from: AppointmentStatus,
    to: AppointmentStatus | null,
    changes: FollowUpChanges,
    tx?: DbExecutor,
  ): Promise<AppointmentRecord | null> {
    if (to !== null && !canTransitionAppointment(from, to)) return null;
    const [row] = await this.exec(tx)
      .update(appointments)
      .set({ ...changes, ...(to === null ? {} : { status: TO_DB_STATUS[to] }) })
      .where(and(eq(appointments.id, id), eq(appointments.status, TO_DB_STATUS[from])))
      .returning();
    return row ? toRecord(row) : null;
  }

  /**
   * The participants' display names, per appointment id: each user's first
   * name (`firstNameOf`), never a surname or an address. The expert record
   * holds no photo or credentials line yet, so those optional fields are
   * left out. An appointment one of whose participants has no usable name
   * gets no entry, and its response names neither participant.
   */
  async participantsOf(records: AppointmentRecord[], tx?: DbExecutor): Promise<Map<string, AppointmentParticipants>> {
    const userIds = [...new Set(records.flatMap((r) => [r.expertUserId, r.employeeUserId]))];
    const names = new Map<string, string>();
    if (userIds.length > 0) {
      const rows = await this.exec(tx)
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, userIds));
      for (const row of rows) {
        const first = firstNameOf(row.displayName);
        if (first) names.set(row.id, first);
      }
    }
    const result = new Map<string, AppointmentParticipants>();
    for (const record of records) {
      const expert = names.get(record.expertUserId);
      const employee = names.get(record.employeeUserId);
      if (expert && employee) result.set(record.id, { expert: { firstName: expert }, employee: { firstName: employee } });
    }
    return result;
  }

  /** The API responses of `records`, with the participants' display names, in the same order. */
  async toResponses(records: AppointmentRecord[], tx?: DbExecutor): Promise<AppointmentResponse[]> {
    const participants = await this.participantsOf(records, tx);
    return records.map((record) => toAppointmentResponse(record, participants.get(record.id)));
  }

  async toResponse(record: AppointmentRecord, tx?: DbExecutor): Promise<AppointmentResponse> {
    const [response] = await this.toResponses([record], tx);
    return response!;
  }

  // ── Operations lookups (T-CW-1.5) ─────────────────────────────────────────

  /** Organization id to name, for the operations rows. */
  async orgNamesOf(orgIds: readonly string[], tx?: DbExecutor): Promise<Map<string, string>> {
    if (orgIds.length === 0) return new Map();
    const rows = await this.exec(tx)
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(inArray(organizations.id, [...new Set(orgIds)]));
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  /** Active organizations by name (`null` ids: every one), optionally filtered by `q`, for the booking form. */
  async organisationsNamed(
    orgIds: readonly string[] | null,
    q: string | undefined,
    limit: number,
    tx?: DbExecutor,
  ): Promise<{ id: string; name: string }[]> {
    const conditions: SQL[] = [eq(organizations.status, 'ACTIVE')];
    if (orgIds !== null) {
      if (orgIds.length === 0) return [];
      conditions.push(inArray(organizations.id, [...orgIds]));
    }
    if (q) conditions.push(sql`${organizations.name} ilike ${`%${escapeLike(q)}%`}`);
    return this.exec(tx)
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(and(...conditions))
      .orderBy(asc(organizations.name), asc(organizations.id))
      .limit(limit);
  }

  /** Experts whose user is neither suspended nor deactivated, by name; the engine decides who may consult. */
  async expertCandidates(q: string | undefined, limit: number, tx?: DbExecutor): Promise<{ userId: string; displayName: string }[]> {
    const conditions: SQL[] = [sql`${users.suspendedAt} is null`, sql`${users.deactivatedAt} is null`];
    if (q) conditions.push(sql`${users.displayName} ilike ${`%${escapeLike(q)}%`}`);
    return this.exec(tx)
      .select({ userId: users.id, displayName: users.displayName })
      .from(experts)
      .innerJoin(users, eq(users.id, experts.userId))
      .where(and(...conditions))
      .orderBy(asc(users.displayName), asc(users.id))
      .limit(limit);
  }

  /** Matching rows in `(startsAt, id)` order, earliest first. */
  async list(filter: AppointmentListFilter, tx?: DbExecutor): Promise<AppointmentRecord[]> {
    const conditions: SQL[] = [];
    if (filter.participantUserId) {
      conditions.push(
        or(
          eq(appointments.employeeUserId, filter.participantUserId),
          eq(appointments.expertUserId, filter.participantUserId),
        )!,
      );
    }
    if (filter.orgId) conditions.push(eq(appointments.orgId, filter.orgId));
    if (filter.followUpOf) conditions.push(eq(appointments.followUpOf, filter.followUpOf));
    if (filter.status) conditions.push(eq(appointments.status, TO_DB_STATUS[filter.status]));
    if (filter.from) conditions.push(gte(appointments.startsAt, filter.from));
    if (filter.to) conditions.push(lt(appointments.startsAt, filter.to));
    const descending = filter.order === 'desc';
    if (filter.after) {
      // Strictly after the key in the list's order: later rows ascending, earlier rows descending.
      const beyond = descending ? lt : gt;
      conditions.push(
        or(
          beyond(appointments.startsAt, filter.after.startsAt),
          and(eq(appointments.startsAt, filter.after.startsAt), beyond(appointments.id, filter.after.id)),
        )!,
      );
    }
    const direction = descending ? desc : asc;
    const query = this.exec(tx)
      .select()
      .from(appointments)
      .where(and(...conditions))
      .orderBy(direction(appointments.startsAt), direction(appointments.id));
    const rows = filter.limit === undefined ? await query : await query.limit(filter.limit);
    return rows.map(toRecord);
  }

  /**
   * Move the appointment to `to` if its current status allows it
   * (`canTransitionAppointment`, CALL-30). The allowed source statuses are
   * part of the UPDATE, so a concurrent transition cannot slip in between a
   * read and the write. Returns null when the row is missing or its status
   * does not allow the move.
   */
  async transitionStatus(id: string, to: AppointmentStatus, tx?: DbExecutor): Promise<AppointmentRecord | null> {
    const from = APPOINTMENT_STATUSES.filter((status) => canTransitionAppointment(status, to)).map(
      (status) => TO_DB_STATUS[status],
    );
    if (from.length === 0) return null;
    const [row] = await this.exec(tx)
      .update(appointments)
      .set({ status: TO_DB_STATUS[to] })
      .where(and(eq(appointments.id, id), inArray(appointments.status, from)))
      .returning();
    return row ? toRecord(row) : null;
  }
}
