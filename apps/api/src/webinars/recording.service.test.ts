/**
 * WebinarRecordingService (T-CW-2.5, D-CW-18, D-CW-34, WBN-28, WBN-34):
 * the automatic start once the host's meeting has a presenter, the stop by
 * the moderator or at the end, the finalize job's concatenation, retries and
 * failure, and the CMS handoff.
 *
 * The service runs against `FakeVideoProvider` with in-memory repositories;
 * the last block runs it against `ChimeVideoProvider` with the SDK clients
 * mocked (`aws-sdk-client-mock`), to pin the requests the pipeline sends.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { mockClient } from 'aws-sdk-client-mock';
import { ChimeSDKMeetingsClient, GetMeetingCommand } from '@aws-sdk/client-chime-sdk-meetings';
import {
  ChimeSDKMediaPipelinesClient,
  CreateMediaCapturePipelineCommand,
  CreateMediaConcatenationPipelineCommand,
  DeleteMediaCapturePipelineCommand,
  GetMediaPipelineCommand,
} from '@aws-sdk/client-chime-sdk-media-pipelines';
import type { Principal, RecordingStatus } from '@nestself/contracts';
import type { AuditEventInput, AuditWriter } from '../audit/audit-writer.js';
import type { CallParticipantRecord, CallSessionRecord, CallsRepository } from '../calls/calls.repository.js';
import { WebinarJobDelay, type WebinarJobContext, type WebinarJobSchedulerService } from '../jobs/webinar-job-scheduler.service.js';
import { ChimeVideoProvider } from '../video/chime-video-provider.js';
import { FakeVideoProvider } from '../video/fake-video-provider.js';
import { videoProviderUnavailable, type VideoProvider } from '../video/video-provider.js';
import type { WebinarAccess } from './webinar-access.js';
import type { WebinarRoomEvents } from './webinar-room-events.js';
import type { WebinarRecordingFields, WebinarRecordingRecord, WebinarRecordingsRepository } from './recording.repository.js';
import { WebinarRecordingService, type RecordingActor } from './recording.service.js';
import type { WebinarRecord, WebinarsRepository } from './webinars.repository.js';

const WEBINAR_ID = 'w1';
const SESSION_ID = 'session_1';
const MINUTE = 60_000;
const moderator = { userId: 'user_nikola' } as Principal;
const asModerator: RecordingActor = { userId: 'user_nikola', kind: 'USER' };

function context(overrides: Partial<WebinarJobContext> = {}): WebinarJobContext {
  return { attempt: 1, maxAttempts: 3, enqueuedAt: new Date(), ...overrides };
}

/** The in-memory `webinar_recordings` table and `webinars.recording_status`. */
class MemoryRecordings {
  readonly rows = new Map<string, WebinarRecordingRecord>();
  webinarStatus: RecordingStatus = 'scheduled';
  private next = 1;

  async ensure(input: { webinarId: string; orgId: string | null; sessionId: string }): Promise<WebinarRecordingRecord> {
    const found = await this.findBySession(input.sessionId);
    if (found) return found;
    const row: WebinarRecordingRecord = {
      id: `rec_${this.next++}`,
      ...input,
      status: 'scheduled',
      providerPipelineId: null,
      providerPipelineArn: null,
      rawSegmentsPrefix: null,
      concatenationPipelineId: null,
      concatenatedKey: null,
      handoffStatus: 'pending',
      handoffLocation: null,
      failureReason: null,
      startedAt: null,
      stoppedAt: null,
      readyAt: null,
      handedOffAt: null,
      failedAt: null,
    };
    this.rows.set(row.id, row);
    return { ...row };
  }

  async findBySession(sessionId: string): Promise<WebinarRecordingRecord | null> {
    const row = [...this.rows.values()].find((r) => r.sessionId === sessionId);
    return row ? { ...row } : null;
  }

  async findLatest(webinarId: string): Promise<WebinarRecordingRecord | null> {
    const row = [...this.rows.values()].filter((r) => r.webinarId === webinarId).at(-1);
    return row ? { ...row } : null;
  }

  async transition(id: string, from: readonly RecordingStatus[], to: RecordingStatus, fields: WebinarRecordingFields = {}) {
    const row = this.rows.get(id);
    if (!row || !from.includes(row.status)) return null;
    Object.assign(row, fields, { status: to });
    return { ...row };
  }

  async update(id: string, whileIn: readonly RecordingStatus[], fields: WebinarRecordingFields) {
    const row = this.rows.get(id);
    if (!row || !whileIn.includes(row.status)) return null;
    Object.assign(row, fields);
    return { ...row };
  }

  async setWebinarStatus(_webinarId: string, status: RecordingStatus): Promise<void> {
    this.webinarStatus = status;
  }

  only(): WebinarRecordingRecord {
    expect(this.rows.size).toBe(1);
    return [...this.rows.values()][0]!;
  }
}

interface SetupOptions {
  video?: VideoProvider;
  webinar?: Partial<WebinarRecord>;
  /** Who is in the meeting; the presenter by default. */
  roles?: CallParticipantRecord['role'][];
  session?: 'none' | 'pending' | 'active';
  allowed?: { host?: boolean; moderate?: boolean; manage?: boolean };
}

async function setup(options: SetupOptions = {}) {
  const video = options.video ?? new FakeVideoProvider();
  const webinar = {
    id: WEBINAR_ID,
    orgId: 'org_sample',
    status: 'live',
    recordingStatus: 'scheduled',
    ...options.webinar,
  } as WebinarRecord;

  const participants: CallParticipantRecord[] = [];
  let providerMeetingId: string | null = null;
  const sessionKind = options.session ?? 'active';
  if (sessionKind === 'active' && video instanceof FakeVideoProvider) {
    const created = await video.createSession({
      sessionId: SESSION_ID,
      format: 'webinar',
      capacity: 250,
      orgId: 'org_sample',
      webinarId: WEBINAR_ID,
      participant: { participantId: 'part_moderator', role: 'moderator' },
    });
    providerMeetingId = created.providerMeetingId;
    participants.push({ id: 'part_moderator', role: 'moderator', providerAttendeeId: created.participant.providerAttendeeId } as CallParticipantRecord);
    for (const [i, role] of (options.roles ?? ['presenter']).entries()) {
      const id = `part_${role}_${i}`;
      const added = await video.createParticipant({ providerMeetingId, participantId: id, role });
      participants.push({ id, role, providerAttendeeId: added.providerAttendeeId } as CallParticipantRecord);
    }
  } else if (sessionKind === 'active') {
    providerMeetingId = 'meeting-1';
    participants.push(
      { id: 'part_moderator', role: 'moderator', providerAttendeeId: 'attendee-moderator' } as CallParticipantRecord,
      { id: 'part_presenter', role: 'presenter', providerAttendeeId: 'attendee-presenter' } as CallParticipantRecord,
      { id: 'part_attendee', role: 'attendee', providerAttendeeId: 'attendee-attendee' } as CallParticipantRecord,
    );
  }
  const session =
    sessionKind === 'none'
      ? null
      : ({
          id: SESSION_ID,
          webinarId: WEBINAR_ID,
          orgId: 'org_sample',
          format: 'webinar',
          status: sessionKind,
          providerMeetingId,
        } as CallSessionRecord);

  const webinars = {
    findById: vi.fn(async () => webinar),
    findOpenSession: vi.fn(async () => session),
  };
  const recordings = new MemoryRecordings();
  const allowed = { host: false, moderate: true, manage: false, ...options.allowed };
  const access = {
    load: vi.fn(async () => webinar),
    scoped: async (_orgId: string | null, fn: (tx: undefined) => Promise<unknown>) => fn(undefined),
    // A transaction even without an organisation (system context): the status pairs commit together.
    transaction: vi.fn(async (_orgId: string | null, fn: (tx: undefined) => Promise<unknown>) => fn(undefined)),
    host: vi.fn(async () => (allowed.host ? { role: 'presenter' } : null)),
    canModerate: vi.fn(async () => allowed.moderate),
    allows: vi.fn(async () => allowed.manage),
    deny: vi.fn(async () => {
      throw Object.assign(new Error('Resource not found'), { status: 404 });
    }),
  };
  const calls = { listParticipants: vi.fn(async () => participants) };
  const toAudience = vi.fn((_webinarId: string, _event: string, _payload: unknown) => true);
  const toModerationAdded = vi.fn((_webinarId: string, _event: string, _payload: unknown) => true);
  const audits: AuditEventInput[] = [];
  const audit = { record: vi.fn(async (input: AuditEventInput) => void audits.push(input)) };
  const scheduler = { enqueueRecordingFinalize: vi.fn(async () => true) };

  const service = new WebinarRecordingService(
    webinars as unknown as WebinarsRepository,
    recordings as unknown as WebinarRecordingsRepository,
    access as unknown as WebinarAccess,
    calls as unknown as CallsRepository,
    video,
    { toAudience, toModerationAdded } as unknown as WebinarRoomEvents,
    audit as unknown as AuditWriter,
    scheduler as unknown as WebinarJobSchedulerService,
  );
  return { service, video, webinar, recordings, participants, toAudience, toModerationAdded, audits, scheduler, access };
}

const startJob = { webinarId: WEBINAR_ID, sessionId: null };
const finalizeJob = { webinarId: WEBINAR_ID, sessionId: SESSION_ID };

beforeEach(() => {
  for (const level of ['log', 'warn', 'error', 'debug'] as const) vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('webinar.recording.start (WBN-28, CW-R-121)', () => {
  it('captures the presenters only, under raw/{webinarId}/, and announces the REC indicator', async () => {
    const { service, video, recordings, participants, toAudience, audits } = await setup({ roles: ['presenter', 'attendee'] });
    const start = vi.spyOn(video, 'startRecording');

    const result = await service.start(startJob, context());

    expect(result).toMatchObject({ webinarId: WEBINAR_ID, started: true });
    const presenter = participants.find((p) => p.role === 'presenter')!;
    expect(start).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      providerMeetingId: `fake-meeting-${SESSION_ID}`,
      presenterAttendeeIds: [presenter.providerAttendeeId],
      s3Prefix: `raw/${WEBINAR_ID}/`,
    });
    expect(recordings.only()).toMatchObject({
      status: 'recording',
      providerPipelineId: `fake-pipeline-${SESSION_ID}`,
      providerPipelineArn: expect.stringContaining(':media-pipeline/'),
      rawSegmentsPrefix: `raw/${WEBINAR_ID}/`,
      startedAt: expect.any(Date),
    });
    expect(recordings.webinarStatus).toBe('recording');
    expect(toAudience).toHaveBeenCalledWith(WEBINAR_ID, 'webinar.recording', { webinarId: WEBINAR_ID, status: 'started' });
    expect(audits).toEqual([
      expect.objectContaining({
        action: 'webinar.recording.started',
        actorUserId: null,
        actorKind: 'JOB',
        recordType: 'webinar',
        recordId: WEBINAR_ID,
        details: { webinarId: WEBINAR_ID, sessionId: SESSION_ID, recordingId: recordings.only().id },
      }),
    ]);
  });

  it('waits for the host meeting and for a presenter, then gives up after 5 minutes with FAILED', async () => {
    const noSession = await setup({ session: 'none' });
    await expect(noSession.service.start(startJob, context())).rejects.toBeInstanceOf(WebinarJobDelay);
    const pending = await setup({ session: 'pending' });
    await expect(pending.service.start(startJob, context())).rejects.toBeInstanceOf(WebinarJobDelay);
    // The moderator opened the meeting; no presenter yet.
    const moderatorOnly = await setup({ roles: [] });
    await expect(moderatorOnly.service.start(startJob, context())).rejects.toBeInstanceOf(WebinarJobDelay);
    expect(moderatorOnly.recordings.rows.size).toBe(0);

    const late = context({ enqueuedAt: new Date(Date.now() - 5 * MINUTE - 1_000) });
    expect(await moderatorOnly.service.start(startJob, late)).toMatchObject({ started: false, skipped: 'not_ready' });
    expect(moderatorOnly.recordings.only()).toMatchObject({ status: 'failed', failureReason: 'no_presenter', failedAt: expect.any(Date) });
    expect(moderatorOnly.recordings.webinarStatus).toBe('failed');
    expect(moderatorOnly.audits).toEqual([
      expect.objectContaining({ action: 'webinar.recording.failed', details: expect.objectContaining({ reason: 'no_presenter' }) }),
    ]);

    expect(await noSession.service.start(startJob, late)).toMatchObject({ started: false, skipped: 'not_ready' });
    expect(noSession.recordings.webinarStatus).toBe('failed');
    expect(noSession.audits[0]).toMatchObject({ action: 'webinar.recording.failed', details: { reason: 'no_meeting', sessionId: null } });
  });

  it('is idempotent: a second run does not start a second pipeline', async () => {
    const { service, video, audits } = await setup();
    const start = vi.spyOn(video, 'startRecording');
    await service.start(startJob, context());
    expect(await service.start(startJob, context())).toMatchObject({ started: true, skipped: 'status' });
    expect(start).toHaveBeenCalledTimes(1);
    expect(audits.filter((a) => a.action === 'webinar.recording.started')).toHaveLength(1);
  });

  it('exits without action once the webinar is no longer live (CW-R-37)', async () => {
    const { service, video, recordings } = await setup({ webinar: { status: 'ended' } });
    const start = vi.spyOn(video, 'startRecording');
    expect(await service.start(startJob, context())).toEqual({ webinarId: WEBINAR_ID, started: false, skipped: 'status' });
    expect(start).not.toHaveBeenCalled();
    expect(recordings.rows.size).toBe(0);
  });

  it('retries a provider failure and records FAILED on the last attempt; the webinar goes on', async () => {
    const { service, video, recordings, audits, toAudience, toModerationAdded } = await setup();
    vi.spyOn(video, 'startRecording').mockRejectedValue(videoProviderUnavailable(429));

    await expect(service.start(startJob, context({ attempt: 1 }))).rejects.toMatchObject({ code: 'video_provider_unavailable' });
    expect(recordings.only().status).toBe('scheduled');

    expect(await service.start(startJob, context({ attempt: 3 }))).toMatchObject({ started: false, skipped: 'failed' });
    expect(recordings.only()).toMatchObject({ status: 'failed', failureReason: 'video_provider_unavailable' });
    expect(audits.map((a) => a.action)).toEqual(['webinar.recording.failed']);
    // The audience's REC state and the moderators' notice with the reason (CW-R-121).
    expect(toAudience.mock.calls).toEqual([[WEBINAR_ID, 'webinar.recording', { webinarId: WEBINAR_ID, status: 'failed' }]]);
    expect(toModerationAdded.mock.calls).toEqual([
      [WEBINAR_ID, 'webinar.recording.failed', { webinarId: WEBINAR_ID, reason: 'video_provider_unavailable' }],
    ]);
  });

  it('stops the pipeline it just started when the webinar ended meanwhile', async () => {
    const { service, video, recordings } = await setup();
    const real = video.startRecording.bind(video);
    vi.spyOn(video, 'startRecording').mockImplementation(async (input) => {
      const started = await real(input);
      await service.stopForEnd({ id: WEBINAR_ID, orgId: 'org_sample' } as WebinarRecord, asModerator);
      return started;
    });
    expect(await service.start(startJob, context())).toMatchObject({ started: false, skipped: 'status' });
    expect((video as FakeVideoProvider).isRecording(`fake-pipeline-${SESSION_ID}`)).toBe(false);
    expect(recordings.only()).toMatchObject({ status: 'failed', failureReason: 'ended_before_start' });
  });
});

describe('stop: POST /webinars/:id/recording/stop and the end (WBN-28 criteria 3 and 4)', () => {
  it('moves RECORDING to PROCESSING, turns the REC indicator off and schedules the finalize job', async () => {
    const { service, video, recordings, toAudience, audits, scheduler } = await setup();
    await service.start(startJob, context());
    toAudience.mockClear();
    audits.length = 0;

    expect(await service.stopByModerator(WEBINAR_ID, moderator)).toEqual({
      webinarId: WEBINAR_ID,
      status: 'processing',
      startedAt: recordings.only().startedAt!.toISOString(),
      stoppedAt: recordings.only().stoppedAt!.toISOString(),
    });
    expect(recordings.webinarStatus).toBe('processing');
    expect(toAudience).toHaveBeenCalledWith(WEBINAR_ID, 'webinar.recording', { webinarId: WEBINAR_ID, status: 'stopped' });
    expect(audits).toEqual([
      expect.objectContaining({
        action: 'webinar.recording.stopped',
        actorUserId: 'user_nikola',
        actorKind: 'USER',
        details: { webinarId: WEBINAR_ID, sessionId: SESSION_ID, recordingId: recordings.only().id, reason: 'moderator' },
      }),
    ]);
    expect(scheduler.enqueueRecordingFinalize).toHaveBeenCalledWith(WEBINAR_ID, SESSION_ID);
    // The API holds no media-pipeline permission (CW-R-79a): the worker's finalize job stops the capture.
    expect((video as FakeVideoProvider).isRecording(`fake-pipeline-${SESSION_ID}`)).toBe(true);

    // A second stop is a no-op that reports the state.
    expect(await service.stopByModerator(WEBINAR_ID, moderator)).toMatchObject({ status: 'processing' });
    expect(audits).toHaveLength(1);
    expect(scheduler.enqueueRecordingFinalize).toHaveBeenCalledTimes(1);
  });

  it('answers 409 recording_not_allowed before the recording has started', async () => {
    const { service } = await setup({ roles: [] });
    await expect(service.stopByModerator(WEBINAR_ID, moderator)).rejects.toMatchObject({ code: 'recording_not_allowed', status: 409 });
  });

  it('at the end, stops a running recording and fails one that never started; it never throws', async () => {
    const running = await setup();
    await running.service.start(startJob, context());
    await running.service.stopForEnd(running.webinar, asModerator);
    expect(running.recordings.only()).toMatchObject({ status: 'processing' });
    expect(running.audits.at(-1)).toMatchObject({ action: 'webinar.recording.stopped', details: expect.objectContaining({ reason: 'ended' }) });

    const never = await setup({ session: 'none' });
    await never.service.stopForEnd(never.webinar, { userId: null, kind: 'SYSTEM' });
    expect(never.recordings.webinarStatus).toBe('failed');
    expect(never.audits).toEqual([
      expect.objectContaining({
        action: 'webinar.recording.failed',
        actorKind: 'SYSTEM',
        details: { webinarId: WEBINAR_ID, sessionId: null, recordingId: null, reason: 'ended_before_start' },
      }),
    ]);

    const broken = await setup();
    vi.spyOn(broken.recordings, 'findLatest').mockRejectedValue(new Error('db down'));
    await expect(broken.service.stopForEnd(broken.webinar, asModerator)).resolves.toBeUndefined();
  });

  it('at the end, enqueues the finalize job again for a recording already PROCESSING (a lost enqueue; idempotent by job id)', async () => {
    const { service, webinar, recordings, scheduler, audits } = await setup();
    await service.start(startJob, context());
    scheduler.enqueueRecordingFinalize.mockRejectedValueOnce(new Error('redis down'));
    await service.stopByModerator(WEBINAR_ID, moderator);
    expect(recordings.only().status).toBe('processing');
    audits.length = 0;

    await service.stopForEnd(webinar, asModerator);
    expect(scheduler.enqueueRecordingFinalize).toHaveBeenCalledTimes(2);
    expect(scheduler.enqueueRecordingFinalize).toHaveBeenLastCalledWith(WEBINAR_ID, SESSION_ID);
    // No second stop: the state, the audit and the room stay as they were.
    expect(recordings.only().status).toBe('processing');
    expect(audits).toEqual([]);
  });

  it('writes each status change and the occurrence summary in one transaction, organisation or not', async () => {
    const { service, access } = await setup({ webinar: { orgId: null } });
    await service.start(startJob, context());
    await service.stopByModerator(WEBINAR_ID, moderator);
    expect(access.transaction).toHaveBeenCalledTimes(2);
    expect(access.transaction.mock.calls.map((call) => call[0])).toEqual([null, null]);
  });
});

describe('webinar.recording.finalize (WBN-34, CW-R-79d, CW-R-79e)', () => {
  async function stopped(options: SetupOptions = {}) {
    const env = await setup(options);
    await env.service.start(startJob, context());
    await env.service.stopByModerator(WEBINAR_ID, moderator);
    env.audits.length = 0;
    env.toAudience.mockClear();
    return env;
  }

  it('stops the capture, concatenates into final/{webinarId}/, sets READY and hands off as pending', async () => {
    const { service, video, recordings, audits, toAudience } = await stopped();
    const concatenate = vi.spyOn(video, 'startConcatenation');

    expect(await service.finalize(finalizeJob, context())).toMatchObject({ webinarId: WEBINAR_ID, finalized: true });

    expect((video as FakeVideoProvider).isRecording(`fake-pipeline-${SESSION_ID}`)).toBe(false);
    expect(concatenate).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      capturePipelineArn: expect.stringContaining(`fake-pipeline-${SESSION_ID}`),
      s3Prefix: `final/${WEBINAR_ID}/`,
      attempt: 1,
    });
    const row = recordings.only();
    expect(row).toMatchObject({
      status: 'ready',
      concatenatedKey: `final/${WEBINAR_ID}/composited-video/`,
      handoffStatus: 'pending',
      handoffLocation: `s3://fake-recordings/final/${WEBINAR_ID}/composited-video/`,
      readyAt: expect.any(Date),
      failureReason: null,
    });
    expect(recordings.webinarStatus).toBe('ready');
    expect(toAudience.mock.calls).toEqual([[WEBINAR_ID, 'webinar.recording', { webinarId: WEBINAR_ID, status: 'ready' }]]);
    expect(audits.map((a) => [a.action, a.actorKind, a.details])).toEqual([
      [
        'webinar.recording.ready',
        'JOB',
        { webinarId: WEBINAR_ID, sessionId: SESSION_ID, recordingId: row.id, concatenatedKey: row.concatenatedKey },
      ],
      ['webinar.recording.handed_off', 'JOB', { webinarId: WEBINAR_ID, sessionId: SESSION_ID, recordingId: row.id, handoffStatus: 'pending' }],
    ]);

    // Idempotent: a duplicate run changes nothing.
    expect(await service.finalize(finalizeJob, context())).toMatchObject({ finalized: true, skipped: 'status' });
    expect(audits).toHaveLength(2);
  });

  it('polls a running concatenation without spending an attempt, and fails it after the deadline', async () => {
    const { service, video, recordings, audits } = await stopped();
    vi.spyOn(video, 'describeConcatenation').mockResolvedValue({ status: 'in_progress', concatenatedKey: null, location: null });
    const concatenate = vi.spyOn(video, 'startConcatenation');

    const stopCapture = vi.spyOn(video, 'stopRecording');

    await expect(service.finalize(finalizeJob, context())).rejects.toBeInstanceOf(WebinarJobDelay);
    await expect(service.finalize(finalizeJob, context())).rejects.toBeInstanceOf(WebinarJobDelay);
    // The concatenation started once and the capture was deleted once; the next run only polls.
    expect(concatenate).toHaveBeenCalledTimes(1);
    expect(stopCapture).toHaveBeenCalledTimes(1);
    expect(recordings.only().concatenationPipelineId).toBe(`fake-concat-${SESSION_ID}-1`);

    const late = context({ enqueuedAt: new Date(Date.now() - 4 * 60 * MINUTE) });
    expect(await service.finalize(finalizeJob, late)).toMatchObject({ finalized: false, skipped: 'failed' });
    expect(recordings.only()).toMatchObject({ status: 'failed', failureReason: 'concatenation_timeout' });
    expect(audits.map((a) => a.action)).toEqual(['webinar.recording.failed']);
  });

  it('retries a failed concatenation with a new pipeline, and records FAILED after the third attempt', async () => {
    const { service, video, recordings, audits, toModerationAdded } = await stopped();
    const fake = video as FakeVideoProvider;

    fake.failNextConcatenation();
    await expect(service.finalize(finalizeJob, context({ attempt: 1 }))).rejects.toThrow(/concatenation/i);
    expect(recordings.only()).toMatchObject({ status: 'processing', concatenationPipelineId: null });

    fake.failNextConcatenation();
    await expect(service.finalize(finalizeJob, context({ attempt: 2 }))).rejects.toThrow(/concatenation/i);

    fake.failNextConcatenation();
    toModerationAdded.mockClear();
    expect(await service.finalize(finalizeJob, context({ attempt: 3 }))).toMatchObject({ finalized: false, skipped: 'failed' });
    expect(toModerationAdded).toHaveBeenCalledWith(WEBINAR_ID, 'webinar.recording.failed', {
      webinarId: WEBINAR_ID,
      reason: 'concatenation_failed',
    });
    expect(recordings.only()).toMatchObject({ status: 'failed', failureReason: 'concatenation_failed' });
    expect(recordings.webinarStatus).toBe('failed');
    expect(audits).toEqual([
      expect.objectContaining({
        action: 'webinar.recording.failed',
        actorKind: 'JOB',
        details: { webinarId: WEBINAR_ID, sessionId: SESSION_ID, recordingId: recordings.only().id, reason: 'concatenation_failed' },
      }),
    ]);
  });

  it('a retry after a failed concatenation succeeds with the next attempt’s pipeline', async () => {
    const { service, video, recordings } = await stopped();
    (video as FakeVideoProvider).failNextConcatenation();
    await expect(service.finalize(finalizeJob, context({ attempt: 1 }))).rejects.toThrow();
    expect(await service.finalize(finalizeJob, context({ attempt: 2 }))).toMatchObject({ finalized: true });
    expect(recordings.only()).toMatchObject({ status: 'ready', concatenationPipelineId: `fake-concat-${SESSION_ID}-2` });
  });

  it('skips a session without a recording, and one that is not PROCESSING', async () => {
    const { service } = await setup();
    expect(await service.finalize(finalizeJob, context())).toMatchObject({ finalized: false, skipped: 'not_found' });
    await service.start(startJob, context());
    expect(await service.finalize(finalizeJob, context())).toMatchObject({ finalized: false, skipped: 'status' });
  });
});

describe('GET /webinars/:id/recording (hosts and operations)', () => {
  it('reports the newest recording, or the occurrence summary before the first one', async () => {
    const { service } = await setup();
    expect(await service.status(WEBINAR_ID, moderator)).toEqual({ webinarId: WEBINAR_ID, status: 'scheduled', startedAt: null, stoppedAt: null });
    await service.start(startJob, context());
    expect(await service.status(WEBINAR_ID, moderator)).toMatchObject({ status: 'recording', startedAt: expect.any(String), stoppedAt: null });
  });

  it('serves a host, moderating staff and event.manage; anyone else gets 404', async () => {
    for (const allowed of [{ host: true, moderate: false }, { moderate: true }, { moderate: false, manage: true }]) {
      const { service } = await setup({ allowed });
      await expect(service.status(WEBINAR_ID, moderator)).resolves.toMatchObject({ webinarId: WEBINAR_ID });
    }
    const { service, access } = await setup({ allowed: { moderate: false } });
    await expect(service.status(WEBINAR_ID, moderator)).rejects.toMatchObject({ status: 404 });
    expect(access.deny).toHaveBeenCalled();
  });
});

describe('against the Chime adapter (aws-sdk-client-mock)', () => {
  const meetings = mockClient(ChimeSDKMeetingsClient);
  const pipelines = mockClient(ChimeSDKMediaPipelinesClient);
  const BUCKET = 'nestself-dev-recordings-111122223333';
  const CAPTURE_ARN = 'arn:aws:chime:eu-central-1:111122223333:media-pipeline/capture-1';

  beforeEach(() => {
    meetings.reset();
    pipelines.reset();
    meetings.on(GetMeetingCommand).resolves({
      Meeting: {
        MeetingId: 'meeting-1',
        MeetingArn: 'arn:aws:chime:eu-central-1:111122223333:meeting/meeting-1',
        MediaRegion: 'eu-central-1',
        MediaPlacement: { AudioHostUrl: 'a', AudioFallbackUrl: 'b', SignalingUrl: 'c' },
      },
    });
    pipelines.on(CreateMediaCapturePipelineCommand).resolves({
      MediaCapturePipeline: { MediaPipelineId: 'capture-1', MediaPipelineArn: CAPTURE_ARN },
    });
    pipelines.on(DeleteMediaCapturePipelineCommand).resolves({});
    pipelines.on(CreateMediaConcatenationPipelineCommand).resolves({ MediaConcatenationPipeline: { MediaPipelineId: 'concat-1' } });
    pipelines.on(GetMediaPipelineCommand).resolves({ MediaPipeline: { MediaConcatenationPipeline: { Status: 'Stopped' } } });
  });

  it('sends a presenter-only capture to raw/{webinarId} and concatenates to final/{webinarId}', async () => {
    const video = new ChimeVideoProvider({ eventsQueueArn: 'arn:aws:sqs:eu-central-1:111122223333:q', recordingsBucket: BUCKET, stage: 'dev' });
    const { service, recordings } = await setup({ video });

    await service.start(startJob, context());
    const capture = pipelines.commandCalls(CreateMediaCapturePipelineCommand)[0]!.args[0].input;
    expect(capture.SinkArn).toBe(`arn:aws:s3:::${BUCKET}/raw/${WEBINAR_ID}`);
    // Only the presenter's video; the moderator and the attendee are never selected (D-CW-18, D-CW-35).
    expect(capture.ChimeSdkMeetingConfiguration?.SourceConfiguration).toEqual({
      SelectedVideoStreams: { AttendeeIds: ['attendee-presenter'] },
    });
    expect(capture.ChimeSdkMeetingConfiguration?.ArtifactsConfiguration?.CompositedVideo).toMatchObject({
      Resolution: 'HD',
      GridViewConfiguration: { ContentShareLayout: 'PresenterOnly' },
    });

    await service.stopByModerator(WEBINAR_ID, moderator);
    // The API never calls the media-pipeline API (CW-R-79a); the worker's finalize does.
    expect(pipelines.commandCalls(DeleteMediaCapturePipelineCommand)).toHaveLength(0);

    await service.finalize(finalizeJob, context());
    expect(pipelines.commandCalls(DeleteMediaCapturePipelineCommand)[0]!.args[0].input).toEqual({ MediaPipelineId: 'capture-1' });
    const concatenation = pipelines.commandCalls(CreateMediaConcatenationPipelineCommand)[0]!.args[0].input;
    expect(concatenation.Sources?.[0]?.MediaCapturePipelineSourceConfiguration?.MediaPipelineArn).toBe(CAPTURE_ARN);
    expect(concatenation.Sinks?.[0]?.S3BucketSinkConfiguration?.Destination).toBe(`arn:aws:s3:::${BUCKET}/final/${WEBINAR_ID}`);
    expect(recordings.only()).toMatchObject({
      status: 'ready',
      handoffLocation: `s3://${BUCKET}/final/${WEBINAR_ID}/composited-video/`,
    });
  });
});
