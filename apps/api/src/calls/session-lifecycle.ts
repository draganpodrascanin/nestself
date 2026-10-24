/**
 * CallSessionLifecycle: closing a call session from outside the HTTP path
 * (T-CW-1.2, D-CW-09, D-CW-12). The event applier closes a session on the
 * provider's `MeetingEnded`; `calls.cleanup` and `calls.reconcile` close it
 * after deleting a meeting the room should no longer have.
 *
 * A close happens exactly once (CW-R-39): ACTIVE to ENDED with `ended_at`,
 * the CALL-34 location text cleared (CW-R-80a) and the end reason kept if
 * someone stamped it before calling the provider. Only the caller whose
 * update moved the row then announces it: every
 * `call:{sessionId}:participant:*` credential key is deleted (D-CW-08),
 * `call.session.ended` goes to `call:{sessionId}` with `{ sessionId,
 * endedAt }`, and `call.ended` is audited with the reason and no user: as
 * `SYSTEM` for a provider end, as `JOB` for `cleanup` and `reconcile`. An
 * expert end is audited by `CallsService.end()`, which owns it.
 *
 * The announcement runs after the commit and never throws: the row is the
 * truth, the join path refuses an ENDED session before it reads any cached
 * credential, the keys expire when the room closes anyway, and a failed
 * audit is logged (a redelivered event would be a duplicate, so throwing
 * would not bring it back).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter } from '../audit/audit-writer.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db/db.service.js';
import { KEY_VALUE_STORE, type KeyValueStore } from '../redis/key-value-store.js';
import { callParticipantCredentialsKey } from '../redis/redis-keys.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { RoomEmitter } from '../ws/room-emitter.js';
import { callRoom } from './call-mapper.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { CallsRepository, type CallSessionEndReason, type CallSessionRecord } from './calls.repository.js';

export interface SessionClose {
  endedAt: Date;
  reason: CallSessionEndReason;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

@Injectable()
export class CallSessionLifecycle {
  private readonly logger = new Logger(CallSessionLifecycle.name);

  constructor(
    private readonly repo: CallsRepository,
    private readonly dbs: DbService,
    @Inject(KEY_VALUE_STORE) private readonly kv: KeyValueStore,
    private readonly rooms: RoomEmitter,
    private readonly audit: AuditWriter,
  ) {}

  /**
   * The database half, in the caller's transaction: the closed session, or
   * null when it was not ACTIVE (someone else closed it first).
   */
  closeInTransaction(sessionId: string, close: SessionClose, tx: DbExecutor | undefined): Promise<CallSessionRecord | null> {
    return this.repo.closeSession(sessionId, close, tx);
  }

  /**
   * After the commit: credentials, room event and audit, for the caller that
   * closed it. Never throws: the row is already ENDED, and a redelivered event
   * is a duplicate, so anything that failed here would never be retried; a
   * failure is logged instead. An `expert` end is audited by
   * `CallsService.end()`, even when the provider event or a job closed the
   * row first, so it is not audited here.
   */
  async announceClosed(session: CallSessionRecord): Promise<void> {
    const endedAt = session.endedAt ?? new Date();
    const reason = session.endReason ?? 'provider';
    try {
      const participants = await this.scoped(session.orgId, (tx) => this.repo.listParticipants(session.id, tx));
      if (participants.length > 0) {
        await this.kv.del(...participants.map((p) => callParticipantCredentialsKey(session.id, p.id)));
      }
    } catch (error) {
      // The ENDED row already refuses every join; the keys expire when the room closes.
      this.logger.warn({ sessionId: session.id, operation: 'dropCredentials', error: errorName(error) }, 'Credential keys not deleted');
    }
    try {
      this.rooms.emit(callRoom(session.id), 'call.session.ended', {
        sessionId: session.id,
        endedAt: endedAt.toISOString(),
      });
    } catch (error) {
      this.logger.warn({ sessionId: session.id, operation: 'emit', error: errorName(error) }, 'Session end not announced');
    }
    if (reason !== 'expert') {
      try {
        await this.audit.record({
          action: 'call.ended',
          actorUserId: null,
          actorKind: reason === 'cleanup' || reason === 'reconcile' ? 'JOB' : 'SYSTEM',
          orgId: session.orgId,
          recordType: 'call_session',
          recordId: session.id,
          result: 'ALLOWED',
          details: { sessionId: session.id, endReason: reason },
        });
      } catch (error) {
        this.logger.error({ sessionId: session.id, operation: 'audit', error: errorName(error) }, 'call.ended not audited');
      }
    }
    this.logger.log({ sessionId: session.id, operation: 'close', endReason: reason }, 'Call session closed');
  }

  /** Both halves in a transaction of its own (the jobs). Null when the session was not ACTIVE. */
  async close(session: Pick<CallSessionRecord, 'id' | 'orgId'>, close: SessionClose): Promise<CallSessionRecord | null> {
    const closed = await this.scoped(session.orgId, (tx) => this.closeInTransaction(session.id, close, tx));
    if (closed) await this.announceClosed(closed);
    return closed;
  }

  /** Records who is about to end the session at the provider (see `CallsRepository.stampEndReason`). */
  stampEndReason(session: Pick<CallSessionRecord, 'id' | 'orgId'>, reason: CallSessionEndReason): Promise<boolean> {
    return this.scoped(session.orgId, (tx) => this.repo.stampEndReason(session.id, reason, tx));
  }

  /** The organization's RLS scope, or a plain transaction for a session without one. */
  scoped<T>(orgId: string | null, fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
    return orgId ? this.dbs.withOrgScope(orgId, fn) : this.dbs.withTransaction(fn);
  }
}
