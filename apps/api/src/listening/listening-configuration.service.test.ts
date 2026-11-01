/**
 * ListeningConfigurationService unit tests (spec CFG-01, CFG-03): defaults on
 * first read, a policy version per change, field names (never values) in the
 * audit row, entitlement windows.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Principal } from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import {
  ListeningConfigurationService,
  capabilityEnabled,
  toConfigurationResponse,
} from './listening-configuration.service.js';
import type { ConfigurationRow } from './listening.repository.js';

const NOW = new Date('2026-11-01T10:00:00.000Z');

function configuration(overrides: Partial<ConfigurationRow> = {}): ConfigurationRow {
  return {
    id: 'cfg_1',
    orgId: 'org_sample',
    measurementFrom: new Date('2026-01-01T00:00:00.000Z'),
    measurementUntil: null,
    feedbackFrom: null,
    feedbackUntil: null,
    workplaceReviewsFrom: new Date('2026-01-01T00:00:00.000Z'),
    workplaceReviewsUntil: new Date('2026-10-01T00:00:00.000Z'),
    feedbackSensitiveEnabled: false,
    cadenceDays: 14,
    responseWindowDays: 7,
    reminderLimit: 2,
    freshnessDays: 45,
    minimumCohort: 10,
    goodThresholdTenths: 750,
    monitorThresholdTenths: 600,
    algorithmVersion: 1,
    questionnaireVersionId: 'q1',
    nextLaunchAt: null,
    policyVersion: 1,
    updatedByUserId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const actor = { userId: 'user_nikola' } as Principal;

function setup(existing: ConfigurationRow | null) {
  const tx = { tag: 'tx' };
  const repo = {
    findConfiguration: vi.fn().mockResolvedValue(existing),
    insertConfiguration: vi.fn(async (values: Partial<ConfigurationRow>) => configuration({ ...values, id: 'cfg_new' })),
    updateConfiguration: vi.fn(async (_orgId: string, patch: Partial<ConfigurationRow>) =>
      configuration({ ...(existing ?? {}), ...patch, updatedAt: NOW }),
    ),
    insertPolicyVersion: vi.fn().mockResolvedValue({}),
    findCurrentPolicyVersion: vi.fn().mockResolvedValue({ id: 'policy_1', policyVersion: 1 }),
    findQuestionnaire: vi.fn().mockResolvedValue({ id: 'q2', status: 'published' }),
  };
  const dbs = { withOrgScope: vi.fn(async (_orgId: string, fn: (t: unknown) => Promise<unknown>) => fn(tx)) };
  const organizations = { findById: vi.fn().mockResolvedValue({ id: 'org_sample', timezone: 'Europe/Belgrade' }) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new ListeningConfigurationService(dbs as never, repo as never, organizations as never, audit as never);
  return { service, repo, audit, tx };
}

describe('capabilityEnabled', () => {
  it('is on from the start date and off once the end date is reached', () => {
    const row = configuration();
    expect(capabilityEnabled(row, 'measurement', NOW)).toBe(true);
    expect(capabilityEnabled(row, 'feedback', NOW)).toBe(false);
    expect(capabilityEnabled(row, 'workplaceReviews', NOW)).toBe(false);
    expect(capabilityEnabled(row, 'workplaceReviews', new Date('2026-09-30T23:59:59.000Z'))).toBe(true);
    expect(capabilityEnabled(row, 'measurement', new Date('2025-12-31T23:59:59.000Z'))).toBe(false);
  });
});

describe('ListeningConfigurationService', () => {
  it('creates the pilot defaults and policy version 1 on first read', async () => {
    const { service, repo } = setup(null);
    const response = await service.get('org_sample');
    expect(repo.insertConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_sample', minimumCohort: 10, goodThresholdTenths: 750, monitorThresholdTenths: 600, cadenceDays: 14, policyVersion: 1 }),
      expect.anything(),
    );
    expect(repo.insertPolicyVersion).toHaveBeenCalledWith(expect.objectContaining({ policyVersion: 1, orgId: 'org_sample' }), expect.anything());
    expect(response.timeZone).toBe('Europe/Belgrade');
    expect(response.policyVersion).toBe(1);
  });

  it('bumps the policy version, writes the policy row and audits field names only', async () => {
    const { service, repo, audit, tx } = setup(configuration());
    const response = await service.update('org_sample', { cadenceDays: 21, minimumCohort: 12 }, actor);
    expect(response.policyVersion).toBe(2);
    expect(response.cadenceDays).toBe(21);
    expect(repo.insertPolicyVersion).toHaveBeenCalledWith(
      expect.objectContaining({ policyVersion: 2, cadenceDays: 21, minimumCohort: 12, createdByUserId: 'user_nikola' }),
      tx,
    );
    const [input, opts] = audit.record.mock.calls[0]!;
    expect(opts).toEqual({ tx });
    expect(input).toMatchObject({ action: 'listening.configuration.changed', orgId: 'org_sample', result: 'ALLOWED' });
    expect(input.details).toEqual({ fields: ['cadenceDays', 'minimumCohort'], policyVersion: 2 });
    expect(JSON.stringify(input.details)).not.toContain('21');
  });

  it('refuses an unpublished questionnaire version', async () => {
    const { service, repo } = setup(configuration());
    repo.findQuestionnaire.mockResolvedValue({ id: 'q_draft', status: 'draft' });
    const err = await service.update('org_sample', { questionnaireVersionId: 'q_draft' }, actor).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiHttpException);
    expect((err as ApiHttpException).code).toBe('no_published_questionnaire');
    expect(repo.updateConfiguration).not.toHaveBeenCalled();
  });

  it('isEnabled reads the window and answers false for an organization without a row', async () => {
    const { service } = setup(configuration());
    expect(await service.isEnabled('org_sample', 'measurement', NOW)).toBe(true);
    expect(await service.isEnabled('org_sample', 'workplaceReviews', NOW)).toBe(false);
    const none = setup(null);
    expect(await none.service.isEnabled('org_other', 'measurement', NOW)).toBe(false);
  });

  it('maps every column to the response with ISO dates', () => {
    const response = toConfigurationResponse(configuration(), 'Europe/Budapest');
    expect(response).toMatchObject({
      orgId: 'org_sample',
      measurementFrom: '2026-01-01T00:00:00.000Z',
      measurementUntil: null,
      workplaceReviewsUntil: '2026-10-01T00:00:00.000Z',
      timeZone: 'Europe/Budapest',
      updatedAt: NOW.toISOString(),
    });
  });
});
