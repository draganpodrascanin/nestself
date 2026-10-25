/**
 * AppointmentViewerReader: the caller's own state on the appointments that
 * `GET /appointments/:id` and the list return (T-CW-1.5).
 *
 * - `viewer.hasJoined`: the caller has a `call_participants` row on the
 *   appointment's latest call session.
 * - `viewer.pendingSignal`: the expert's running-late signal kept under
 *   `call:{sessionId}:pending_signal` for the latest session (the calls
 *   module writes it while the employee has not joined and deletes it when
 *   the employee joins), for the appointment's participants.
 * - `approvalOutcome` and `declineReason`: for the employee only, how the
 *   latest decided `appointment_approvals` row ended when it was REJECTED or
 *   EXPIRED, and the approver's safe reason when rejected (D-CW-37, T-CW-1.10).
 *   Never for the expert, operations, the approver or the employer.
 *
 * The call reads run in system context over appointments the caller is
 * already authorized for (the list spans organizations); the approval rows
 * are read inside the appointment's organization scope.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AppointmentPendingSignal, AppointmentResponse, ApprovalOutcome, Principal } from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService } from '../db/db.service.js';
import { appointmentApprovals, callParticipants, callSessions } from '../db/schema/index.js';
import { KEY_VALUE_STORE, type KeyValueStore } from '../redis/key-value-store.js';
import { callPendingSignalKey, parsePendingSignal } from '../calls/call-mapper.js';
import type { AppointmentRecord } from './appointments.repository.js';

/** What the reader found for a page of appointments, keyed by appointment id. */
export interface ViewerFacts {
  /** Appointments on whose latest session the caller has a participant row. */
  joinedAppointmentIds: ReadonlySet<string>;
  pendingSignals: ReadonlyMap<string, AppointmentPendingSignal>;
  approvalOutcomes: ReadonlyMap<string, { outcome: ApprovalOutcome; reason: string | null }>;
}

/**
 * Adds the caller's state to each response: the join state for everyone,
 * the pending signal for the participants, the approval outcome and reason
 * for the employee only.
 */
export function withViewerState(
  userId: string,
  responses: readonly AppointmentResponse[],
  facts: ViewerFacts,
): AppointmentResponse[] {
  return responses.map((response) => {
    const isEmployee = response.employeeUserId === userId;
    const isParticipant = isEmployee || response.expertUserId === userId;
    const pendingSignal = isParticipant ? facts.pendingSignals.get(response.id) : undefined;
    const approval = isEmployee ? facts.approvalOutcomes.get(response.id) : undefined;
    return {
      ...response,
      viewer: {
        hasJoined: facts.joinedAppointmentIds.has(response.id),
        ...(pendingSignal ? { pendingSignal } : {}),
      },
      ...(approval ? { approvalOutcome: approval.outcome } : {}),
      ...(approval?.outcome === 'rejected' && approval.reason ? { declineReason: approval.reason } : {}),
    };
  });
}

@Injectable()
export class AppointmentViewerReader {
  constructor(
    private readonly dbs: DbService,
    @Inject(KEY_VALUE_STORE) private readonly kv: KeyValueStore,
  ) {}

  /** The responses with the caller's state added (see the module comment). */
  async decorate(
    principal: Principal,
    records: readonly AppointmentRecord[],
    responses: readonly AppointmentResponse[],
  ): Promise<AppointmentResponse[]> {
    if (records.length === 0) return [...responses];
    const facts = await this.factsFor(principal.userId, records);
    return withViewerState(principal.userId, responses, facts);
  }

  private async factsFor(userId: string, records: readonly AppointmentRecord[]): Promise<ViewerFacts> {
    const latest = await this.latestSessions(records.map((record) => record.id));
    const sessionIds = [...latest.values()];

    const joined =
      sessionIds.length === 0
        ? []
        : await this.dbs.db
            .select({ sessionId: callParticipants.sessionId })
            .from(callParticipants)
            .where(and(inArray(callParticipants.sessionId, sessionIds), eq(callParticipants.userId, userId)));
    const joinedSessions = new Set(joined.map((row) => row.sessionId));
    const joinedAppointmentIds = new Set(
      [...latest.entries()].filter(([, sessionId]) => joinedSessions.has(sessionId)).map(([appointmentId]) => appointmentId),
    );

    const pendingSignals = new Map<string, AppointmentPendingSignal>();
    for (const record of records) {
      const sessionId = latest.get(record.id);
      const isParticipant = record.employeeUserId === userId || record.expertUserId === userId;
      if (!sessionId || !isParticipant || record.status !== 'confirmed') continue;
      const signal = parsePendingSignal(await this.kv.get(callPendingSignalKey(sessionId)).catch(() => null));
      if (signal) pendingSignals.set(record.id, signal);
    }

    const approvalOutcomes = await this.approvalOutcomes(records.filter((record) => record.employeeUserId === userId));
    return { joinedAppointmentIds, pendingSignals, approvalOutcomes };
  }

  /** Appointment id to its newest call session id. */
  private async latestSessions(appointmentIds: readonly string[]): Promise<Map<string, string>> {
    const rows = await this.dbs.db
      .selectDistinctOn([callSessions.appointmentId], { appointmentId: callSessions.appointmentId, id: callSessions.id })
      .from(callSessions)
      .where(inArray(callSessions.appointmentId, [...appointmentIds]))
      .orderBy(callSessions.appointmentId, desc(callSessions.createdAt), desc(callSessions.id));
    return new Map(rows.flatMap((row) => (row.appointmentId ? [[row.appointmentId, row.id] as const] : [])));
  }

  /**
   * The latest decided approval of each of the employee's appointments, when
   * it was rejected or expired, read in each organization's scope.
   */
  private async approvalOutcomes(
    records: readonly AppointmentRecord[],
  ): Promise<Map<string, { outcome: ApprovalOutcome; reason: string | null }>> {
    const outcomes = new Map<string, { outcome: ApprovalOutcome; reason: string | null }>();
    const byOrg = new Map<string, string[]>();
    for (const record of records) byOrg.set(record.orgId, [...(byOrg.get(record.orgId) ?? []), record.id]);

    for (const [orgId, appointmentIds] of byOrg) {
      const rows = await this.dbs.withOrgScope(orgId, (tx) =>
        tx
          .selectDistinctOn([appointmentApprovals.appointmentId], {
            appointmentId: appointmentApprovals.appointmentId,
            status: appointmentApprovals.status,
            reason: appointmentApprovals.reason,
          })
          .from(appointmentApprovals)
          .where(
            and(
              inArray(appointmentApprovals.appointmentId, appointmentIds),
              inArray(appointmentApprovals.status, ['APPROVED', 'REJECTED', 'EXPIRED']),
            ),
          )
          .orderBy(
            appointmentApprovals.appointmentId,
            sql`coalesce(${appointmentApprovals.decidedAt}, ${appointmentApprovals.createdAt}) desc`,
            desc(appointmentApprovals.id),
          ),
      );
      for (const row of rows) {
        if (row.status === 'REJECTED') outcomes.set(row.appointmentId, { outcome: 'rejected', reason: row.reason });
        if (row.status === 'EXPIRED') outcomes.set(row.appointmentId, { outcome: 'expired', reason: null });
      }
    }
    return outcomes;
  }
}
