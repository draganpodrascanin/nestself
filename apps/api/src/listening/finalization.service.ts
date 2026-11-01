/**
 * FinalizationService: closes a cycle once and publishes its one immutable
 * snapshot (spec SUR-04, 4.2, SCO-01, PRI-01, PRI-02).
 *
 * Under the cycle's `FOR UPDATE` lock (which waits for every submission
 * holding the `FOR SHARE` lock to commit) the state becomes `closing`, the
 * accepted responses are read, every cell is computed with the policy locked
 * at launch, the suppression plan is applied, and the snapshot, the cells and
 * the state change commit together. A failure rolls everything back and marks
 * the cycle `failed` with the error name for the operations queue; the next
 * tick retries. A second finalizer finds `published` and skips. Cancellation
 * of a published cycle is refused elsewhere, so a published result stays.
 */
import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter } from '../audit/audit-writer.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService } from '../db/db.service.js';
import { aggregateCells } from './aggregation.js';
import type { CycleFinalizer } from './listening-jobs.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ListeningRepository } from './listening.repository.js';

const FINALIZABLE = new Set(['open', 'closing', 'failed']);

@Injectable()
export class FinalizationService implements CycleFinalizer {
  private readonly logger = new Logger(FinalizationService.name);

  constructor(
    private readonly dbs: DbService,
    private readonly repo: ListeningRepository,
    private readonly audit: AuditWriter,
  ) {}

  async finalize(cycleId: string, now = new Date()): Promise<'published' | 'skipped' | 'failed'> {
    const cycle = await this.repo.findCycle(cycleId);
    if (!cycle) return 'skipped';
    try {
      const outcome = await this.dbs.withOrgScope(cycle.orgId, async (tx) => {
        const locked = await this.repo.lockCycle(cycleId, 'update', tx);
        if (!locked || !FINALIZABLE.has(locked.status)) return 'skipped' as const;
        if (locked.status === 'open' && locked.closesAt.getTime() > now.getTime()) return 'skipped' as const;
        if (locked.status !== 'closing') await this.repo.updateCycle(cycleId, { status: 'closing' }, tx);

        const [policy, responses] = await Promise.all([
          this.repo.findPolicyVersion(locked.policyVersionId, tx),
          this.repo.findAcceptedResponses(cycleId, locked.closesAt, tx),
        ]);
        if (!policy) throw new Error(`policy version ${locked.policyVersionId} missing`);

        const cells = aggregateCells(
          responses.map((r) => ({ cohortUnitId: r.cohortUnitId, answers: r.answers })),
          { minimumCohort: policy.minimumCohort, goodThresholdTenths: policy.goodThresholdTenths, monitorThresholdTenths: policy.monitorThresholdTenths },
        );
        const snapshot = await this.repo.insertSnapshot(
          {
            orgId: locked.orgId,
            cycleId,
            algorithmVersion: policy.algorithmVersion,
            policyVersionId: policy.id,
            questionnaireVersionId: locked.questionnaireVersionId,
            audienceSize: locked.audienceSize ?? 0,
            submittedCount: responses.length,
            publishedAt: now,
          },
          tx,
        );
        await this.repo.insertCells(
          cells.map((c) => ({
            snapshotId: snapshot.id,
            orgId: locked.orgId,
            cohortKey: c.cohortKey,
            cohortUnitId: c.cohortUnitId,
            dimensionKey: c.dimensionKey,
            validCount: c.validCount,
            favorableCount: c.favorableCount,
            neutralCount: c.neutralCount,
            unfavorableCount: c.unfavorableCount,
            scoreTenths: c.scoreTenths,
            status: c.status,
            suppression: c.suppression,
          })),
          tx,
        );
        await this.repo.updateCycle(cycleId, { status: 'published', finalizedAt: now, failureReason: null }, tx);
        await this.audit.record(
          {
            action: 'listening.cycle.finalized',
            actorUserId: null,
            actorKind: 'JOB',
            orgId: locked.orgId,
            recordType: 'survey_cycle',
            recordId: cycleId,
            result: 'ALLOWED',
            details: { cycleId, snapshotId: snapshot.id, cells: cells.length, submittedCount: responses.length, algorithmVersion: policy.algorithmVersion },
          },
          { tx },
        );
        return 'published' as const;
      });
      return outcome;
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'UnknownError';
      this.logger.error({ cycleId, error: reason }, 'Cycle finalization failed');
      await this.dbs
        .withOrgScope(cycle.orgId, (tx) => this.repo.updateCycle(cycleId, { status: 'failed', failureReason: reason }, tx))
        .catch(() => undefined);
      await this.audit.record({
        action: 'listening.cycle.failed',
        actorUserId: null,
        actorKind: 'JOB',
        orgId: cycle.orgId,
        recordType: 'survey_cycle',
        recordId: cycleId,
        result: 'NONE',
        details: { cycleId, reason },
      });
      return 'failed';
    }
  }
}
