/**
 * OrganizationsService unit tests: paging, the response shape and 404.
 */
import { describe, it, expect, vi } from 'vitest';
import { ApiHttpException } from '../common/api-error.js';
import { OrganizationsService } from './organizations.service.js';

const CREATED = new Date('2026-01-01T00:00:00.000Z');

function row(id: string, name: string) {
  return {
    id,
    name,
    slug: id,
    country: 'RS',
    timezone: 'Europe/Belgrade',
    contractStart: null,
    contractEnd: null,
    ownerUserId: 'user_owner',
    selfApprovalAllowed: false,
    financialStepUpThresholdMinor: null,
    cohortThreshold: null,
    status: 'ACTIVE',
    createdAt: CREATED,
    updatedAt: CREATED,
  };
}

function setup(rows: ReturnType<typeof row>[], found: ReturnType<typeof row> | null = null) {
  const repo = { list: vi.fn().mockResolvedValue(rows), findById: vi.fn().mockResolvedValue(found) };
  return { repo, service: new OrganizationsService(repo as never) };
}

describe('OrganizationsService', () => {
  it('returns the page and the last id as nextCursor when one more row exists', async () => {
    const { repo, service } = setup([row('org_a', 'A'), row('org_b', 'B'), row('org_c', 'C')]);
    const res = await service.list({ limit: 2, search: 'a', cursor: 'org_0' });
    expect(repo.list).toHaveBeenCalledWith({ limit: 2, search: 'a', cursor: 'org_0' });
    expect(res.items.map((o) => o.id)).toEqual(['org_a', 'org_b']);
    expect(res.nextCursor).toBe('org_b');
  });

  it('returns nextCursor null on the last page and only the five public fields', async () => {
    const { service } = setup([row('org_a', 'A')]);
    const res = await service.list({ limit: 25 });
    expect(res).toEqual({
      items: [{ id: 'org_a', name: 'A', slug: 'org_a', status: 'ACTIVE', createdAt: CREATED.toISOString() }],
      nextCursor: null,
    });
  });

  it('get returns one organization', async () => {
    const { service } = setup([], row('org_a', 'A'));
    await expect(service.get('org_a')).resolves.toMatchObject({ id: 'org_a', name: 'A' });
  });

  it('get throws 404 not_found for an unknown organization', async () => {
    const { service } = setup([], null);
    const err = await service.get('org_missing').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiHttpException);
    expect((err as ApiHttpException).getStatus()).toBe(404);
  });
});
