/**
 * FeedbackEscalationService: the hourly `feedback.escalate-overdue` job (spec
 * FBK-04 "overdue work escalates to the configured alternate/function").
 *
 * A case the primary recipient let pass its response target moves to the
 * route's alternate, if that person is still eligible, and the alternate is
 * told. A case the reporter deliberately routed to the alternate never moves
 * back to the primary (spec FBK-03: the implicated recipient must not receive
 * it): it is marked escalated and its handler is reminded instead
 * (ADR 0002, D-EL-14). Each case is handled in its own transaction, so one
 * failure is logged by id and retried next hour.
 */
import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter } from '../audit/audit-writer.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService } from '../db/db.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { PrincipalLoader } from '../principal/principal-loader.js';
import { addHours } from './feedback-cases.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { FeedbackCasesRepository, type CaseRow } from './feedback-cases.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { FeedbackNotifier } from './feedback-notifier.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { FeedbackRoutesService } from './feedback-routes.service.js';

export interface FeedbackEscalationReport {
  /** Cases moved to the alternate. */
  escalated: number;
  /** Cases marked escalated and left with their handler (alternate route, or no eligible alternate). */
  reminded: number;
  /** Cases whose transaction threw; logged by id and retried on the next run. */
  failed: number;
}

@Injectable()
export class FeedbackEscalationService {
  private readonly logger = new Logger(FeedbackEscalationService.name);

  constructor(
    private readonly dbs: DbService,
    private readonly repo: FeedbackCasesRepository,
    private readonly routes: FeedbackRoutesService,
    private readonly audit: AuditWriter,
    private readonly principals: PrincipalLoader,
    private readonly notifier: FeedbackNotifier,
  ) {}

  async escalateOverdue(now = new Date()): Promise<FeedbackEscalationReport> {
    const report: FeedbackEscalationReport = { escalated: 0, reminded: 0, failed: 0 };
    const overdue = await this.repo.findOverdueOpenCases(now);
    for (const row of overdue) {
      try {
        const outcome = await this.escalateOne(row, now);
        if (outcome === 'escalated') report.escalated += 1;
        else report.reminded += 1;
      } catch (error) {
        report.failed += 1;
        this.logger.error({ caseId: row.id, error: error instanceof Error ? error.name : 'UnknownError' }, 'Feedback escalation failed');
      }
    }
    if (overdue.length > 0) this.logger.log({ ...report }, 'Feedback escalation run');
    return report;
  }

  private async escalateOne(row: CaseRow, now: Date): Promise<'escalated' | 'reminded'> {
    const result = await this.dbs.withOrgScope(row.orgId, async (tx) => {
      const locked = await this.repo.lockCase(row.id, tx);
      if (!locked || locked.escalatedAt !== null || !locked.dueAt || locked.dueAt.getTime() >= now.getTime()) return null;
      const route = await this.repo.findRoute(locked.routeId, tx);
      if (!route) return null;
      const moveToAlternate =
        locked.routeChoice === 'primary' &&
        locked.handlerUserId !== route.alternateHandlerUserId &&
        (await this.routes.handlerEligible(route.alternateHandlerUserId, row.orgId, now, tx));
      if (moveToAlternate) {
        if (locked.handlerUserId) await this.repo.endAssignments(locked.id, locked.handlerUserId, now, tx);
        await this.repo.insertAssignment({ userId: route.alternateHandlerUserId, targetId: locked.id, assignedByUserId: route.alternateHandlerUserId, startAt: now }, tx);
      }
      const next = await this.repo.updateCase(
        locked.id,
        moveToAlternate
          ? { handlerUserId: route.alternateHandlerUserId, routeChoice: 'alternate', escalatedAt: now, dueAt: addHours(now, route.responseTargetHours), nextAction: 'acknowledge_escalation' }
          : { escalatedAt: now },
        tx,
      );
      await this.audit.record(
        {
          action: 'feedback_case.escalated',
          actorUserId: null,
          actorKind: 'JOB',
          orgId: row.orgId,
          recordType: 'feedback_case',
          recordId: locked.id,
          result: 'ALLOWED',
          details: { moved: moveToAlternate, fromRoute: locked.routeChoice, state: next.state },
        },
        { tx },
      );
      return { next, previous: locked.handlerUserId, moved: moveToAlternate };
    });
    if (!result) return 'reminded';
    if (result.moved && result.next.handlerUserId) {
      await Promise.all([
        this.principals.invalidateUser(result.next.handlerUserId, [row.orgId]),
        result.previous ? this.principals.invalidateUser(result.previous, [row.orgId]) : Promise.resolve(),
      ]);
      await this.notifier.assigned(result.next, result.next.handlerUserId);
      return 'escalated';
    }
    if (result.next.handlerUserId) await this.notifier.updateForHandler(result.next, result.next.handlerUserId);
    return 'reminded';
  }
}
