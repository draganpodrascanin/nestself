/**
 * ListeningConfigurationService: per-client entitlements and pilot rules
 * (spec CFG-01, CFG-03; ADR 0002).
 *
 * A configuration row is created with the pilot defaults on first read. Every
 * change writes a new `listening_policy_versions` row in the same tenant
 * transaction as the configuration and its audit row, so a cycle launched
 * later locks the version in force and an earlier cycle keeps its own. The
 * audit details carry the names of the changed fields and the new policy
 * version, never the values (spec CFG-01 "safe field names").
 */
import { Injectable } from '@nestjs/common';
import {
  DEFAULT_LISTENING_POLICY,
  type ListeningConfigurationResponse,
  type ListeningConfigurationUpdateRequest,
  type Principal,
} from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter } from '../audit/audit-writer.js';
import { ApiHttpException } from '../common/api-error.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db/db.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { OrganizationsRepository } from '../db/repositories/organizations.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import {
  ListeningRepository,
  type ConfigurationRow,
  type PolicyVersionRow,
} from './listening.repository.js';

export type ListeningCapability = 'measurement' | 'feedback' | 'workplaceReviews';

const CAPABILITY_COLUMNS: Record<ListeningCapability, { from: keyof ConfigurationRow; until: keyof ConfigurationRow }> = {
  measurement: { from: 'measurementFrom', until: 'measurementUntil' },
  feedback: { from: 'feedbackFrom', until: 'feedbackUntil' },
  workplaceReviews: { from: 'workplaceReviewsFrom', until: 'workplaceReviewsUntil' },
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const date = (v: string | null | undefined): Date | null | undefined => (v === undefined ? undefined : v === null ? null : new Date(v));

/** Whether a capability is enabled at `at`: `from <= at` and (`until` unset or `at < until`). */
export function capabilityEnabled(row: ConfigurationRow, capability: ListeningCapability, at: Date): boolean {
  const { from, until } = CAPABILITY_COLUMNS[capability];
  const fromAt = row[from] as Date | null;
  const untilAt = row[until] as Date | null;
  if (!fromAt || fromAt.getTime() > at.getTime()) return false;
  return !untilAt || at.getTime() < untilAt.getTime();
}

export function toConfigurationResponse(row: ConfigurationRow, timeZone: string): ListeningConfigurationResponse {
  return {
    orgId: row.orgId,
    measurementFrom: iso(row.measurementFrom),
    measurementUntil: iso(row.measurementUntil),
    feedbackFrom: iso(row.feedbackFrom),
    feedbackUntil: iso(row.feedbackUntil),
    workplaceReviewsFrom: iso(row.workplaceReviewsFrom),
    workplaceReviewsUntil: iso(row.workplaceReviewsUntil),
    feedbackSensitiveEnabled: row.feedbackSensitiveEnabled,
    cadenceDays: row.cadenceDays,
    responseWindowDays: row.responseWindowDays,
    reminderLimit: row.reminderLimit,
    freshnessDays: row.freshnessDays,
    minimumCohort: row.minimumCohort,
    goodThresholdTenths: row.goodThresholdTenths,
    monitorThresholdTenths: row.monitorThresholdTenths,
    algorithmVersion: row.algorithmVersion,
    questionnaireVersionId: row.questionnaireVersionId,
    nextLaunchAt: iso(row.nextLaunchAt),
    policyVersion: row.policyVersion,
    timeZone,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The policy row a cycle locks, built from a configuration row. */
export function policyFromConfiguration(row: ConfigurationRow, effectiveFrom: Date, createdByUserId: string | null) {
  return {
    orgId: row.orgId,
    policyVersion: row.policyVersion,
    cadenceDays: row.cadenceDays,
    responseWindowDays: row.responseWindowDays,
    reminderLimit: row.reminderLimit,
    freshnessDays: row.freshnessDays,
    minimumCohort: row.minimumCohort,
    goodThresholdTenths: row.goodThresholdTenths,
    monitorThresholdTenths: row.monitorThresholdTenths,
    algorithmVersion: row.algorithmVersion,
    questionnaireVersionId: row.questionnaireVersionId,
    effectiveFrom,
    createdByUserId,
  };
}

@Injectable()
export class ListeningConfigurationService {
  constructor(
    private readonly dbs: DbService,
    private readonly repo: ListeningRepository,
    private readonly organizations: OrganizationsRepository,
    private readonly audit: AuditWriter,
  ) {}

  /** The configuration row, created with the pilot defaults (and policy version 1) when absent. */
  async ensure(orgId: string, tx: DbExecutor): Promise<ConfigurationRow> {
    const existing = await this.repo.findConfiguration(orgId, tx);
    if (existing) return existing;
    const created = await this.repo.insertConfiguration(
      {
        orgId,
        cadenceDays: DEFAULT_LISTENING_POLICY.cadenceDays,
        responseWindowDays: DEFAULT_LISTENING_POLICY.responseWindowDays,
        reminderLimit: DEFAULT_LISTENING_POLICY.reminderLimit,
        freshnessDays: DEFAULT_LISTENING_POLICY.freshnessDays,
        minimumCohort: DEFAULT_LISTENING_POLICY.minimumCohort,
        goodThresholdTenths: DEFAULT_LISTENING_POLICY.goodTenths,
        monitorThresholdTenths: DEFAULT_LISTENING_POLICY.monitorTenths,
        algorithmVersion: DEFAULT_LISTENING_POLICY.algorithmVersion,
        policyVersion: 1,
      },
      tx,
    );
    await this.repo.insertPolicyVersion(policyFromConfiguration(created, created.createdAt, null), tx);
    return created;
  }

  private async timeZoneOf(orgId: string): Promise<string> {
    const org = await this.organizations.findById(orgId);
    if (!org) throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Organization not found' });
    return org.timezone;
  }

  async get(orgId: string): Promise<ListeningConfigurationResponse> {
    const timeZone = await this.timeZoneOf(orgId);
    const row = await this.dbs.withOrgScope(orgId, (tx) => this.ensure(orgId, tx));
    return toConfigurationResponse(row, timeZone);
  }

  /** Reads the row without creating it: capability checks of other services. */
  async find(orgId: string): Promise<ConfigurationRow | null> {
    return this.dbs.withOrgScope(orgId, (tx) => this.repo.findConfiguration(orgId, tx));
  }

  async isEnabled(orgId: string, capability: ListeningCapability, at = new Date()): Promise<boolean> {
    const row = await this.find(orgId);
    return row ? capabilityEnabled(row, capability, at) : false;
  }

  /** The policy version in force for new cycles (creates the defaults when absent). */
  async currentPolicy(orgId: string, tx: DbExecutor): Promise<PolicyVersionRow> {
    await this.ensure(orgId, tx);
    const policy = await this.repo.findCurrentPolicyVersion(orgId, tx);
    if (!policy) throw new Error(`listening policy missing for ${orgId}`);
    return policy;
  }

  async update(
    orgId: string,
    body: ListeningConfigurationUpdateRequest,
    actor: Principal,
  ): Promise<ListeningConfigurationResponse> {
    const timeZone = await this.timeZoneOf(orgId);
    if (body.questionnaireVersionId) {
      const questionnaire = await this.repo.findQuestionnaire(body.questionnaireVersionId);
      if (!questionnaire || questionnaire.status !== 'published') {
        throw new ApiHttpException({
          status: 409,
          code: 'no_published_questionnaire',
          message: 'The questionnaire version must be published',
          details: { field: 'questionnaireVersionId' },
        });
      }
    }
    const fields = Object.keys(body).sort();
    const now = new Date();
    const row = await this.dbs.withOrgScope(orgId, async (tx) => {
      const current = await this.ensure(orgId, tx);
      const next = await this.repo.updateConfiguration(
        orgId,
        {
          measurementFrom: date(body.measurementFrom),
          measurementUntil: date(body.measurementUntil),
          feedbackFrom: date(body.feedbackFrom),
          feedbackUntil: date(body.feedbackUntil),
          workplaceReviewsFrom: date(body.workplaceReviewsFrom),
          workplaceReviewsUntil: date(body.workplaceReviewsUntil),
          feedbackSensitiveEnabled: body.feedbackSensitiveEnabled,
          cadenceDays: body.cadenceDays,
          responseWindowDays: body.responseWindowDays,
          reminderLimit: body.reminderLimit,
          freshnessDays: body.freshnessDays,
          minimumCohort: body.minimumCohort,
          goodThresholdTenths: body.goodThresholdTenths,
          monitorThresholdTenths: body.monitorThresholdTenths,
          questionnaireVersionId: body.questionnaireVersionId,
          nextLaunchAt: date(body.nextLaunchAt),
          policyVersion: current.policyVersion + 1,
          updatedByUserId: actor.userId,
        },
        tx,
      );
      if (!next) throw new Error('listening configuration vanished during update');
      await this.repo.insertPolicyVersion(policyFromConfiguration(next, now, actor.userId), tx);
      await this.audit.record(
        {
          action: 'listening.configuration.changed',
          actorUserId: actor.userId,
          actorKind: 'USER',
          orgId,
          recordType: 'listening_configuration',
          recordId: next.id,
          result: 'ALLOWED',
          details: { fields, policyVersion: next.policyVersion },
        },
        { tx },
      );
      return next;
    });
    return toConfigurationResponse(row, timeZone);
  }
}
