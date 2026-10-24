import { describe, expect, it, vi } from 'vitest';
import type { Principal } from '@nestself/contracts';
import { MeResponseBuilder } from './me-response.builder.js';

const principal = {
  userId: 'user_ivana',
  context: { kind: 'organization', orgId: 'org_sample' },
} as unknown as Principal;

describe('MeResponseBuilder', () => {
  it("returns the principal with the engine's effective actions for its context", async () => {
    const authz = { effectiveActions: vi.fn().mockResolvedValue(['program.overview', 'access.preview']) };
    const builder = new MeResponseBuilder(authz as never);

    const me = await builder.build(principal);

    expect(authz.effectiveActions).toHaveBeenCalledWith(principal);
    expect(me).toEqual({ principal, effectiveActions: ['program.overview', 'access.preview'] });
  });

  it('propagates a failure instead of answering with an empty list', async () => {
    const authz = { effectiveActions: vi.fn().mockRejectedValue(new Error('db down')) };
    await expect(new MeResponseBuilder(authz as never).build(principal)).rejects.toThrow('db down');
  });
});
