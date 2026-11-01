/**
 * ExportService: the aggregate CSV of one snapshot (spec REP-04). Rows are the
 * heatmap rows of `ReportsService`, so the file agrees with the dashboard cell
 * for cell and a hidden cell has empty values and its gray reason. Generated
 * on request behind the `export` step-up class and audited (ADR 0002,
 * D-EL-09); nothing is stored.
 */
import { Injectable } from '@nestjs/common';
import type { Principal } from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter } from '../audit/audit-writer.js';
import { ApiHttpException } from '../common/api-error.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService } from '../db/db.service.js';
import { csvDocument } from './csv.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ListeningRepository } from './listening.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ReportsService } from './reports.service.js';

export const EXPORT_COLUMNS = [
  'snapshot_id',
  'cycle_opens_at',
  'cycle_closes_at',
  'questionnaire_version',
  'policy_version',
  'algorithm_version',
  'cohort',
  'cohort_name',
  'dimension',
  'score',
  'status',
  'respondents',
  'favorable_pct',
  'neutral_pct',
  'unfavorable_pct',
  'gray_reason',
] as const;

export interface ExportFile {
  filename: string;
  content: string;
}

@Injectable()
export class ExportService {
  constructor(
    private readonly dbs: DbService,
    private readonly repo: ListeningRepository,
    private readonly reports: ReportsService,
    private readonly audit: AuditWriter,
  ) {}

  async csv(orgId: string, principal: Principal, snapshotId: string): Promise<ExportFile> {
    const data = await this.dbs.withOrgScope(orgId, async (tx) => {
      const snapshots = await this.repo.listSnapshots(orgId, tx);
      const snapshot = snapshots.find((s) => s.id === snapshotId);
      if (!snapshot) throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
      const [cells, units, policy] = await Promise.all([
        this.repo.findCells(snapshot.id, tx),
        this.repo.findUnits(orgId, tx),
        this.repo.findPolicyVersion(snapshot.policyVersionId, tx),
      ]);
      return { snapshot, cells, units, policy };
    });
    const questionnaire = await this.repo.findQuestionnaire(data.snapshot.questionnaireVersionId);
    const rows = this.reports.heatmapRows(data.cells, data.units).flatMap((row) =>
      row.cells.map((cell) => [
        data.snapshot.id,
        data.snapshot.opensAt.toISOString(),
        data.snapshot.closesAt.toISOString(),
        questionnaire?.version ?? null,
        data.policy?.policyVersion ?? null,
        data.snapshot.algorithmVersion,
        row.cohortKey,
        row.name,
        cell.key,
        cell.score,
        cell.status,
        cell.respondentCount,
        cell.distribution?.favorablePct ?? null,
        cell.distribution?.neutralPct ?? null,
        cell.distribution?.unfavorablePct ?? null,
        cell.grayReason,
      ]),
    );
    await this.audit.record({
      action: 'listening.export.generated',
      actorUserId: principal.userId,
      actorKind: 'USER',
      orgId,
      recordType: 'survey_snapshot',
      recordId: data.snapshot.id,
      result: 'ALLOWED',
      details: { snapshotId: data.snapshot.id, rows: rows.length, format: 'csv' },
    });
    return { filename: `listening-${data.snapshot.id}.csv`, content: csvDocument(EXPORT_COLUMNS, rows) };
  }
}
