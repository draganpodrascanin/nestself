/**
 * WebinarRecordingService: the automatic recording pipeline of a webinar
 * (T-CW-2.5, D-CW-18, D-CW-34, WBN-28, WBN-34, CW-R-79c to CW-R-79e,
 * CW-R-107, CW-R-121). Every webinar is recorded; there is no switch.
 *
 * Lifecycle of a `webinar_recordings` row (one per webinar session), mirrored
 * on `webinars.recording_status`:
 *
 * - `webinar.recording.start` (worker), enqueued by `POST /webinars/:id/start`:
 *   waits for the host's meeting (the session ACTIVE) and at least one
 *   presenter in it, retrying every 15 seconds for up to 5 minutes from the
 *   enqueue without spending an attempt (hosts join lazily), then FAILED
 *   (`no_meeting`, `no_presenter`). Starts the media capture pipeline with
 *   `SelectedVideoStreams` set to the attendee ids of the session's
 *   PRESENTER participants and `CompositedVideo` `PresenterOnly` at HD with
 *   the audio muxed in, into `raw/{webinarId}/` (the bucket's `raw/` rule
 *   expires it after 30 days); SCHEDULED to RECORDING,
 *   `webinar.recording { started }` on `webinar:{id}` for the REC
 *   indicator (UX-45), audit `webinar.recording.started`. Attendees are never
 *   on video: they can never send it (D-CW-35) and are never selected. An
 *   attendee given the floor is on the audio track; the client tells them
 *   before they unmute (`FloorGrantedDialog`, CW-R-79c).
 * - Stop: `POST /webinars/:id/recording/stop` (moderator, early) or the end of
 *   the webinar (`POST /webinars/:id/end`, or the session lifecycle closing
 *   the session). RECORDING to PROCESSING, `webinar.recording { stopped }`,
 *   audit `webinar.recording.stopped`, `webinar.recording.finalize` enqueued.
 *   The API task role carries no media-pipeline permission (CW-R-79a), so the
 *   capture pipeline itself is deleted by the finalize job in the worker (the
 *   end route's `DeleteMeeting` ends it at once anyway). A stop before the
 *   recording started is 409 `recording_not_allowed`; an end before it started
 *   is FAILED (`ended_before_start`).
 * - `webinar.recording.finalize` (worker): `DeleteMediaCapturePipeline`
 *   (idempotent, sent before each new concatenation), then one
 *   `CreateMediaConcatenationPipeline` per attempt
 *   from the capture's ARN into `final/{webinarId}/`, polled every
 *   30 seconds (without spending an attempt) for up to 3 hours; READY with
 *   `concatenated_key` and audit `webinar.recording.ready`, then the CMS
 *   handoff: `handoff_status = 'pending'` with `handoff_location` (the
 *   `s3://` URI) and audit `webinar.recording.handed_off` (D-CW-03, CW-R-79e).
 *   When the CMS media interface lands, {@link handOff} gains its one-line
 *   adapter call and moves the row to HANDED_OFF.
 * - Failures: a provider error or a failed concatenation is retried by the
 *   queue (3 attempts, exponential from 30 seconds); the last attempt records
 *   FAILED with `failure_reason` (an error code or name, never a provider
 *   message) and audit `webinar.recording.failed`. The webinar itself goes on.
 *
 * `webinar.recording` carries `started` and `stopped` only (the contract's
 * REC indicator states); READY and FAILED reach the hosts through
 * `GET /webinars/:id/recording`.
 *
 * Assumptions until the founder runs the spikes (research/07-spikes.md):
 * SPIKE-CW-03, that the pipeline counts as an attendee of the meeting (the
 * webinar meeting should reserve one seat for it); SPIKE-CW-04, that
 * `SelectedVideoStreams` and `PresenterOnly` combine into a presenter-only
 * composite, and the object name Chime gives the concatenated MP4 under
 * `final/{webinarId}/composited-video/` (the key stored is that folder until then).
 *
 * Audit details carry identifiers, a reason or a key only (CW-R-33a).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ACTIONS,
  WebinarRecordingStatusResponseSchema,
  type Principal,
  type RecordingStatus,
  type WebinarRecordingStatusResponse,
} from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter, type AuditEventInput } from '../audit/audit-writer.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { CallsRepository, type CallSessionRecord } from '../calls/calls.repository.js';
import { ApiHttpException } from '../common/api-error.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WebinarJobSchedulerService } from '../jobs/webinar-job-scheduler.service.js';
import { WebinarJobDelay, type WebinarJobContext, type WebinarJobData } from '../jobs/webinar-job-scheduler.service.js';
import {
  VIDEO_PROVIDER,
  recordingFinalPrefix,
  recordingRawPrefix,
  type ProviderRecording,
  type VideoProvider,
} from '../video/video-provider.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WebinarAccess, apiError } from './webinar-access.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WebinarRoomEvents } from './webinar-room-events.js';
import { webinarStaffResourceOf } from './webinar.resolver.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WebinarRecordingsRepository, type WebinarRecordingRecord } from './recording.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WebinarsRepository, type WebinarRecord } from './webinars.repository.js';

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;

/** Who stopped or failed a recording, for the audit row. */
export type RecordingActor = { userId: string; kind: 'USER' } | { userId: null; kind: 'SYSTEM' | 'JOB' };

const JOB_ACTOR: RecordingActor = { userId: null, kind: 'JOB' };

export interface RecordingStartResult {
  webinarId: string;
  started: boolean;
  recordingId?: string;
  skipped?: 'not_found' | 'status' | 'not_ready' | 'failed';
}

export interface RecordingFinalizeResult {
  webinarId: string;
  finalized: boolean;
  recordingId?: string;
  skipped?: 'not_found' | 'status' | 'failed';
}

/** Statuses a recording can still fail from; READY and HANDED_OFF are final. */
const FAILABLE: readonly RecordingStatus[] = ['scheduled', 'recording', 'processing'];

/** A failed concatenation: retried by the queue, recorded as FAILED on the last attempt. */
class ConcatenationFailedError extends Error {
  readonly code = 'concatenation_failed';
  constructor() {
    super('The media concatenation pipeline failed');
    this.name = 'ConcatenationFailedError';
  }
}

/** The error's API code or name, for `failure_reason`; never its message. */
function failureCode(error: unknown): string {
  if (error instanceof ApiHttpException || error instanceof ConcatenationFailedError) return error.code;
  return error instanceof Error ? error.name : 'UnknownError';
}

function immediate(): WebinarJobContext {
  return { attempt: 1, maxAttempts: 1, enqueuedAt: new Date() };
}

export function recordingNotAllowed(): ApiHttpException {
  return apiError(409, 'recording_not_allowed', 'The recording has not started, so it cannot be stopped');
}

@Injectable()
export class WebinarRecordingService {
  private readonly logger = new Logger(WebinarRecordingService.name);

  /** How long the start job waits for the host's meeting and a presenter (from the enqueue). */
  startWaitMs = 5 * MINUTE_MS;
  /** Between two checks of the meeting. */
  startRetryDelayMs = 15 * SECOND_MS;
  /** How long the finalize job polls a running concatenation (from the enqueue). */
  concatenationTimeoutMs = 3 * 60 * MINUTE_MS;
  /** Between two polls of the concatenation. */
  concatenationPollMs = 30 * SECOND_MS;

  constructor(
    private readonly webinars: WebinarsRepository,
    private readonly recordings: WebinarRecordingsRepository,
    private readonly access: WebinarAccess,
    private readonly calls: CallsRepository,
    @Inject(VIDEO_PROVIDER) private readonly video: VideoProvider,
    private readonly events: WebinarRoomEvents,
    private readonly audit: AuditWriter,
    private readonly scheduler: WebinarJobSchedulerService,
  ) {}

  // ── webinar.recording.start (worker) ──────────────────────────────────────

  async start(data: WebinarJobData['webinar.recording.start'], context: WebinarJobContext = immediate()): Promise<RecordingStartResult> {
    const { webinarId } = data;
    const webinar = await this.webinars.findById(webinarId);
    if (!webinar) return { webinarId, started: false, skipped: 'not_found' };
    if (webinar.status !== 'live') return { webinarId, started: false, skipped: 'status' };

    const { session, presenterAttendeeIds } = await this.readiness(webinar);
    if (!session?.providerMeetingId || presenterAttendeeIds.length === 0) {
      if (Date.now() - context.enqueuedAt.getTime() < this.startWaitMs) throw new WebinarJobDelay(this.startRetryDelayMs);
      const row = session ? await this.access.scoped(webinar.orgId, (tx) => this.recordings.ensure(this.rowKey(webinar, session), tx)) : null;
      await this.fail(webinar, row, session ? 'no_presenter' : 'no_meeting', JOB_ACTOR);
      return { webinarId, started: false, skipped: 'not_ready' };
    }

    const row = await this.access.scoped(webinar.orgId, (tx) => this.recordings.ensure(this.rowKey(webinar, session), tx));
    if (row.status !== 'scheduled') {
      return { webinarId, started: row.status === 'recording', recordingId: row.id, skipped: 'status' };
    }

    let recording: ProviderRecording;
    try {
      recording = await this.video.startRecording({
        sessionId: session.id,
        providerMeetingId: session.providerMeetingId,
        presenterAttendeeIds,
        s3Prefix: recordingRawPrefix(webinar.id),
      });
    } catch (error) {
      const current = await this.webinars.findById(webinarId);
      if (current?.status !== 'live') return { webinarId, started: false, skipped: 'status' };
      if (context.attempt < context.maxAttempts) throw error;
      await this.fail(webinar, row, failureCode(error), JOB_ACTOR);
      return { webinarId, started: false, recordingId: row.id, skipped: 'failed' };
    }

    const started = await this.access.transaction(webinar.orgId, async (tx) => {
      const moved = await this.recordings.transition(
        row.id,
        ['scheduled'],
        'recording',
        {
          providerPipelineId: recording.pipelineId,
          providerPipelineArn: recording.pipelineArn,
          rawSegmentsPrefix: recording.rawSegmentsPrefix,
          startedAt: new Date(),
        },
        tx,
      );
      if (moved) await this.recordings.setWebinarStatus(webinar.id, 'recording', tx);
      return moved;
    });
    if (!started) {
      // The webinar ended or the moderator acted while the pipeline started: nothing may keep recording.
      await this.stopPipeline(recording.pipelineId, webinarId);
      return { webinarId, started: false, recordingId: row.id, skipped: 'status' };
    }

    this.events.toAudience(webinarId, 'webinar.recording', { webinarId, status: 'started' });
    await this.record(JOB_ACTOR, webinar, 'webinar.recording.started', {
      webinarId,
      sessionId: session.id,
      recordingId: row.id,
    });
    this.logger.log(
      { webinarId, sessionId: session.id, recordingId: row.id, operation: 'recording.start', presenters: presenterAttendeeIds.length },
      'Webinar recording started',
    );
    return { webinarId, started: true, recordingId: row.id };
  }

  /** The occurrence's open session and the attendee ids of its presenters in the meeting. */
  private async readiness(webinar: WebinarRecord): Promise<{ session: CallSessionRecord | null; presenterAttendeeIds: string[] }> {
    const session = await this.access.scoped(webinar.orgId, (tx) => this.webinars.findOpenSession(webinar.id, tx));
    if (session?.status !== 'active' || !session.providerMeetingId) return { session: null, presenterAttendeeIds: [] };
    const participants = await this.access.scoped(webinar.orgId, (tx) => this.calls.listParticipants(session.id, tx));
    const presenterAttendeeIds = participants
      .filter((participant) => participant.role === 'presenter' && participant.providerAttendeeId)
      .map((participant) => participant.providerAttendeeId!);
    return { session, presenterAttendeeIds };
  }

  private rowKey(webinar: WebinarRecord, session: Pick<CallSessionRecord, 'id'>) {
    return { webinarId: webinar.id, orgId: webinar.orgId, sessionId: session.id };
  }

  // ── Stop (API: moderator, end; worker: session lifecycle) ─────────────────

  /** `POST /webinars/:id/recording/stop` (the guard checked `event.moderate`): an early stop. */
  async stopByModerator(webinarId: string, principal: Principal): Promise<WebinarRecordingStatusResponse> {
    const webinar = await this.access.load(webinarId);
    const row = await this.access.scoped(webinar.orgId, (tx) => this.recordings.findLatest(webinarId, tx));
    if (!row || row.status === 'scheduled') throw recordingNotAllowed();
    if (row.status !== 'recording') return this.toResponse(webinar, row);
    const stopped = await this.stopRow(webinar, row, { userId: principal.userId, kind: 'USER' }, 'moderator');
    if (stopped) return this.toResponse(webinar, stopped);
    const current = await this.access.scoped(webinar.orgId, (tx) => this.recordings.findLatest(webinarId, tx));
    return this.toResponse(webinar, current);
  }

  /**
   * The webinar ended (`POST /webinars/:id/end`, or the session lifecycle):
   * a running recording stops; one that never started is FAILED. Never
   * throws: the end has already happened.
   */
  async stopForEnd(webinar: Pick<WebinarRecord, 'id' | 'orgId'>, actor: RecordingActor): Promise<void> {
    try {
      const row = await this.access.scoped(webinar.orgId, (tx) => this.recordings.findLatest(webinar.id, tx));
      if (row?.status === 'recording') {
        await this.stopRow(webinar, row, actor, 'ended');
        return;
      }
      if (row?.status === 'processing') {
        // A stop whose finalize job was lost (no queue at the time, an enqueue error) gets it now;
        // the deterministic job id makes a second enqueue a no-op.
        await this.enqueueFinalize(webinar, row);
        return;
      }
      if (row && row.status !== 'scheduled') return;
      if (!row) {
        const current = await this.webinars.findById(webinar.id);
        if (current?.recordingStatus !== 'scheduled') return;
      }
      await this.fail(webinar, row, 'ended_before_start', actor);
    } catch (error) {
      this.logger.error(
        { webinarId: webinar.id, operation: 'recording.stopForEnd', error: failureCode(error) },
        'Webinar recording not stopped at the end',
      );
    }
  }

  /** RECORDING to PROCESSING, the REC indicator off, the audit and the finalize job; null when already moved. */
  private async stopRow(
    webinar: Pick<WebinarRecord, 'id' | 'orgId'>,
    row: WebinarRecordingRecord,
    actor: RecordingActor,
    reason: 'moderator' | 'ended',
  ): Promise<WebinarRecordingRecord | null> {
    const stopped = await this.access.transaction(webinar.orgId, async (tx) => {
      const moved = await this.recordings.transition(row.id, ['recording'], 'processing', { stoppedAt: new Date() }, tx);
      if (moved) await this.recordings.setWebinarStatus(webinar.id, 'processing', tx);
      return moved;
    });
    if (!stopped) return null;

    this.events.toAudience(webinar.id, 'webinar.recording', { webinarId: webinar.id, status: 'stopped' });
    await this.record(actor, webinar, 'webinar.recording.stopped', {
      webinarId: webinar.id,
      sessionId: row.sessionId,
      recordingId: row.id,
      reason,
    });
    await this.enqueueFinalize(webinar, row);
    this.logger.log({ webinarId: webinar.id, recordingId: row.id, operation: 'recording.stop', reason }, 'Webinar recording stopped');
    return stopped;
  }

  /** `webinar.recording.finalize`, once per session by job id: the worker deletes the capture and concatenates (CW-R-79a). */
  private async enqueueFinalize(webinar: Pick<WebinarRecord, 'id'>, row: WebinarRecordingRecord): Promise<void> {
    try {
      if (!(await this.scheduler.enqueueRecordingFinalize(webinar.id, row.sessionId))) {
        this.logger.warn({ webinarId: webinar.id, recordingId: row.id, operation: 'enqueueFinalize' }, 'No queue; the recording is not finalized');
      }
    } catch (error) {
      this.logger.error(
        { webinarId: webinar.id, recordingId: row.id, operation: 'enqueueFinalize', error: failureCode(error) },
        'Recording finalize not enqueued',
      );
    }
  }

  // ── webinar.recording.finalize (worker) ───────────────────────────────────

  async finalize(
    data: WebinarJobData['webinar.recording.finalize'],
    context: WebinarJobContext = immediate(),
  ): Promise<RecordingFinalizeResult> {
    const { webinarId, sessionId } = data;
    const webinar = await this.webinars.findById(webinarId);
    if (!webinar) return { webinarId, finalized: false, skipped: 'not_found' };
    const row = await this.access.scoped(webinar.orgId, (tx) => this.recordings.findBySession(sessionId, tx));
    if (!row) return { webinarId, finalized: false, skipped: 'not_found' };
    if (row.status !== 'processing') {
      const finalized = row.status === 'ready' || row.status === 'handed_off';
      return { webinarId, finalized, recordingId: row.id, skipped: 'status' };
    }

    const finalPrefix = recordingFinalPrefix(webinarId);
    try {
      if (!row.providerPipelineArn) {
        await this.fail(webinar, row, 'no_capture', JOB_ACTOR);
        return { webinarId, finalized: false, recordingId: row.id, skipped: 'failed' };
      }

      let concatenationPipelineId = row.concatenationPipelineId;
      if (!concatenationPipelineId) {
        // Once per concatenation, not on every poll: Chime concatenates a capture only after it finished.
        if (row.providerPipelineId) await this.video.stopRecording({ pipelineId: row.providerPipelineId });
        ({ pipelineId: concatenationPipelineId } = await this.video.startConcatenation({
          sessionId,
          capturePipelineArn: row.providerPipelineArn,
          s3Prefix: finalPrefix,
          attempt: context.attempt,
        }));
        const pipelineId = concatenationPipelineId;
        await this.access.scoped(webinar.orgId, (tx) =>
          this.recordings.update(row.id, ['processing'], { concatenationPipelineId: pipelineId }, tx),
        );
      }

      const state = await this.video.describeConcatenation({ pipelineId: concatenationPipelineId, s3Prefix: finalPrefix });
      if (state.status === 'in_progress') {
        if (Date.now() - context.enqueuedAt.getTime() < this.concatenationTimeoutMs) {
          throw new WebinarJobDelay(this.concatenationPollMs);
        }
        await this.fail(webinar, row, 'concatenation_timeout', JOB_ACTOR);
        return { webinarId, finalized: false, recordingId: row.id, skipped: 'failed' };
      }
      if (state.status === 'failed' || !state.concatenatedKey || !state.location) {
        // The next attempt starts a new concatenation pipeline.
        await this.access.scoped(webinar.orgId, (tx) =>
          this.recordings.update(row.id, ['processing'], { concatenationPipelineId: null, failureReason: 'concatenation_failed' }, tx),
        );
        throw new ConcatenationFailedError();
      }

      const ready = await this.access.transaction(webinar.orgId, async (tx) => {
        const moved = await this.recordings.transition(
          row.id,
          ['processing'],
          'ready',
          { concatenatedKey: state.concatenatedKey, readyAt: new Date(), failureReason: null },
          tx,
        );
        if (moved) await this.recordings.setWebinarStatus(webinarId, 'ready', tx);
        return moved;
      });
      if (!ready) return { webinarId, finalized: false, recordingId: row.id, skipped: 'status' };
      await this.record(JOB_ACTOR, webinar, 'webinar.recording.ready', {
        webinarId,
        sessionId,
        recordingId: row.id,
        concatenatedKey: ready.concatenatedKey,
      });
      await this.handOff(webinar, ready, state.location);
      this.logger.log({ webinarId, sessionId, recordingId: row.id, operation: 'recording.finalize' }, 'Webinar recording ready');
      return { webinarId, finalized: true, recordingId: row.id };
    } catch (error) {
      if (error instanceof WebinarJobDelay) throw error;
      if (context.attempt < context.maxAttempts) {
        this.logger.warn(
          { webinarId, sessionId, recordingId: row.id, operation: 'recording.finalize', attempt: context.attempt, error: failureCode(error) },
          'Webinar recording finalize failed; retrying',
        );
        throw error;
      }
      await this.fail(webinar, row, failureCode(error), JOB_ACTOR);
      return { webinarId, finalized: false, recordingId: row.id, skipped: 'failed' };
    }
  }

  /**
   * The CMS handoff (D-CW-03, CW-R-79e, WBN-34): until the CMS media
   * interface exists, the MP4's location is written with `handoff_status =
   * 'pending'` and the row stays READY. When it lands, the one-line adapter
   * call (create a draft content item from `location`) goes here, followed by
   * READY to HANDED_OFF with `handed_off_at`.
   */
  private async handOff(webinar: WebinarRecord, row: WebinarRecordingRecord, location: string): Promise<void> {
    const handed = await this.access.scoped(webinar.orgId, (tx) =>
      this.recordings.update(row.id, ['ready'], { handoffStatus: 'pending', handoffLocation: location }, tx),
    );
    if (!handed) return;
    await this.record(JOB_ACTOR, webinar, 'webinar.recording.handed_off', {
      webinarId: webinar.id,
      sessionId: row.sessionId,
      recordingId: row.id,
      handoffStatus: handed.handoffStatus,
    });
  }

  // ── GET /webinars/:id/recording ───────────────────────────────────────────

  /** The recording state for a host of the occurrence, moderating staff or operations (`event.manage`); 404 otherwise. */
  async status(webinarId: string, principal: Principal): Promise<WebinarRecordingStatusResponse> {
    const webinar = await this.access.load(webinarId);
    const allowed =
      (await this.access.host(webinar, principal)) !== null ||
      (await this.access.canModerate(webinar, principal)) ||
      (await this.access.allows(principal, ACTIONS['event.manage'], webinarStaffResourceOf(webinar)));
    if (!allowed) return this.access.deny(principal, ACTIONS['event.moderate'], webinar);
    const row = await this.access.scoped(webinar.orgId, (tx) => this.recordings.findLatest(webinarId, tx));
    return this.toResponse(webinar, row);
  }

  // ── Shared ────────────────────────────────────────────────────────────────

  /**
   * FAILED with the reason (the row, when there is one, and the occurrence's
   * summary), the REC indicator off if it was on, and the audit note. A row
   * already READY, HANDED_OFF or FAILED is left alone.
   */
  private async fail(
    webinar: Pick<WebinarRecord, 'id' | 'orgId'>,
    row: WebinarRecordingRecord | null,
    reason: string,
    actor: RecordingActor,
  ): Promise<void> {
    const failed = await this.access.transaction(webinar.orgId, async (tx) => {
      if (row) {
        const moved = await this.recordings.transition(row.id, FAILABLE, 'failed', { failureReason: reason, failedAt: new Date() }, tx);
        if (!moved) return null;
        await this.recordings.setWebinarStatus(webinar.id, 'failed', tx);
        return moved;
      }
      await this.recordings.setWebinarStatus(webinar.id, 'failed', tx);
      return true;
    });
    if (!failed) return;
    if (row?.status === 'recording') {
      this.events.toAudience(webinar.id, 'webinar.recording', { webinarId: webinar.id, status: 'stopped' });
    }
    await this.record(actor, webinar, 'webinar.recording.failed', {
      webinarId: webinar.id,
      sessionId: row?.sessionId ?? null,
      recordingId: row?.id ?? null,
      reason,
    });
    this.logger.error({ webinarId: webinar.id, recordingId: row?.id ?? null, operation: 'recording.fail', reason }, 'Webinar recording failed');
  }

  /** Best effort: the pipeline also ends with the meeting. */
  private async stopPipeline(pipelineId: string, webinarId: string): Promise<void> {
    try {
      await this.video.stopRecording({ pipelineId });
    } catch (error) {
      this.logger.error({ webinarId, operation: 'recording.stopPipeline', error: failureCode(error) }, 'Capture pipeline not stopped');
    }
  }

  private toResponse(
    webinar: Pick<WebinarRecord, 'id' | 'recordingStatus'>,
    row: WebinarRecordingRecord | null,
  ): WebinarRecordingStatusResponse {
    return WebinarRecordingStatusResponseSchema.parse({
      webinarId: webinar.id,
      status: row?.status ?? webinar.recordingStatus,
      startedAt: row?.startedAt?.toISOString() ?? null,
      stoppedAt: row?.stoppedAt?.toISOString() ?? null,
    });
  }

  private async record(
    actor: RecordingActor,
    webinar: Pick<WebinarRecord, 'id' | 'orgId'>,
    action: AuditEventInput['action'],
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.audit.record({
        action,
        actorUserId: actor.userId,
        actorKind: actor.kind,
        orgId: webinar.orgId,
        recordType: 'webinar',
        recordId: webinar.id,
        result: 'ALLOWED',
        details,
      });
    } catch (error) {
      // The state change is committed; a job retry would repeat it, so the audit failure is logged instead.
      this.logger.error({ webinarId: webinar.id, action, operation: 'audit', error: failureCode(error) }, 'Recording audit not written');
    }
  }
}
