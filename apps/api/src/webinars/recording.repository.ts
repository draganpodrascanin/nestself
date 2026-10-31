/**
 * WebinarRecordingsRepository: the `webinar_recordings` rows of the recording
 * pipeline (T-CW-2.5, D-CW-18, CW-R-24b) and the occurrence's summary column
 * `webinars.recording_status`, which follows the newest row.
 *
 * Every status change is a conditional update (`WHERE status IN (...)`), so
 * the API (stop, end) and the worker (start, finalize) can race without a
 * lock: the loser's update matches no row and it backs off. One row per
 * webinar session (`webinar_recordings_session_id_idx`); `ensure` is
 * idempotent on it. The caller passes the RLS-scoped executor
 * (`WebinarAccess.scoped`), as the other webinar repositories do.
 */
import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { RecordingStatus } from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db/db.service.js';
import { webinarRecordings, webinars } from '../db/schema/index.js';
import { fromDbRecordingStatus, toDbRecordingStatus } from './webinar-mapper.js';

type RecordingRow = typeof webinarRecordings.$inferSelect;

/** A `webinar_recordings` row in contract spelling. */
export interface WebinarRecordingRecord {
  id: string;
  webinarId: string;
  orgId: string | null;
  sessionId: string;
  status: RecordingStatus;
  providerPipelineId: string | null;
  providerPipelineArn: string | null;
  rawSegmentsPrefix: string | null;
  concatenationPipelineId: string | null;
  concatenatedKey: string | null;
  handoffStatus: string;
  handoffLocation: string | null;
  failureReason: string | null;
  startedAt: Date | null;
  stoppedAt: Date | null;
  readyAt: Date | null;
  handedOffAt: Date | null;
  failedAt: Date | null;
}

/** The columns a transition may set alongside the status. */
export type WebinarRecordingFields = Partial<
  Pick<
    WebinarRecordingRecord,
    | 'providerPipelineId'
    | 'providerPipelineArn'
    | 'rawSegmentsPrefix'
    | 'concatenationPipelineId'
    | 'concatenatedKey'
    | 'handoffStatus'
    | 'handoffLocation'
    | 'failureReason'
    | 'startedAt'
    | 'stoppedAt'
    | 'readyAt'
    | 'handedOffAt'
    | 'failedAt'
  >
>;

function toRecord(row: RecordingRow): WebinarRecordingRecord {
  return {
    id: row.id,
    webinarId: row.webinarId,
    orgId: row.orgId,
    sessionId: row.sessionId,
    status: fromDbRecordingStatus(row.status),
    providerPipelineId: row.providerPipelineId,
    providerPipelineArn: row.providerPipelineArn,
    rawSegmentsPrefix: row.rawSegmentsPrefix,
    concatenationPipelineId: row.concatenationPipelineId,
    concatenatedKey: row.concatenatedKey,
    handoffStatus: row.handoffStatus,
    handoffLocation: row.handoffLocation,
    failureReason: row.failureReason,
    startedAt: row.startedAt,
    stoppedAt: row.stoppedAt,
    readyAt: row.readyAt,
    handedOffAt: row.handedOffAt,
    failedAt: row.failedAt,
  };
}

@Injectable()
export class WebinarRecordingsRepository {
  constructor(private readonly dbs: DbService) {}

  private exec(tx?: DbExecutor): DbExecutor {
    return tx ?? this.dbs.db;
  }

  /** The session's row, created SCHEDULED when missing (idempotent on the session). */
  async ensure(input: { webinarId: string; orgId: string | null; sessionId: string }, tx?: DbExecutor): Promise<WebinarRecordingRecord> {
    await this.exec(tx)
      .insert(webinarRecordings)
      .values({ ...input, status: toDbRecordingStatus('scheduled') })
      .onConflictDoNothing({ target: webinarRecordings.sessionId });
    return (await this.findBySession(input.sessionId, tx))!;
  }

  async findBySession(sessionId: string, tx?: DbExecutor): Promise<WebinarRecordingRecord | null> {
    const [row] = await this.exec(tx).select().from(webinarRecordings).where(eq(webinarRecordings.sessionId, sessionId));
    return row ? toRecord(row) : null;
  }

  /** The occurrence's newest recording (its last session's), or null before the first one. */
  async findLatest(webinarId: string, tx?: DbExecutor): Promise<WebinarRecordingRecord | null> {
    const [row] = await this.exec(tx)
      .select()
      .from(webinarRecordings)
      .where(eq(webinarRecordings.webinarId, webinarId))
      .orderBy(desc(webinarRecordings.createdAt), desc(webinarRecordings.id))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  /** `from` to `to` with `fields`; null when the row was not in one of `from` (someone else moved it first). */
  async transition(
    id: string,
    from: readonly RecordingStatus[],
    to: RecordingStatus,
    fields: WebinarRecordingFields = {},
    tx?: DbExecutor,
  ): Promise<WebinarRecordingRecord | null> {
    const [row] = await this.exec(tx)
      .update(webinarRecordings)
      .set({ ...fields, status: toDbRecordingStatus(to) })
      .where(and(eq(webinarRecordings.id, id), inArray(webinarRecordings.status, from.map(toDbRecordingStatus))))
      .returning();
    return row ? toRecord(row) : null;
  }

  /** Fields without a status change, while the row is in one of `whileIn`. */
  async update(
    id: string,
    whileIn: readonly RecordingStatus[],
    fields: WebinarRecordingFields,
    tx?: DbExecutor,
  ): Promise<WebinarRecordingRecord | null> {
    const [row] = await this.exec(tx)
      .update(webinarRecordings)
      .set(fields)
      .where(and(eq(webinarRecordings.id, id), inArray(webinarRecordings.status, whileIn.map(toDbRecordingStatus))))
      .returning();
    return row ? toRecord(row) : null;
  }

  /** `webinars.recording_status`, the occurrence's summary of its newest recording. */
  async setWebinarStatus(webinarId: string, status: RecordingStatus, tx?: DbExecutor): Promise<void> {
    await this.exec(tx)
      .update(webinars)
      .set({ recordingStatus: toDbRecordingStatus(status) })
      .where(eq(webinars.id, webinarId));
  }
}
