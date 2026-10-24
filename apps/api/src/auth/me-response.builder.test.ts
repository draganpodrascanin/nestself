import { describe, expect, it, vi } from 'vitest';
import type { Principal } from '@nestself/contracts';
import { MeResponseBuilder } from './me-response.builder.js';

const principal = {
  userId: 'user_ivana',
  context: { kind: 'organization', orgId: 'org_sample' },
  memberships: [{ orgId: 'org_sample', status: 'ACTIVE', startDate: '2024-01-01', endDate: null }],
  staffTemplates: [],
  expert: null,
} as unknown as Principal;

function createMockPrincipalLoader() {
  return {
    load: vi.fn().mockResolvedValue({
      ...principal,
      memberships: principal.memberships,
      staffTemplates: [],
      expert: null,
    }),
    loadAvailableContextExtras: vi.fn().mockResolvedValue({
      orgNames: new Map([['org_sample', 'Sample Org']]),
      orgGrantTemplateKeys: new Map(),
    }),
  };
}

describe('MeResponseBuilder', () => {
  it("returns the principal with the engine's effective actions and available contexts", async () => {
    const authz = { effectiveActions: vi.fn().mockResolvedValue(['program.overview', 'access.preview']) };
    const principalLoader = createMockPrincipalLoader();
    const builder = new MeResponseBuilder(authz as never, principalLoader as never);

    const me = await builder.build(principal);

    expect(authz.effectiveActions).toHaveBeenCalledWith(principal);
    expect(me.principal).toEqual(principal);
    expect(me.effectiveActions).toEqual(['program.overview', 'access.preview']);
    expect(me.availableContexts).toBeDefined();
    expect(Array.isArray(me.availableContexts)).toBe(true);
  });

  it('propagates a failure instead of answering with an empty list', async () => {
    const authz = { effectiveActions: vi.fn().mockRejectedValue(new Error('db down')) };
    const principalLoader = createMockPrincipalLoader();
    await expect(new MeResponseBuilder(authz as never, principalLoader as never).build(principal)).rejects.toThrow('db down');
  });
});
