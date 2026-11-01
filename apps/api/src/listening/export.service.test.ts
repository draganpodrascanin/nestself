/**
 * ExportService unit tests (spec REP-04): the file is built from the same
 * public cells as the heatmap, hidden cells carry no value, and the export is audited.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Principal } from '@nestself/contracts';
import { ExportService } from './export.service.js';
import type { CellRow } from './listening.repository.js';
import { ReportsService } from './reports.service.js';

const NOW = new Date('2026-11-01T10:00:00.000Z');
const actor = { userId: 'user_ivana' } as Principal;

function cell(cohortKey: string, dimensionKey: string, validCount: number, favorableCount: number, suppression: CellRow['suppression']): CellRow {
  return {
    id: `${cohortKey}_${dimensionKey}`,
    snapshotId: 'snap_1',
    orgId: 'org_sample',
    cohortKey,
    cohortUnitId: cohortKey === 'company' ? null : cohortKey,
    dimensionKey,
    validCount,
    favorableCount,
    neutralCount: 0,
    unfavorableCount: validCount - favorableCount,
    scoreTenths: validCount === 0 ? null : Math.round((1000 * favorableCount) / validCount),
    status: validCount === 0 ? null : favorableCount / validCount >= 0.75 ? 'good' : favorableCount / validCount >= 0.6 ? 'monitor' : 'danger',
    suppression,
  };
}

describe('ExportService', () => {
  it('writes one row per cohort and dimension with empty values for hidden cells, and audits', async () => {
    const cells = [cell('company', 'job_satisfaction', 25, 20, null), cell('ou_eng', 'job_satisfaction', 20, 16, 'secondary'), cell('ou_ops', 'job_satisfaction', 5, 4, 'primary')];
    const units = [
      { id: 'ou_root', parentId: null, kind: 'COMPANY' as const, name: 'Root' },
      { id: 'ou_eng', parentId: 'ou_root', kind: 'DEPARTMENT' as const, name: 'Engineering' },
      { id: 'ou_ops', parentId: 'ou_root', kind: 'DEPARTMENT' as const, name: 'Operations' },
    ];
    const snapshot = { id: 'snap_1', orgId: 'org_sample', cycleId: 'cycle_1', algorithmVersion: 1, policyVersionId: 'policy_1', questionnaireVersionId: 'q1', audienceSize: 30, submittedCount: 25, publishedAt: NOW, createdAt: NOW, opensAt: new Date('2026-10-20T07:00:00.000Z'), closesAt: new Date('2026-10-27T07:00:00.000Z') };
    const repo = {
      listSnapshots: vi.fn().mockResolvedValue([snapshot]),
      findCells: vi.fn().mockResolvedValue(cells),
      findUnits: vi.fn().mockResolvedValue(units),
      findPolicyVersion: vi.fn().mockResolvedValue({ id: 'policy_1', policyVersion: 3 }),
      findQuestionnaire: vi.fn().mockResolvedValue({ id: 'q1', version: 1 }),
    };
    const dbs = { withOrgScope: vi.fn(async (_o: string, fn: (t: unknown) => Promise<unknown>) => fn({})) };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const reports = new ReportsService(dbs as never, repo as never, {} as never, {} as never, audit as never);
    const service = new ExportService(dbs as never, repo as never, reports, audit as never);

    const file = await service.csv('org_sample', actor, 'snap_1');
    expect(file.filename).toBe('listening-snap_1.csv');
    const lines = file.content.trimEnd().split('\r\n');
    expect(lines[0]).toBe('snapshot_id,cycle_opens_at,cycle_closes_at,questionnaire_version,policy_version,algorithm_version,cohort,cohort_name,dimension,score,status,respondents,favorable_pct,neutral_pct,unfavorable_pct,gray_reason');
    // 3 cohorts x 5 dimensions
    expect(lines).toHaveLength(16);
    expect(lines[1]).toBe('snap_1,2026-10-20T07:00:00.000Z,2026-10-27T07:00:00.000Z,1,3,1,company,company,job_satisfaction,80.0,good,25,80,0,20,');
    const engineering = lines.find((l) => l.includes(',ou_eng,Engineering,job_satisfaction,'))!;
    expect(engineering.endsWith(',job_satisfaction,,,,,,,privacy_suppressed')).toBe(true);
    const operations = lines.find((l) => l.includes(',ou_ops,Operations,job_satisfaction,'))!;
    expect(operations.endsWith(',job_satisfaction,,,,,,,insufficient_responses')).toBe(true);
    expect(file.content).not.toMatch(/\b16\b|\b20,16\b/);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'listening.export.generated', recordId: 'snap_1', details: { snapshotId: 'snap_1', rows: 15, format: 'csv' } }));
  });

  it('404s a snapshot of another organization or an unknown id', async () => {
    const repo = { listSnapshots: vi.fn().mockResolvedValue([]) };
    const dbs = { withOrgScope: vi.fn(async (_o: string, fn: (t: unknown) => Promise<unknown>) => fn({})) };
    const service = new ExportService(dbs as never, repo as never, {} as never, { record: vi.fn() } as never);
    await expect(service.csv('org_sample', actor, 'snap_x')).rejects.toMatchObject({ status: 404 });
  });
});
