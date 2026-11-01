/**
 * ReportsService: the protected employer reports (spec SCO-02, SCO-03,
 * REP-01..03). Everything leaves through `toCell`, so cards, heatmap, detail,
 * export and the review pack carry the same disclosure decisions. Reads are
 * audited as content access with ids only.
 *
 * Freshness: the current overview marks a latest result older than the
 * policy's freshness window `stale`; cards keep their score and status (the
 * client labels them) and the review offer is off. Historical points keep
 * their own status. A trend compares the same dimension and cohort between
 * two published snapshots whose questionnaire versions are the same or
 * declared comparable; a hidden endpoint breaks it (`suppressed`).
 */
import { Injectable } from '@nestjs/common';
import {
  isStale,
  trendTenths,
  type DimensionCard,
  type DimensionCell,
  type HeatmapRow,
  type ListeningDimensionDetailResponse,
  type ListeningDimensionKey,
  type ListeningHeatmapResponse,
  type ListeningOverviewResponse,
  type Principal,
  type QuestionnaireDimension,
  type Trend,
  LISTENING_DIMENSION_KEYS,
} from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter } from '../audit/audit-writer.js';
import { ApiHttpException } from '../common/api-error.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService } from '../db/db.service.js';
import { hiddenCell, toCell } from './aggregation.js';
import { COMPANY_COHORT, UNASSIGNED_COHORT, departmentsOf } from './audience.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ListeningConfigurationService, capabilityEnabled } from './listening-configuration.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import {
  ListeningRepository,
  type CellRow,
  type ConfigurationRow,
  type QuestionnaireRow,
  type SnapshotRow,
} from './listening.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ReviewOfferService } from './review-offer.service.js';

type SnapshotWithWindow = SnapshotRow & { opensAt: Date; closesAt: Date };

function notFound(): ApiHttpException {
  return new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
}

/** Whether results of `current` may be compared with `previous` (spec SCO-03). */
export function comparable(current: QuestionnaireRow | undefined, previous: QuestionnaireRow | undefined): boolean {
  if (!current || !previous) return false;
  if (current.id === previous.id) return true;
  return current.comparableWithVersionId === previous.id || previous.comparableWithVersionId === current.id;
}

/** The trend of one cell against the same cell of the previous snapshot. */
export function trendOf(
  current: DimensionCell,
  previousCell: CellRow | undefined,
  previousSnapshotId: string | undefined,
  versionsComparable: boolean,
): Trend {
  if (!previousSnapshotId || !previousCell) return { comparable: false, reason: 'no_previous' };
  if (!versionsComparable) return { comparable: false, reason: 'incompatible_version' };
  const previous = toCell(previousCell);
  const delta = trendTenths(current.scoreTenths, previous.scoreTenths);
  if (delta === null) return { comparable: false, reason: 'suppressed' };
  return { comparable: true, deltaTenths: delta, previousSnapshotId };
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly dbs: DbService,
    private readonly repo: ListeningRepository,
    private readonly configuration: ListeningConfigurationService,
    private readonly offers: ReviewOfferService,
    private readonly audit: AuditWriter,
  ) {}

  async overview(orgId: string, principal: Principal, now = new Date()): Promise<ListeningOverviewResponse> {
    const data = await this.dbs.withOrgScope(orgId, async (tx) => {
      const config = await this.configuration.ensure(orgId, tx);
      const [snapshots, collecting] = await Promise.all([this.repo.listSnapshots(orgId, tx), this.repo.findOpenCycle(orgId, tx)]);
      const current = snapshots[0];
      const previous = snapshots[1];
      const [cells, previousCells, policy] = current
        ? await Promise.all([
            this.repo.findCells(current.id, tx),
            previous ? this.repo.findCells(previous.id, tx) : Promise.resolve([] as CellRow[]),
            this.repo.findPolicyVersion(current.policyVersionId, tx),
          ])
        : [[], [], null];
      return { config, snapshots, collecting, current, previous, cells, previousCells, policy };
    });
    const versions = await this.repo.findQuestionnaires([...new Set(data.snapshots.map((s) => s.questionnaireVersionId))]);
    const versionOf = (id: string) => versions.find((v) => v.id === id);
    const capabilities = this.capabilities(data.config, now);

    let current: ListeningOverviewResponse['current'] = null;
    let reviewOffer: ListeningOverviewResponse['reviewOffer'] = null;
    if (data.current) {
      const snapshot = data.current;
      const minimum = data.policy?.minimumCohort ?? data.config.minimumCohort;
      const freshness = data.policy?.freshnessDays ?? data.config.freshnessDays;
      const stale = isStale(snapshot.closesAt, freshness, now);
      const versionsComparable = comparable(versionOf(snapshot.questionnaireVersionId), data.previous ? versionOf(data.previous.questionnaireVersionId) : undefined);
      const dimensions = this.cards(data.cells, data.previousCells, data.previous?.id, versionsComparable);
      current = {
        snapshotId: snapshot.id,
        cycleId: snapshot.cycleId,
        opensAt: snapshot.opensAt.toISOString(),
        closesAt: snapshot.closesAt.toISOString(),
        publishedAt: snapshot.publishedAt.toISOString(),
        questionnaireVersion: versionOf(snapshot.questionnaireVersionId)?.version ?? 0,
        stale,
        participation:
          snapshot.submittedCount >= minimum
            ? { audienceSize: snapshot.audienceSize, submittedCount: snapshot.submittedCount }
            : { audienceSize: null, submittedCount: null },
        dimensions,
      };
      reviewOffer = await this.offers.evaluate(principal, {
        orgId,
        snapshotId: snapshot.id,
        cohortKey: COMPANY_COHORT,
        stale,
        workplaceReviewsEnabled: capabilities.workplaceReviews,
        cells: data.cells,
      });
      await this.auditRead(principal, orgId, snapshot.id, 'overview');
    }
    return {
      capabilities,
      collecting: data.collecting
        ? { cycleId: data.collecting.id, opensAt: data.collecting.opensAt.toISOString(), closesAt: data.collecting.closesAt.toISOString() }
        : null,
      current,
      history: data.snapshots.map((s) => ({ snapshotId: s.id, cycleId: s.cycleId, closesAt: s.closesAt.toISOString() })),
      reviewOffer,
    };
  }

  async heatmap(orgId: string, principal: Principal, snapshotId: string | undefined, now = new Date()): Promise<ListeningHeatmapResponse> {
    const { snapshot, cells, units, policy } = await this.dbs.withOrgScope(orgId, async (tx) => {
      const snapshots = await this.repo.listSnapshots(orgId, tx);
      const chosen = snapshotId ? snapshots.find((s) => s.id === snapshotId) : snapshots[0];
      if (!chosen) throw notFound();
      const [cells, units, policy] = await Promise.all([
        this.repo.findCells(chosen.id, tx),
        this.repo.findUnits(orgId, tx),
        this.repo.findPolicyVersion(chosen.policyVersionId, tx),
      ]);
      return { snapshot: chosen, cells, units, policy };
    });
    const config = await this.configuration.find(orgId);
    const freshness = policy?.freshnessDays ?? config?.freshnessDays ?? 45;
    await this.auditRead(principal, orgId, snapshot.id, 'heatmap');
    return {
      snapshotId: snapshot.id,
      closesAt: snapshot.closesAt.toISOString(),
      stale: isStale(snapshot.closesAt, freshness, now),
      rows: this.heatmapRows(cells, units),
    };
  }

  /** The rows of a snapshot: the company, every department with a cell, and `unassigned` only when it shows. */
  heatmapRows(cells: readonly CellRow[], units: Awaited<ReturnType<ListeningRepository['findUnits']>>): HeatmapRow[] {
    const cellsOf = (cohortKey: string): DimensionCell[] =>
      LISTENING_DIMENSION_KEYS.map((key) => {
        const row = cells.find((c) => c.cohortKey === cohortKey && c.dimensionKey === key);
        return row ? toCell(row) : hiddenCell(key, 'not_measured');
      });
    const rows: HeatmapRow[] = [{ cohortKey: COMPANY_COHORT, name: COMPANY_COHORT, kind: 'company', cells: cellsOf(COMPANY_COHORT) }];
    const cohortKeys = new Set(cells.map((c) => c.cohortKey));
    for (const unit of departmentsOf(units)) {
      if (!cohortKeys.has(unit.id)) continue;
      rows.push({ cohortKey: unit.id, name: unit.name, kind: 'department', cells: cellsOf(unit.id) });
    }
    // A department that no longer exists in the tree still has cells: keep it under its id.
    for (const key of cohortKeys) {
      if (key === COMPANY_COHORT || key === UNASSIGNED_COHORT || rows.some((r) => r.cohortKey === key)) continue;
      rows.push({ cohortKey: key, name: key, kind: 'department', cells: cellsOf(key) });
    }
    if (cohortKeys.has(UNASSIGNED_COHORT) && cells.some((c) => c.cohortKey === UNASSIGNED_COHORT && c.suppression === null)) {
      rows.push({ cohortKey: UNASSIGNED_COHORT, name: UNASSIGNED_COHORT, kind: 'unassigned', cells: cellsOf(UNASSIGNED_COHORT) });
    }
    return rows;
  }

  async dimensionDetail(
    orgId: string,
    principal: Principal,
    key: ListeningDimensionKey,
    snapshotId: string | undefined,
    now = new Date(),
  ): Promise<ListeningDimensionDetailResponse> {
    const data = await this.dbs.withOrgScope(orgId, async (tx) => {
      const snapshots = await this.repo.listSnapshots(orgId, tx);
      const index = snapshotId ? snapshots.findIndex((s) => s.id === snapshotId) : 0;
      const chosen = snapshots[index];
      if (!chosen) throw notFound();
      const cells = await this.repo.findCellsOfSnapshots(snapshots.map((s) => s.id), tx);
      const policy = await this.repo.findPolicyVersion(chosen.policyVersionId, tx);
      return { snapshots, chosen, index, cells, policy };
    });
    const versions = await this.repo.findQuestionnaires([...new Set(data.snapshots.map((s) => s.questionnaireVersionId))]);
    const versionOf = (id: string) => versions.find((v) => v.id === id);
    const chosenVersion = versionOf(data.chosen.questionnaireVersionId);
    const definition = (chosenVersion?.dimensions as QuestionnaireDimension[] | undefined)?.find((d) => d.key === key);
    if (!definition) throw notFound();

    const companyCell = (snapshot: SnapshotWithWindow) => data.cells.find((c) => c.snapshotId === snapshot.id && c.cohortKey === COMPANY_COHORT && c.dimensionKey === key);
    const previous = data.snapshots[data.index + 1];
    const current = companyCell(data.chosen);
    const publicCell = current ? toCell(current) : hiddenCell(key, 'not_measured');
    const trend = trendOf(publicCell, previous ? companyCell(previous) : undefined, previous?.id, comparable(chosenVersion, previous ? versionOf(previous.questionnaireVersionId) : undefined));
    const freshness = data.policy?.freshnessDays ?? 45;
    await this.auditRead(principal, orgId, data.chosen.id, `dimension:${key}`);
    return {
      key,
      question: definition.question,
      scaleLow: definition.scaleLow,
      scaleHigh: definition.scaleHigh,
      explanation: definition.explanation,
      snapshotId: data.chosen.id,
      closesAt: data.chosen.closesAt.toISOString(),
      stale: isStale(data.chosen.closesAt, freshness, now),
      cell: { ...publicCell, trend },
      series: data.snapshots
        .slice()
        .reverse()
        .map((snapshot) => {
          const cell = companyCell(snapshot);
          const pub = cell ? toCell(cell) : hiddenCell(key, 'not_measured');
          return {
            snapshotId: snapshot.id,
            closesAt: snapshot.closesAt.toISOString(),
            scoreTenths: pub.scoreTenths,
            status: pub.status,
            grayReason: pub.grayReason,
            comparable: comparable(chosenVersion, versionOf(snapshot.questionnaireVersionId)),
          };
        }),
    };
  }

  async dismissOffer(orgId: string, principal: Principal, snapshotId: string): Promise<void> {
    await this.dbs.withOrgScope(orgId, async (tx) => {
      const snapshot = await this.repo.findSnapshot(snapshotId, tx);
      if (!snapshot || snapshot.orgId !== orgId) throw notFound();
      await this.repo.insertDismissal({ orgId, snapshotId, userId: principal.userId }, tx);
      await this.audit.record(
        {
          action: 'listening.offer.dismissed',
          actorUserId: principal.userId,
          actorKind: 'USER',
          orgId,
          recordType: 'survey_snapshot',
          recordId: snapshotId,
          result: 'ALLOWED',
          details: { snapshotId },
        },
        { tx },
      );
    });
  }

  /** The company cards of the current snapshot with their trends. */
  private cards(cells: readonly CellRow[], previousCells: readonly CellRow[], previousSnapshotId: string | undefined, versionsComparable: boolean): DimensionCard[] {
    return LISTENING_DIMENSION_KEYS.map((key) => {
      const row = cells.find((c) => c.cohortKey === COMPANY_COHORT && c.dimensionKey === key);
      const cell = row ? toCell(row) : hiddenCell(key, 'not_measured');
      const previousRow = previousCells.find((c) => c.cohortKey === COMPANY_COHORT && c.dimensionKey === key);
      return { ...cell, trend: trendOf(cell, previousRow, previousSnapshotId, versionsComparable) };
    });
  }

  private capabilities(config: ConfigurationRow, now: Date) {
    return {
      measurement: capabilityEnabled(config, 'measurement', now),
      feedback: capabilityEnabled(config, 'feedback', now),
      workplaceReviews: capabilityEnabled(config, 'workplaceReviews', now),
    };
  }

  private auditRead(principal: Principal, orgId: string, snapshotId: string, view: string): Promise<void> {
    return this.audit.record({
      action: 'listening.report.read',
      actorUserId: principal.userId,
      actorKind: 'USER',
      orgId,
      recordType: 'survey_snapshot',
      recordId: snapshotId,
      result: 'ALLOWED',
      details: { snapshotId, view },
    });
  }
}
