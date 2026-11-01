/**
 * CyclesService: scheduling, launching and canceling survey cycles (spec
 * SUR-02, SUR-03, CFG-03 "launching a cycle locks its relevant rules").
 *
 * A launch snapshots every ACTIVE, date-current membership once, with the
 * primary department of the launch (`primaryDepartmentOf`), inside the cycle's
 * exclusive lock, so two launch jobs cannot double the audience. Starters
 * after launch enter the next cycle; transfers keep the snapshot's cohort;
 * leavers are stopped at submission and reminder time by the membership
 * recheck. Invitations go out after the transaction has committed.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { Principal, SurveyCycleListResponse, SurveyCycleResponse, SurveyCycleScheduleRequest } from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter } from '../audit/audit-writer.js';
import { ApiHttpException } from '../common/api-error.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService } from '../db/db.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { OrganizationsRepository } from '../db/repositories/organizations.repository.js';
import { primaryDepartmentOf } from './audience.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ListeningConfigurationService, capabilityEnabled } from './listening-configuration.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ListeningNotifier } from './listening-notifier.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ListeningRepository, type ConfigurationRow, type CycleRow } from './listening.repository.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function conflict(code: string, message: string, details?: Record<string, unknown>): ApiHttpException {
  return new ApiHttpException({ status: 409, code, message, details });
}

function notFound(): ApiHttpException {
  return new ApiHttpException({ status: 404, code: 'not_found', message: 'Survey cycle not found' });
}

export function toCycleResponse(row: CycleRow, questionnaireVersion: number, publishedSnapshotId: string | null): SurveyCycleResponse {
  return {
    id: row.id,
    opensAt: row.opensAt.toISOString(),
    closesAt: row.closesAt.toISOString(),
    status: row.status,
    audienceSize: row.audienceSize,
    questionnaireVersion,
    publishedSnapshotId,
  };
}

@Injectable()
export class CyclesService {
  private readonly logger = new Logger(CyclesService.name);

  constructor(
    private readonly dbs: DbService,
    private readonly repo: ListeningRepository,
    private readonly configuration: ListeningConfigurationService,
    private readonly organizations: OrganizationsRepository,
    private readonly audit: AuditWriter,
    private readonly notifier: ListeningNotifier,
  ) {}

  async list(orgId: string, now = new Date()): Promise<SurveyCycleListResponse> {
    const org = await this.organizations.findById(orgId);
    if (!org) throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Organization not found' });
    const [config, cycles, snapshots, activeMemberCount] = await this.dbs.withOrgScope(orgId, async (tx) => {
      const cfg = await this.configuration.ensure(orgId, tx);
      return Promise.all([
        Promise.resolve(cfg),
        this.repo.listCycles(orgId, tx),
        this.repo.listSnapshots(orgId, tx),
        this.repo.countActiveMembers(orgId, now, tx),
      ]);
    });
    const versions = await this.repo.findQuestionnaires([
      ...new Set([...cycles.map((c) => c.questionnaireVersionId), ...(config.questionnaireVersionId ? [config.questionnaireVersionId] : [])]),
    ]);
    const versionOf = (id: string | null) => versions.find((v) => v.id === id)?.version ?? null;
    const snapshotByCycle = new Map(snapshots.map((s) => [s.cycleId, s.id]));
    return {
      items: cycles.map((c) => toCycleResponse(c, versionOf(c.questionnaireVersionId) ?? 0, snapshotByCycle.get(c.id) ?? null)),
      configuration: {
        cadenceDays: config.cadenceDays,
        responseWindowDays: config.responseWindowDays,
        reminderLimit: config.reminderLimit,
        nextLaunchAt: config.nextLaunchAt?.toISOString() ?? null,
        activeMemberCount,
        questionnaireVersion: versionOf(config.questionnaireVersionId),
        timeZone: org.timezone,
      },
    };
  }

  /** An administrator schedules one cycle; a start in the past or now launches it at once. */
  async schedule(orgId: string, body: SurveyCycleScheduleRequest, actor: Principal, now = new Date()): Promise<SurveyCycleResponse> {
    const opensAt = new Date(body.opensAt);
    const created = await this.dbs.withOrgScope(orgId, async (tx) => {
      const config = await this.configuration.ensure(orgId, tx);
      const questionnaire = await this.requireLaunchable(config, opensAt, tx);
      const closesAt = addDays(opensAt, config.responseWindowDays);
      if ((await this.repo.findOverlappingCycles(orgId, opensAt, closesAt, tx)).length > 0) {
        throw conflict('cycle_overlap', 'Another cycle is scheduled or open in this window');
      }
      const policy = await this.configuration.currentPolicy(orgId, tx);
      const row = await this.repo.insertCycle(
        { orgId, questionnaireVersionId: questionnaire.id, policyVersionId: policy.id, opensAt, closesAt, status: 'scheduled' },
        tx,
      );
      if (!row) throw conflict('cycle_overlap', 'A cycle already opens at this instant');
      await this.audit.record(
        {
          action: 'listening.cycle.scheduled',
          actorUserId: actor.userId,
          actorKind: 'USER',
          orgId,
          recordType: 'survey_cycle',
          recordId: row.id,
          result: 'ALLOWED',
          details: { cycleId: row.id, opensAt: opensAt.toISOString(), closesAt: closesAt.toISOString(), questionnaireVersion: questionnaire.version },
        },
        { tx },
      );
      return { row, version: questionnaire.version };
    });
    let row = created.row;
    if (opensAt.getTime() <= now.getTime()) {
      await this.launch(row.id, now);
      row = (await this.repo.findCycle(row.id)) ?? row;
    }
    return toCycleResponse(row, created.version, null);
  }

  async cancel(orgId: string, cycleId: string, actor: Principal, now = new Date()): Promise<SurveyCycleResponse> {
    const result = await this.dbs.withOrgScope(orgId, async (tx) => {
      const cycle = await this.repo.lockCycle(cycleId, 'update', tx);
      if (!cycle || cycle.orgId !== orgId) throw notFound();
      if (cycle.status !== 'scheduled' && cycle.status !== 'open') {
        throw conflict('conflict', `A ${cycle.status} cycle cannot be canceled`, { status: cycle.status });
      }
      const updated = await this.repo.updateCycle(cycleId, { status: 'canceled', canceledAt: now }, tx);
      await this.audit.record(
        {
          action: 'listening.cycle.canceled',
          actorUserId: actor.userId,
          actorKind: 'USER',
          orgId,
          recordType: 'survey_cycle',
          recordId: cycleId,
          result: 'ALLOWED',
          details: { cycleId, from: cycle.status },
        },
        { tx },
      );
      return updated!;
    });
    const questionnaire = await this.repo.findQuestionnaire(result.questionnaireVersionId);
    return toCycleResponse(result, questionnaire?.version ?? 0, null);
  }

  /**
   * Opens a scheduled cycle: the audience snapshot and the state change in one
   * transaction under the cycle's lock; a second launch finds it `open` and
   * skips. Invitations are mailed after the commit.
   */
  async launch(cycleId: string, now = new Date()): Promise<'launched' | 'skipped'> {
    const cycle = await this.repo.findCycle(cycleId);
    if (!cycle) return 'skipped';
    const launched = await this.dbs.withOrgScope(cycle.orgId, async (tx) => {
      const locked = await this.repo.lockCycle(cycleId, 'update', tx);
      if (!locked || locked.status !== 'scheduled') return null;
      const [audience, units] = await Promise.all([this.repo.findAudience(cycle.orgId, now, tx), this.repo.findUnits(cycle.orgId, tx)]);
      await this.repo.insertParticipations(
        audience.map((member) => ({
          orgId: cycle.orgId,
          cycleId,
          membershipId: member.membershipId,
          userId: member.userId,
          cohortUnitId: primaryDepartmentOf(member.orgUnitId, units),
          state: 'invited' as const,
        })),
        tx,
      );
      const updated = await this.repo.updateCycle(cycleId, { status: 'open', audienceSize: audience.length, launchedAt: now }, tx);
      await this.audit.record(
        {
          action: 'listening.cycle.launched',
          actorUserId: null,
          actorKind: 'SYSTEM',
          orgId: cycle.orgId,
          recordType: 'survey_cycle',
          recordId: cycleId,
          result: 'ALLOWED',
          details: { cycleId, audienceSize: audience.length },
        },
        { tx },
      );
      return updated;
    });
    if (!launched) return 'skipped';
    await this.notifier.invitations(launched).catch((error: unknown) => {
      this.logger.error({ cycleId, error: error instanceof Error ? error.name : 'UnknownError' }, 'Survey invitations not sent');
    });
    return 'launched';
  }

  /** Launches every scheduled cycle whose start has passed (the tick job). */
  async launchDue(now = new Date()): Promise<string[]> {
    const launched: string[] = [];
    for (const cycle of await this.repo.findCyclesDueToLaunch(now)) {
      if ((await this.launch(cycle.id, now)) === 'launched') launched.push(cycle.id);
    }
    return launched;
  }

  /**
   * Creates the next scheduled cycle of every client whose recurring launch is
   * due and advances `nextLaunchAt` by the cadence (the tick job). A client
   * whose measurement is off or whose questionnaire is not published is
   * skipped and keeps its date, so turning the capability on resumes it.
   */
  async scheduleRecurring(now = new Date()): Promise<number> {
    let created = 0;
    for (const config of await this.repo.findConfigurationsWithLaunchDue(now)) {
      const opensAt = config.nextLaunchAt!;
      try {
        const made = await this.dbs.withOrgScope(config.orgId, async (tx) => {
          const current = await this.repo.findConfiguration(config.orgId, tx);
          if (!current?.nextLaunchAt || current.nextLaunchAt.getTime() > now.getTime()) return false;
          const questionnaire = await this.requireLaunchable(current, opensAt, tx);
          const policy = await this.configuration.currentPolicy(config.orgId, tx);
          const row = await this.repo.insertCycle(
            {
              orgId: config.orgId,
              questionnaireVersionId: questionnaire.id,
              policyVersionId: policy.id,
              opensAt,
              closesAt: addDays(opensAt, current.responseWindowDays),
              status: 'scheduled',
            },
            tx,
          );
          await this.repo.updateConfiguration(config.orgId, { nextLaunchAt: addDays(opensAt, current.cadenceDays) }, tx);
          if (row) {
            await this.audit.record(
              {
                action: 'listening.cycle.scheduled',
                actorUserId: null,
                actorKind: 'JOB',
                orgId: config.orgId,
                recordType: 'survey_cycle',
                recordId: row.id,
                result: 'ALLOWED',
                details: { cycleId: row.id, opensAt: opensAt.toISOString(), recurring: true },
              },
              { tx },
            );
          }
          return !!row;
        });
        if (made) created += 1;
      } catch (error) {
        // A disabled capability or an unpublished questionnaire: logged, retried next tick.
        this.logger.warn(
          { orgId: config.orgId, error: error instanceof ApiHttpException ? error.code : 'UnknownError' },
          'Recurring survey cycle not scheduled',
        );
      }
    }
    return created;
  }

  private async requireLaunchable(config: ConfigurationRow, opensAt: Date, tx: Parameters<ListeningRepository['findQuestionnaire']>[1]) {
    if (!capabilityEnabled(config, 'measurement', opensAt)) {
      throw conflict('measurement_disabled', 'Measurement is not enabled for this organization at that time');
    }
    const questionnaire = config.questionnaireVersionId ? await this.repo.findQuestionnaire(config.questionnaireVersionId, tx) : null;
    if (!questionnaire || questionnaire.status !== 'published') {
      throw conflict('no_published_questionnaire', 'The organization has no published questionnaire version');
    }
    return questionnaire;
  }
}
