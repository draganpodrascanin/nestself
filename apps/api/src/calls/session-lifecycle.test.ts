/**
 * CallSessionLifecycle unit tests (T-CW-1.2): who audits `call.ended` and as
 * what actor, and that nothing after the commit can throw (a redelivered
 * event is a duplicate, so whatever failed would never be retried).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type { AuditEventInput, AuditWriter } from '../audit/audit-writer.js';
import type { DbService } from '../db/db.service.js';
import { MemoryKeyValueStore } from '../redis/memory-key-value-store.js';
import { callParticipantCredentialsKey } from '../redis/redis-keys.js';
import type { RoomEmitter } from '../ws/room-emitter.js';
import type { CallParticipantRecord, CallSessionEndReason, CallSessionRecord, CallsRepository } from './calls.repository.js';
import type { ModuleRef } from '@nestjs/core';
import { CallSessionLifecycle, WEBINAR_SESSION_CLOSED_HANDLER, type WebinarSessionClosedHandler } from './session-lifecycle.js';

const ENDED_AT = new Date('2026-11-10T16:00:00.000Z');

function endedSession(endReason: CallSessionEndReason): CallSessionRecord {
  return {
    id: 'session_1',
    appointmentId: 'appt_1',
    webinarId: null,
    orgId: 'org_sample',
    format: 'consultation',
    providerMeetingId: 'meeting_1',
    status: 'ended',
    startsAt: new Date('2026-11-10T15:00:00.000Z'),
    endsAt: new Date('2026-11-10T15:50:00.000Z'),
    startedAt: new Date('2026-11-10T15:00:00.000Z'),
    endedAt: ENDED_AT,
    endReason,
    locationText: null,
    createdAt: ENDED_AT,
    updatedAt: ENDED_AT,
  };
}

describe('CallSessionLifecycle.announceClosed', () => {
  let kv: MemoryKeyValueStore;
  let emit: ReturnType<typeof vi.fn>;
  let record: ReturnType<typeof vi.fn>;
  let error: ReturnType<typeof vi.spyOn>;
  let lifecycle: CallSessionLifecycle;

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    kv = new MemoryKeyValueStore();
    await kv.set(callParticipantCredentialsKey('session_1', 'participant_1'), '{}');
    emit = vi.fn(() => true);
    record = vi.fn(async (_input: AuditEventInput) => undefined);
    const repo = {
      listParticipants: async () => [{ id: 'participant_1' } as CallParticipantRecord],
    } as unknown as CallsRepository;
    const dbs = {
      withOrgScope: <T>(_org: string, fn: (tx: undefined) => Promise<T>) => fn(undefined),
      withTransaction: <T>(fn: (tx: undefined) => Promise<T>) => fn(undefined),
    } as unknown as DbService;
    lifecycle = new CallSessionLifecycle(repo, dbs, kv, { emit } as unknown as RoomEmitter, { record } as unknown as AuditWriter);
  });

  it.each([
    ['provider', 'SYSTEM'],
    ['cleanup', 'JOB'],
    ['reconcile', 'JOB'],
  ] as const)('audits a %s end as %s', async (reason, actorKind) => {
    await lifecycle.announceClosed(endedSession(reason));
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'call.ended',
        actorUserId: null,
        actorKind,
        recordId: 'session_1',
        details: { sessionId: 'session_1', endReason: reason },
      }),
    );
  });

  it('leaves the call.ended audit of an expert end to CallsService.end()', async () => {
    await lifecycle.announceClosed(endedSession('expert'));
    expect(record).not.toHaveBeenCalled();
    // The rest of the close still happens.
    expect(await kv.get(callParticipantCredentialsKey('session_1', 'participant_1'))).toBeNull();
    expect(emit).toHaveBeenCalledWith('call:session_1', 'call.session.ended', {
      sessionId: 'session_1',
      endedAt: ENDED_AT.toISOString(),
    });
  });

  it('never throws after the commit: a failed audit is logged, the credentials and the room are still handled', async () => {
    record.mockRejectedValueOnce(new Error('audit db down'));
    await expect(lifecycle.announceClosed(endedSession('provider'))).resolves.toBeUndefined();
    expect(await kv.get(callParticipantCredentialsKey('session_1', 'participant_1'))).toBeNull();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session_1', operation: 'audit', error: 'Error' }),
      expect.any(String),
    );
  });

  it('never throws when the room emit fails', async () => {
    emit.mockImplementationOnce(() => {
      throw new Error('relay down');
    });
    await expect(lifecycle.announceClosed(endedSession('cleanup'))).resolves.toBeUndefined();
    expect(record).toHaveBeenCalledTimes(1);
  });
});

describe('CallSessionLifecycle: a closed webinar session ends a live webinar (T-CW-2.5)', () => {
  function setup(handler: WebinarSessionClosedHandler | null) {
    vi.restoreAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const repo = { listParticipants: async () => [] } as unknown as CallsRepository;
    const dbs = {
      withOrgScope: <T>(_org: string, fn: (tx: undefined) => Promise<T>) => fn(undefined),
      withTransaction: <T>(fn: (tx: undefined) => Promise<T>) => fn(undefined),
    } as unknown as DbService;
    const moduleRef = {
      get: vi.fn((token: unknown) => {
        if (token !== WEBINAR_SESSION_CLOSED_HANDLER || !handler) throw new Error('not found');
        return handler;
      }),
    } as unknown as ModuleRef;
    const lifecycle = new CallSessionLifecycle(
      repo,
      dbs,
      new MemoryKeyValueStore(),
      { emit: vi.fn(() => true) } as unknown as RoomEmitter,
      { record: vi.fn(async () => undefined) } as unknown as AuditWriter,
      moduleRef,
    );
    return { lifecycle, moduleRef, warn, error };
  }

  const webinarSession = (endReason: CallSessionEndReason): CallSessionRecord => ({
    ...endedSession(endReason),
    appointmentId: null,
    webinarId: 'w1',
    format: 'webinar',
  });

  it('hands a closed webinar session to the webinars module with its end reason', async () => {
    const markEndedFromLifecycle = vi.fn(async () => true);
    const { lifecycle } = setup({ markEndedFromLifecycle });
    const session = webinarSession('provider');
    await lifecycle.announceClosed(session);
    expect(markEndedFromLifecycle).toHaveBeenCalledWith(session);
  });

  it('leaves consultation sessions alone', async () => {
    const markEndedFromLifecycle = vi.fn(async () => true);
    const { lifecycle, moduleRef } = setup({ markEndedFromLifecycle });
    await lifecycle.announceClosed(endedSession('provider'));
    expect(markEndedFromLifecycle).not.toHaveBeenCalled();
    expect(moduleRef.get).not.toHaveBeenCalled();
  });

  it('never throws: a failing handler is logged, a missing webinars module is a warning', async () => {
    const failing = setup({ markEndedFromLifecycle: vi.fn(async () => Promise.reject(new Error('db down'))) });
    await expect(failing.lifecycle.announceClosed(webinarSession('reconcile'))).resolves.toBeUndefined();
    expect(failing.error).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session_1', operation: 'webinarEnded' }), expect.any(String));

    const missing = setup(null);
    await expect(missing.lifecycle.announceClosed(webinarSession('provider'))).resolves.toBeUndefined();
    expect(missing.warn).toHaveBeenCalled();
  });
});
