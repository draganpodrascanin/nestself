/**
 * FollowUpCallRoom: what the follow-up lifecycle needs from the calls module
 * (T-CW-1.9, D-CW-37): the finished consultation's latest outcome, its latest
 * session (whose `call:{sessionId}` room the post-call screens listen on),
 * and the typed follow-up emitters of `CallsService`.
 *
 * `CallsModule` imports `AppointmentsModule`, so `AppointmentsModule` cannot
 * import it back without a module cycle. The two calls providers are looked
 * up once, at first use, across the application (`ModuleRef`, `strict:
 * false`), the way `CallsModule` finds `ChimeEventsConsumer`; both the API
 * and the worker include `CallsModule`.
 *
 * Reads run in the appointment's organization scope (RLS).
 */
import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ModuleRef } from '@nestjs/core';
import type {
  CallOutcomeStatus,
  FollowUpConfirmedPayload,
  FollowUpDeclinedPayload,
  FollowUpProposedPayload,
  TimesSuggestedPayload,
} from '@nestself/contracts';
import { CallsRepository } from '../calls/calls.repository.js';
import { CallsService } from '../calls/calls.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService } from '../db/db.service.js';
import type { AppointmentRecord } from './appointments.repository.js';

type Consultation = Pick<AppointmentRecord, 'id' | 'orgId'>;

@Injectable()
export class FollowUpCallRoom {
  private calls: CallsService | null = null;
  private repo: CallsRepository | null = null;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly dbs: DbService,
  ) {}

  /** The latest delivery status recorded for the consultation, or null before any. */
  latestOutcomeStatus(consultation: Consultation): Promise<CallOutcomeStatus | null> {
    return this.dbs.withOrgScope(consultation.orgId, (tx) =>
      this.callsRepository().findLatestOutcomeStatus(consultation.id, tx),
    );
  }

  /** The consultation's latest session id (its room), or null when it never had one. */
  async latestSessionId(consultation: Consultation): Promise<string | null> {
    const session = await this.dbs.withOrgScope(consultation.orgId, (tx) =>
      this.callsRepository().findLatestSessionByAppointment(consultation.id, tx),
    );
    return session?.id ?? null;
  }

  emitProposed(sessionId: string, payload: FollowUpProposedPayload): boolean {
    return this.callsService().emitFollowUpProposed(sessionId, payload);
  }

  emitConfirmed(sessionId: string, payload: FollowUpConfirmedPayload): boolean {
    return this.callsService().emitFollowUpConfirmed(sessionId, payload);
  }

  emitDeclined(sessionId: string, payload: FollowUpDeclinedPayload): boolean {
    return this.callsService().emitFollowUpDeclined(sessionId, payload);
  }

  emitTimesSuggested(sessionId: string, payload: TimesSuggestedPayload): boolean {
    return this.callsService().emitTimesSuggested(sessionId, payload);
  }

  /** `ModuleRef.get` throws when the provider is not part of the application; that error is left to surface. */
  private callsService(): CallsService {
    const calls = this.calls ?? this.moduleRef.get<CallsService>(CallsService, { strict: false });
    this.calls = calls;
    return calls;
  }

  private callsRepository(): CallsRepository {
    const repo = this.repo ?? this.moduleRef.get<CallsRepository>(CallsRepository, { strict: false });
    this.repo = repo;
    return repo;
  }
}
