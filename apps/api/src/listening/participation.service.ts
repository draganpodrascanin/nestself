/**
 * ParticipationService: the employee's own survey (spec EMP-01, EMP-02, 4.2).
 *
 * Every read and write runs in the personal context's organization under
 * RLS, on the caller's own participation row only. Submission is accepted
 * only while `opensAt <= server_accepted_at < closesAt` under the cycle's
 * `FOR SHARE` lock, with `clock_timestamp()` taken inside the transaction:
 * the finalizer's `FOR UPDATE` waits for in-flight submissions, and a
 * submission that reaches the lock after the finalizer sees `closing` and is
 * refused. The participation row moves to `submitted` only from `invited` or
 * `draft`, so a retry from another device answers `already_submitted`.
 *
 * No audit row and no log line names the respondent (spec PRI-03, PRI-04).
 */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  SURVEY_ESTIMATED_MINUTES,
  type MySurveyResponse,
  type Principal,
  type QuestionnaireDimension,
  type SurveyDraftRequest,
  type SurveyDraftResponse,
  type SurveyReceiptResponse,
  type SurveySubmitRequest,
} from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type Transaction } from '../db/db.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { MembershipsRepository } from '../db/repositories/memberships.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { OrganizationsRepository } from '../db/repositories/organizations.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ListeningRepository, type CycleRow, type ParticipationRow } from './listening.repository.js';

function error(status: number, code: string, message: string): ApiHttpException {
  return new ApiHttpException({ status, code, message });
}

/** The organization of the caller's personal context; the resolver already required it. */
function personalOrgId(principal: Principal): string {
  const ctx = principal.context;
  if (ctx.kind !== 'personal' || !ctx.orgId) {
    throw error(403, 'invalid_context', 'This endpoint requires a personal context with an organisation');
  }
  return ctx.orgId;
}

/** `clock_timestamp()`: the instant inside the transaction, after the lock was taken. */
async function serverNow(tx: Transaction): Promise<Date> {
  const result = await tx.execute(sql`select clock_timestamp() as now`);
  const row = (result.rows as Array<{ now: Date | string }>)[0];
  const value = row?.now;
  return value instanceof Date ? value : new Date(value ?? Date.now());
}

function isOpenAt(cycle: CycleRow, at: Date): boolean {
  return cycle.status === 'open' && cycle.opensAt.getTime() <= at.getTime() && at.getTime() < cycle.closesAt.getTime();
}

@Injectable()
export class ParticipationService {
  constructor(
    private readonly dbs: DbService,
    private readonly repo: ListeningRepository,
    private readonly memberships: MembershipsRepository,
    private readonly organizations: OrganizationsRepository,
  ) {}

  /** The open cycle the caller was invited to, with the questionnaire, the notice and the caller's own state. */
  async current(principal: Principal, now = new Date()): Promise<MySurveyResponse> {
    const orgId = personalOrgId(principal);
    return this.dbs.withOrgScope(orgId, async (tx) => {
      const cycle = await this.repo.findOpenCycle(orgId, tx);
      if (!cycle || !isOpenAt(cycle, now)) return { cycle: null };
      const participation = await this.repo.findParticipation(cycle.id, principal.userId, tx);
      if (!participation || participation.state === 'ineligible') return { cycle: null };
      const [questionnaire, draft, org] = await Promise.all([
        this.repo.findQuestionnaire(cycle.questionnaireVersionId, tx),
        participation.state === 'draft' ? this.repo.findDraft(participation.id, tx) : Promise.resolve(null),
        this.organizations.findById(orgId, tx),
      ]);
      if (!questionnaire) return { cycle: null };
      return {
        cycle: {
          id: cycle.id,
          opensAt: cycle.opensAt.toISOString(),
          closesAt: cycle.closesAt.toISOString(),
          timeZone: org?.timezone ?? 'Europe/Belgrade',
          estimatedMinutes: SURVEY_ESTIMATED_MINUTES,
        },
        questionnaire: {
          id: questionnaire.id,
          version: questionnaire.version,
          dimensions: questionnaire.dimensions as QuestionnaireDimension[],
          notice: questionnaire.notice,
        },
        participation: {
          state: participation.state as 'invited' | 'draft' | 'submitted',
          draft: (draft?.answers as Record<string, number> | undefined) ?? null,
          submittedAt: participation.submittedAt?.toISOString() ?? null,
        },
      };
    });
  }

  /** Saves the caller's private draft while the cycle is open; a draft never enters results. */
  async saveDraft(principal: Principal, cycleId: string, body: SurveyDraftRequest, now = new Date()): Promise<SurveyDraftResponse> {
    const orgId = personalOrgId(principal);
    return this.dbs.withOrgScope(orgId, async (tx) => {
      const { cycle, participation } = await this.ownParticipation(orgId, cycleId, principal.userId, tx);
      if (!isOpenAt(cycle, now)) throw error(409, 'cycle_closed', 'This survey is no longer open');
      if (participation.state === 'submitted') throw error(409, 'already_submitted', 'This survey was already submitted');
      await this.repo.upsertDraft(participation.id, orgId, body.answers, tx);
      if (participation.state === 'invited') await this.repo.updateParticipation(participation.id, { state: 'draft' }, tx);
      return { savedAt: now.toISOString() };
    });
  }

  /** Accepts the caller's answers once, under the cycle's acceptance lock (spec 4.2). */
  async submit(principal: Principal, cycleId: string, body: SurveySubmitRequest): Promise<SurveyReceiptResponse> {
    const orgId = personalOrgId(principal);
    return this.dbs.withOrgScope(orgId, async (tx) => {
      const cycle = await this.repo.lockCycle(cycleId, 'share', tx);
      if (!cycle || cycle.orgId !== orgId) throw error(404, 'not_found', 'Survey cycle not found');
      const acceptedAt = await serverNow(tx);
      if (!isOpenAt(cycle, acceptedAt)) throw error(409, 'cycle_closed', 'This survey is no longer open');
      const participation = await this.repo.findParticipation(cycle.id, principal.userId, tx);
      if (!participation || participation.state === 'ineligible') throw error(403, 'not_eligible', 'You are not in this survey audience');
      if (participation.state === 'submitted') throw error(409, 'already_submitted', 'This survey was already submitted');
      const membership = await this.memberships.findByIdAndOrg(participation.membershipId, orgId, tx);
      if (!membership || membership.status !== 'ACTIVE' || (membership.endDate && membership.endDate.getTime() <= acceptedAt.getTime())) {
        throw error(403, 'not_eligible', 'Your membership is no longer active');
      }
      if (body.questionnaireVersionId !== cycle.questionnaireVersionId) {
        throw error(409, 'template_version_mismatch', 'The questionnaire changed; reload the survey');
      }
      const responseId = randomUUID();
      const marked = await this.repo.markSubmitted(participation.id, responseId, acceptedAt, tx);
      if (!marked) throw error(409, 'already_submitted', 'This survey was already submitted');
      await this.repo.insertResponse(
        {
          id: responseId,
          orgId,
          cycleId: cycle.id,
          questionnaireVersionId: cycle.questionnaireVersionId,
          cohortUnitId: participation.cohortUnitId,
          answers: body.answers as Record<string, number>,
          acceptedAt,
        },
        tx,
      );
      await this.repo.deleteDraft(participation.id, tx);
      return { submittedAt: acceptedAt.toISOString() };
    });
  }

  private async ownParticipation(
    orgId: string,
    cycleId: string,
    userId: string,
    tx: Transaction,
  ): Promise<{ cycle: CycleRow; participation: ParticipationRow }> {
    const cycle = await this.repo.findCycle(cycleId, tx);
    if (!cycle || cycle.orgId !== orgId) throw error(404, 'not_found', 'Survey cycle not found');
    const participation = await this.repo.findParticipation(cycle.id, userId, tx);
    if (!participation || participation.state === 'ineligible') throw error(403, 'not_eligible', 'You are not in this survey audience');
    return { cycle, participation };
  }
}
