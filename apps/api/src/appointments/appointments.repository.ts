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
 */
import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, gte, inArray, lt, or, type SQL } from 'drizzle-orm';
import {
  APPOINTMENT_STATUSES,
  canTransitionAppointment,
  type AppointmentStatus,
} from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db/db.service.js';
import { appointments, assignments } from '../db/schema/index.js';

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

/** An appointment row with the contract spelling of its status. */
export type AppointmentRecord = Omit<AppointmentRow, 'status'> & { status: AppointmentStatus };

/** The service generates `id` up front, so the expert's eligibility can be checked against it. */
export type NewAppointment = Omit<typeof appointments.$inferInsert, 'id' | 'status' | 'createdAt' | 'updatedAt'> & {
  id: string;
  status: AppointmentStatus;
};

/** A position in the `(startsAt, id)` order: the last row of the previous page. */
export interface AppointmentKey {
  startsAt: Date;
  id: string;
}

export interface AppointmentListFilter {
  /** Rows where this user is the employee or the expert. */
  participantUserId?: string;
  orgId?: string;
  status?: AppointmentStatus;
  /** Inclusive lower bound on `startsAt`. */
  from?: Date;
  /** Exclusive upper bound on `startsAt`. */
  to?: Date;
  /** Rows strictly after this key. */
  after?: AppointmentKey;
  /** At most this many rows. */
  limit?: number;
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
    if (filter.status) conditions.push(eq(appointments.status, TO_DB_STATUS[filter.status]));
    if (filter.from) conditions.push(gte(appointments.startsAt, filter.from));
    if (filter.to) conditions.push(lt(appointments.startsAt, filter.to));
    if (filter.after) {
      conditions.push(
        or(
          gt(appointments.startsAt, filter.after.startsAt),
          and(eq(appointments.startsAt, filter.after.startsAt), gt(appointments.id, filter.after.id)),
        )!,
      );
    }
    const query = this.exec(tx)
      .select()
      .from(appointments)
      .where(and(...conditions))
      .orderBy(asc(appointments.startsAt), asc(appointments.id));
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
